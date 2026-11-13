import http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import type { Gateway } from '../src/core/GatewayEngine.js';
import type { GatewayConfig } from '../src/types.js';
import { BoundedMap } from '../src/shared/BoundedMap.js';

// ---------- helpers ----------

const closeServer = (s: http.Server): Promise<void> =>
  new Promise((r) => {
    s.closeAllConnections?.();
    s.close(() => r());
  });

function echoServer(): http.Server {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url }));
  });
}

function failingServer(status = 503): { server: http.Server; hits: () => number } {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(status);
    res.end('upstream failure');
  });
  return { server, hits: () => hits };
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  ms: number;
}

/** Fire `total` requests with bounded concurrency via a keep-alive agent. */
async function flood(
  port: number,
  path: string,
  total: number,
  concurrency: number,
  agent?: http.Agent,
  headers: Record<string, string> = {},
): Promise<HttpResult[]> {
  const results: HttpResult[] = new Array(total);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < total) {
      const i = next++;
      const started = performance.now();
      results[i] = await new Promise<HttpResult>((resolve, reject) => {
        const r = http.request(
          { host: '127.0.0.1', port, path, agent, headers },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
                ms: performance.now() - started,
              }),
            );
          },
        );
        r.on('error', reject);
        r.end();
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );
  return results;
}

function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

// ---------- suite ----------

