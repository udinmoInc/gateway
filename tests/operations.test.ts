import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import { asRoutePrefix, asUpstreamUrl, defineRoute } from '../src/index.js';
import type { Gateway } from '../src/core/GatewayEngine.js';

function request(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('production operations', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let flaky: http.Server;
  let flakyPort: number;
  let flakyCalls = 0;
  const gateways: Gateway[] = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, ts: Date.now() }));
    });
    flaky = http.createServer((_req, res) => {
      flakyCalls += 1;
      if (flakyCalls === 1) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('flaky-v1');
      } else {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
      }
    });
    await Promise.all([
      new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r)),
      new Promise<void>((r) => flaky.listen(0, '127.0.0.1', r)),
    ]);
    upstreamPort = (upstream.address() as AddressInfo).port;
    flakyPort = (flaky.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const gw of gateways) await gw.close();
    await Promise.all([
      new Promise<void>((r) => upstream.close(() => r())),
      new Promise<void>((r) => flaky.close(() => r())),
    ]);
  });

  async function boot(config: Parameters<typeof createGateway>[0]): Promise<number> {
    const gw = createGateway(config);
    gateways.push(gw);
    await gw.listen(0, '127.0.0.1');
    return (gw.server.address() as AddressInfo).port;
  }

  describe('probes', () => {
    it('serves liveness and readiness bypassing routes and limits', async () => {
      const port = await boot({
        port: 0,
        probes: {
          livenessPath: asRoutePrefix('/healthz'),
          readinessPath: asRoutePrefix('/readyz'),
        },
        routes: [
          defineRoute({
            prefix: asRoutePrefix('/api'),
            upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
            rateLimit: { capacity: 1, refillPerSecond: 0.0001 },
          }),
        ],
      });

      const live = await request(port, '/healthz');
      expect(live.status).toBe(200);
      const liveBody = JSON.parse(live.body) as { status: string; uptimeSec: number };
      expect(liveBody.status).toBe('ok');
      expect(liveBody.uptimeSec).toBeGreaterThanOrEqual(0);

      const ready = await request(port, '/readyz');
      expect(ready.status).toBe(200);
      expect(JSON.parse(ready.body)).toMatchObject({ status: 'ready' });

      // probes are not rate limited even though /api is nearly exhausted
      await request(port, '/api/x'); // consumes the single token
      const denied = await request(port, '/api/x');
      expect(denied.status).toBe(429);
      const liveAgain = await request(port, '/healthz');
      expect(liveAgain.status).toBe(200);
    });
  });

  describe('response cache', () => {
    it('serves HIT on second GET and respects no-store', async () => {
      const port = await boot({
        routes: [
          defineRoute({
            prefix: asRoutePrefix('/cached'),
            upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
            cache: { ttlMs: 60_000 },
          }),
        ],
      });

      const first = await request(port, '/cached/item');
      expect(first.status).toBe(200);
      expect(first.headers['x-gateway-cache']).toBe('MISS');

      const second = await request(port, '/cached/item');
      expect(second.status).toBe(200);
      expect(second.headers['x-gateway-cache']).toBe('HIT');
      expect(second.body).toBe(first.body); // identical cached payload

      const noStore = await request(port, '/cached/item', { 'cache-control': 'no-store' });
      expect(noStore.headers['x-gateway-cache']).toBe('MISS');
    });

    it('serves STALE when circuit is open and serveStaleOnCircuitOpen', async () => {
      const before = flakyCalls;
      const port = await boot({
        routes: [
          defineRoute({
            prefix: asRoutePrefix('/flaky'),
            upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${flakyPort}`) }],
            cache: { ttlMs: 1, serveStaleOnCircuitOpen: true }, // instantly stale
            circuitBreaker: { failureThreshold: 1, successThreshold: 1, openDurationMs: 60_000 },
          }),
        ],
      });

      const first = await request(port, '/flaky/x');
      expect(first.status).toBe(200);
      expect(first.body).toBe('flaky-v1');
      expect(first.headers['x-gateway-cache']).toBe('MISS');
      expect(flakyCalls).toBe(before + 1);

      // let the 1ms TTL expire so the next request reaches the upstream
      await new Promise((r) => setTimeout(r, 10));

      // upstream now returns 500 → recordFailure → circuit OPEN
      const second = await request(port, '/flaky/x');
      expect(second.status).toBe(500);
      expect(flakyCalls).toBe(before + 2);

      // circuit OPEN + stale entry → STALE without hitting upstream
      const third = await request(port, '/flaky/x');
      expect(third.status).toBe(200);
      expect(third.headers['x-gateway-cache']).toBe('STALE');
      expect(third.body).toBe('flaky-v1');
      expect(flakyCalls).toBe(before + 2); // no new upstream call
    });
  });

  describe('graceful shutdown', () => {
    it('rejects new requests with 503 during drain and waits for in-flight', async () => {
      // slow upstream: 300ms delay
      const slow = http.createServer((_req, res) => {
        setTimeout(() => {
          res.writeHead(200);
          res.end('slow-ok');
        }, 300);
      });
      await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
      const slowPort = (slow.address() as AddressInfo).port;

      const gw = createGateway({
        routes: [
          defineRoute({
            prefix: asRoutePrefix('/slow'),
            upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${slowPort}`) }],
          }),
        ],
      });
      gateways.push(gw);
      await gw.listen(0, '127.0.0.1');
      const port = (gw.server.address() as AddressInfo).port;

      const inflight = request(port, '/slow/x');
      // let the request reach the upstream
      await new Promise((r) => setTimeout(r, 50));

      const shutdownPromise = gw.shutdown({ drainTimeoutMs: 5_000 });
      await new Promise((r) => setTimeout(r, 20)); // ensure draining flag set

      const rejected = await request(port, '/slow/y');
      expect(rejected.status).toBe(503);
      expect(rejected.headers['retry-after']).toBe('5');
      expect(String(rejected.headers.connection).toLowerCase()).toContain('close');
      expect(rejected.body).toContain('DRAINING');

      const inflightRes = await inflight;
      expect(inflightRes.status).toBe(200);
      expect(inflightRes.body).toBe('slow-ok');

      const start = Date.now();
      await shutdownPromise;
      expect(Date.now() - start).toBeLessThan(5_000);

      await new Promise<void>((r) => slow.close(() => r()));
    });
  });
});
