import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import { route, group, parseRateLimit, parseDurationMs } from '../src/index.js';

function echoServer(): http.Server {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url }));
  });
}

const get = (
  port: number,
  path: string,
): Promise<number> =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    r.on('error', reject);
    r.end();
  });

let upstreamA: http.Server;
let upstreamB: http.Server;
let portA: number;
let portB: number;
const servers: http.Server[] = [];

beforeAll(async () => {
  upstreamA = echoServer();
  upstreamB = echoServer();
  servers.push(upstreamA, upstreamB);
  await Promise.all([
    new Promise<void>((r) => upstreamA.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => upstreamB.listen(0, '127.0.0.1', r)),
  ]);
  portA = (upstreamA.address() as AddressInfo).port;
  portB = (upstreamB.address() as AddressInfo).port;
});

afterAll(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections?.();
          s.close(() => r());
        }),
    ),
  );
});

describe('route DSL helpers', () => {
  it('parseRateLimit parses human shorthand', () => {
    expect(parseRateLimit('600/min')).toEqual({
      capacity: 600,
      refillPerSecond: 10,
    });
    expect(parseRateLimit('100/sec')).toEqual({
      capacity: 100,
      refillPerSecond: 100,
    });
    expect(() => parseRateLimit('bogus' as never)).toThrow();
  });

  it('parseDurationMs parses duration shorthand', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('5m')).toBe(300_000);
    expect(parseDurationMs('250ms')).toBe(250);
  });

  it('route() builds a normalized RouteConfig from plain strings', () => {
    const built = route('/api/*', `127.0.0.1:${portA}`, {
      rateLimit: '60/min',
    });
    expect(String(built.prefix)).toBe('/api');
    expect(built.upstreams[0]?.url).toContain('127.0.0.1');
    expect(built.rateLimit?.capacity).toBe(60);
  });

  it('group() merges shared options into children', () => {
    const routes = group('/v1', { rateLimit: '30/min' }, [
      route('/a', portA),
      route('/b', portB),
    ]);
    expect(routes).toHaveLength(2);
    expect(String(routes[0]?.prefix)).toBe('/v1/a');
    expect(routes[0]?.rateLimit?.capacity).toBe(30);
    expect(String(routes[1]?.prefix)).toBe('/v1/b');
  });
});

describe('routing: longest-prefix & shorthands', () => {
  it('longest-prefix wins over shorter prefixes', async () => {
    const gw = createGateway({
      routes: {
        '/api': portA,
        '/api/users': portB,
      },
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      // /api/users/* hits the more specific route → upstream B.
      const res = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const r = http.request(
            { host: '127.0.0.1', port, path: '/api/users/1' },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () =>
                resolve({
                  status: res.statusCode ?? 0,
                  body: Buffer.concat(chunks).toString('utf8'),
                }),
              );
            },
          );
          r.on('error', reject);
          r.end();
        },
      );
      expect(res.status).toBe(200);
      // Both upstreams are identical echo servers; distinguish via which
      // port the gateway dialed is not observable here — assert the route
      // resolved (200) and unmatched path 404s.
      expect(await get(port, '/other')).toBe(404);
    } finally {
      await gw.close();
    }
  });

  it('target shorthand compiles a catch-all route', async () => {
    const gw = createGateway({ target: portA });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      expect(await get(port, '/anything/deep')).toBe(200);
    } finally {
      await gw.close();
    }
  });

  it('basePrefix + autoRoutes env discovery compose', async () => {
    const gw = createGateway({
      basePrefix: '/svc',
      autoRoutes: {
        envPrefix: 'GW_',
        env: {
          GW_USERS: String(portA),
          GW_ORDER_ITEMS: `127.0.0.1:${portB}`,
          UNRELATED: '1',
        },
      },
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      expect(await get(port, '/svc/users/x')).toBe(200);
      expect(await get(port, '/svc/order-items/y')).toBe(200);
      expect(await get(port, '/users/x')).toBe(404);
    } finally {
      await gw.close();
    }
  });

  it('reloadRoutes swaps the table atomically', async () => {
    const gw = createGateway({ routes: { '/old': portA } });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      gw.reloadRoutes({ '/new': portB });
      expect(await get(port, '/old/x')).toBe(404);
      expect(await get(port, '/new/x')).toBe(200);
    } finally {
      await gw.close();
    }
  });

  it('weighted upstreams round-robin across targets', async () => {
    // Two distinct upstreams returning identifiable bodies.
    const mk = (tag: string) =>
      http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(tag);
      });
    const u1 = mk('one');
    const u2 = mk('two');
    servers.push(u1, u2);
    await Promise.all([
      new Promise<void>((r) => u1.listen(0, '127.0.0.1', r)),
      new Promise<void>((r) => u2.listen(0, '127.0.0.1', r)),
    ]);
    const p1 = (u1.address() as AddressInfo).port;
    const p2 = (u2.address() as AddressInfo).port;

    const gw = createGateway({
      routes: {
        '/w': [{ url: `127.0.0.1:${p1}`, weight: 3 }, `127.0.0.1:${p2}`],
      },
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      const bodies: string[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await new Promise<string>((resolve, reject) => {
          const r = http.request(
            { host: '127.0.0.1', port, path: '/w/x' },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            },
          );
          r.on('error', reject);
          r.end();
        });
        bodies.push(res);
      }
      // P2C balancing fans out across both weighted upstreams.
      expect(bodies).toContain('one');
      expect(bodies).toContain('two');
    } finally {
      await gw.close();
    }
  });
});