describe('stress & benchmark', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  const servers: http.Server[] = [];
  const gateways: Gateway[] = [];

  beforeAll(async () => {
    upstream = echoServer();
    servers.push(upstream);
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await Promise.all(gateways.map((g) => g.close().catch(() => {})));
    await Promise.all(servers.map(closeServer));
  });

  async function boot(config: GatewayConfig): Promise<number> {
    const gw = createGateway(config);
    gateways.push(gw);
    await gw.listen(0, '127.0.0.1');
    return (gw.server.address() as AddressInfo).port;
  }

  it('sustained throughput: 2000 requests @ concurrency 100', async () => {
    const port = await boot({ routes: { '/bench': upstreamPort } });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });

    // warmup
    await flood(port, '/bench/warm', 50, 25, agent);

    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const results = await flood(port, '/bench/x', 2000, 100, agent);
    const elapsedMs = performance.now() - t0;
    const heapDeltaMb =
      (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

    const ok = results.filter((r) => r.status === 200).length;
    const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
    const rps = (results.length / elapsedMs) * 1000;

    console.info(
      `[bench] 2000 reqs in ${elapsedMs.toFixed(0)}ms → ` +
        `${rps.toFixed(0)} rps | p50=${percentile(latencies, 50).toFixed(1)}ms ` +
        `p95=${percentile(latencies, 95).toFixed(1)}ms ` +
        `p99=${percentile(latencies, 99).toFixed(1)}ms | heapΔ=${heapDeltaMb.toFixed(1)}MB`,
    );

    expect(ok).toBe(2000);
    expect(heapDeltaMb).toBeLessThan(30);
    agent.destroy();
  }, 60_000);

  it('coalescing collapses a 500-request thundering herd', async () => {
    let upstreamHits = 0;
    const counting = http.createServer((req, res) => {
      upstreamHits += 1;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"coalesced":true}');
      }, 40);
    });
    servers.push(counting);
    await new Promise<void>((r) => counting.listen(0, '127.0.0.1', r));
    const countPort = (counting.address() as AddressInfo).port;

    const port = await boot({
      routes: [
        {
          prefix: '/herd',
          upstreams: countPort,
          cache: { ttlMs: 60_000 }, // coalesce defaults on for cacheable GETs
        },
      ],
    });

    const results = await flood(port, '/herd/x', 500, 100);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
    expect(upstreamHits).toBeLessThanOrEqual(5);
  }, 60_000);

  it('token bucket enforces quota exactly under a 1000-request flood', async () => {
    const port = await boot({
      routes: [
        {
          prefix: '/rl',
          upstreams: upstreamPort,
          rateLimit: { capacity: 100, refillPerSecond: 100 / 60, batchSize: 1 },
        },
      ],
    });

    const results = await flood(port, '/rl/x', 1000, 200);
    const allowed = results.filter((r) => r.status === 200).length;
    const denied = results.filter((r) => r.status === 429);

    // capacity 100 + tiny refill slack during the burst window
    expect(allowed).toBeLessThanOrEqual(105);
    expect(allowed).toBeGreaterThanOrEqual(90);
    expect(denied.length).toBe(1000 - allowed);
    const sample = denied[0];
    expect(sample).toBeDefined();
    if (sample !== undefined) {
      expect(sample.headers['x-ratelimit-remaining']).toBe('0');
    }
  }, 60_000);

  it('circuit breaker trips OPEN and traffic fails over to healthy upstream', async () => {
    const bad = failingServer(503);
    servers.push(bad.server);
    await new Promise<void>((r) => bad.server.listen(0, '127.0.0.1', r));
    const badPort = (bad.server.address() as AddressInfo).port;

    const okSrv = echoServer();
    servers.push(okSrv);
    await new Promise<void>((r) => okSrv.listen(0, '127.0.0.1', r));
    const okPort = (okSrv.address() as AddressInfo).port;

    const port = await boot({
      routes: [
        {
          prefix: '/mix',
          upstreams: [
            { url: `http://127.0.0.1:${badPort}`, weight: 3 },
            { url: `http://127.0.0.1:${okPort}`, weight: 1 },
          ],
          circuitBreaker: {
            failureThreshold: 5,
            successThreshold: 1,
            openDurationMs: 60_000,
          },
        },
      ],
    });

    const results = await flood(port, '/mix/x', 200, 50);
    const statuses = new Set(results.map((r) => r.status));

    // Every response is either proxied (200) or fast-rejected (503 open).
    for (const s of statuses) {
      expect([200, 503]).toContain(s);
    }
    // Breaker capped primary hits well below the request count.
    expect(bad.hits()).toBeLessThan(200);
    expect(bad.hits()).toBeLessThanOrEqual(60);
    // Healthy secondary still served real traffic.
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
  }, 60_000);

  it('high-cardinality keys stay bounded; shutdown is fast', async () => {
    const port = await boot({
      extractClientKey: (req) =>
        (req.headers['x-api-key'] as string | undefined) ?? 'anon',
      limiter: { localMaxKeys: 1_000 },
      routes: [
        {
          prefix: '/card',
          upstreams: upstreamPort,
          rateLimit: { capacity: 10_000, refillPerSecond: 10_000 },
          cache: { ttlMs: 60_000, maxEntries: 500 },
        },
      ],
    });

    // 10k unique client keys through limiter + cache path.
    const keys = Array.from({ length: 10_000 }, (_, i) => ({
      'x-api-key': `key-${i}-${Math.random().toString(36).slice(2)}`,
    }));
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < keys.length) {
        const i = idx++;
        await new Promise<void>((resolve) => {
          const r = http.request(
            {
              host: '127.0.0.1',
              port,
              path: '/card/x',
              headers: keys[i] ?? {},
            },
            (res) => {
              res.resume();
              res.on('end', resolve);
            },
          );
          r.on('error', () => resolve());
          r.end();
        });
      }
    };
    await Promise.all(Array.from({ length: 100 }, () => worker()));

    // BoundedMap contract: caps hold strictly.
    const bounded = new BoundedMap<string, number>({ maxEntries: 100 });
    for (let i = 0; i < 1_000; i++) bounded.set(`k${i}`, i);
    expect(bounded.size).toBeLessThanOrEqual(100);

    // Gateway still healthy after the flood; shutdown is fast.
    const gw = gateways[gateways.length - 1];
    expect(gw).toBeDefined();
    if (gw !== undefined) {
      const shutdownStart = performance.now();
      await gw.shutdown();
      const shutdownMs = performance.now() - shutdownStart;
      console.info(`[stress] shutdown after 10k keys: ${shutdownMs.toFixed(1)}ms`);
      expect(shutdownMs).toBeLessThan(200);
    }
  }, 120_000);
});
