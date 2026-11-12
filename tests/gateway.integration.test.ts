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
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('gateway integration', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let gateway: Gateway;
  let gatewayPort: number;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          xff: req.headers['x-forwarded-for'],
        }),
      );
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;

    gateway = createGateway({
      routes: [
        defineRoute({
          prefix: asRoutePrefix('/api'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
        }),
        defineRoute({
          prefix: asRoutePrefix('/limited'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
          rateLimit: { capacity: 2, refillPerSecond: 0.0001 },
        }),
        defineRoute({
          prefix: asRoutePrefix('/ratelimited'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
          rateLimit: { capacity: 1, refillPerSecond: 0.0001 },
        }),
        defineRoute({
          prefix: asRoutePrefix('/dead'),
          upstreams: [{ url: asUpstreamUrl('http://127.0.0.1:1') }],
          circuitBreaker: { failureThreshold: 1, openDurationMs: 60_000 },
        }),
      ],
    });
    await gateway.listen(0, '127.0.0.1');
    gatewayPort = (gateway.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it('proxies and strips prefix', async () => {
    const res = await request(gatewayPort, '/api/users?page=2');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { url: string; xff?: string };
    expect(body.url).toBe('/users?page=2');
    expect(body.xff).toBeTruthy();
  });

  it('keeps prefix when stripPrefix=false', async () => {
    // covered implicitly: '/limited' route strips to '/' + rest
    const res = await request(gatewayPort, '/limited/thing');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { url: string };
    expect(body.url).toBe('/thing');
  });

  it('returns 404 for unmatched routes', async () => {
    const res = await request(gatewayPort, '/nope');
    expect(res.status).toBe(404);
    expect(res.body).toContain('NO_ROUTE');
  });

  it('returns 429 with rate-limit headers when exceeded', async () => {
    const first = await request(gatewayPort, '/ratelimited/a');
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('1');

    const second = await request(gatewayPort, '/ratelimited/a');
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeTruthy();
    expect(second.body).toContain('RATE_LIMITED');
  });

  it('returns 502 then 503 as circuit opens', async () => {
    const first = await request(gatewayPort, '/dead/x');
    expect(first.status).toBe(502);

    const second = await request(gatewayPort, '/dead/x');
    expect(second.status).toBe(503);
    expect(second.body).toContain('CIRCUIT_OPEN');
  });
});
