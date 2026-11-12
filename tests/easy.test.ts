import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGateway } from '../src/easy.js';
import type { Gateway } from '../src/core/GatewayEngine.js';

function request(
  port: number,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
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

describe('startGateway (easy layer)', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  const gateways: Gateway[] = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url }));
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const gw of gateways) await gw.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  async function boot(options: Parameters<typeof startGateway>[0]): Promise<number> {
    const gw = startGateway(options);
    gateways.push(gw);
    await gw.listen(0, '127.0.0.1');
    return (gw.server.address() as AddressInfo).port;
  }

  it('proxies object-map routes with no redis and enforces rpm limit', async () => {
    const port = await boot({
      routes: { '/api': `http://127.0.0.1:${upstreamPort}` },
      rateLimit: { requestsPerMinute: 6 }, // burst defaults to 6
    });

    for (let i = 0; i < 6; i++) {
      const res = await request(port, '/api/ping');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ url: '/ping' });
    }

    const limited = await request(port, '/api/ping');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect(limited.headers['x-ratelimit-limit']).toBe('6');
  });

  it('supports SimpleRoute[] with stripPrefix and per-route limitPerMinute', async () => {
    const port = await boot({
      routes: [
        {
          path: '/v1',
          to: `http://127.0.0.1:${upstreamPort}`,
          stripPrefix: false,
          limitPerMinute: 2,
        },
        {
          path: '/open',
          to: `http://127.0.0.1:${upstreamPort}`,
          limitPerMinute: 100,
        },
      ],
      rateLimit: { requestsPerMinute: 1 }, // global would be tiny; per-route wins
    });

    // stripPrefix=false → upstream sees the full path
    const first = await request(port, '/v1/status');
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ url: '/v1/status' });

    await request(port, '/v1/status'); // 2nd allowed
    const third = await request(port, '/v1/status');
    expect(third.status).toBe(429);

    // sibling route unaffected by /v1's exhaustion
    const open = await request(port, '/open/x');
    expect(open.status).toBe(200);
    expect(JSON.parse(open.body)).toEqual({ url: '/x' }); // default strip
  });

  it('accepts multiple upstreams per route', async () => {
    const port = await boot({
      routes: {
        '/multi': [
          `http://127.0.0.1:${upstreamPort}`,
          `http://127.0.0.1:${upstreamPort}`,
        ],
      },
      rateLimit: { requestsPerMinute: 60 },
    });
    const res = await request(port, '/multi/a');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ url: '/a' });
  });
});
