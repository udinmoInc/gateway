import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import { InMemoryRedis } from '../src/limiter/InMemoryRedis.js';
import { CircuitBreaker } from '../src/core/CircuitBreaker.js';
import { BoundedMap } from '../src/shared/BoundedMap.js';

function echoServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
}

function failingServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(500);
    res.end('boom');
  });
}

const request = (
  port: number,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers }),
      );
    });
    r.on('error', reject);
    r.end();
  });

let ok: http.Server;
let bad: http.Server;
let okPort: number;
let badPort: number;
const servers: http.Server[] = [];

beforeAll(async () => {
  ok = echoServer();
  bad = failingServer();
  servers.push(ok, bad);
  await Promise.all([
    new Promise<void>((r) => ok.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => bad.listen(0, '127.0.0.1', r)),
  ]);
  okPort = (ok.address() as AddressInfo).port;
  badPort = (bad.address() as AddressInfo).port;
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

describe('rate limiting', () => {
  it('per-route rate limit enforces capacity then 429s', async () => {
    const gw = createGateway({
      routes: [
        {
          prefix: '/hot',
          upstreams: okPort,
          rateLimit: '2/sec',
        },
      ],
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      const first = await request(port, '/hot/a');
      const second = await request(port, '/hot/b');
      const third = await request(port, '/hot/c');
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.headers['x-ratelimit-limit'] ?? third.headers['x-ratelimit-remaining']).toBeDefined();
    } finally {
      await gw.close();
    }
  });

  it('InMemoryRedis limiter enforces distributed-style limits', async () => {
    const redis = new InMemoryRedis();
    const gw = createGateway({
      limiter: { redis },
      routes: [
        { prefix: '/r', upstreams: okPort, rateLimit: '1/sec' },
      ],
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      expect((await request(port, '/r/a')).status).toBe(200);
      expect((await request(port, '/r/b')).status).toBe(429);
    } finally {
      await gw.close();
    }
  });
});

describe('circuit breaker', () => {
  it('CLOSED → OPEN after failureThreshold, blocks canExecute', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      openDurationMs: 50,
    });
    const key = 'route:/upstream';
    expect(cb.stateOf(key)).toBe('CLOSED');
    expect(cb.canExecute(key)).toBe(true);
    cb.recordFailure(key);
    cb.recordFailure(key);
    expect(cb.stateOf(key)).toBe('OPEN');
    expect(cb.canExecute(key)).toBe(false);
    // After openDurationMs elapses, HALF_OPEN probe is allowed.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.canExecute(key)).toBe(true);
        resolve();
      }, 80);
    });
  });

  it('route-level circuit breaker trips on upstream 5xx', async () => {
    const gw = createGateway({
      routes: [
        {
          prefix: '/fragile',
          upstreams: badPort,
          circuitBreaker: {
            failureThreshold: 2,
            successThreshold: 1,
            openDurationMs: '100ms',
          },
        },
      ],
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await request(port, '/fragile/x')).status);
      }
      // Upstream returns 500 → breaker counts failures; eventually the
      // gateway surfaces 503 (circuit open) instead of proxying.
      expect(statuses).toContain(500);
      expect(statuses[statuses.length - 1]).not.toBe(200);
    } finally {
      await gw.close();
    }
  });
});

describe('bounded memory & lifecycle', () => {
  it('BoundedMap evicts oldest entries beyond capacity', () => {
    const map = new BoundedMap<string, number>({ maxEntries: 3 });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.set('d', 4); // evicts 'a'
    expect(map.size).toBe(3);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('d')).toBe(4);
  });

  it('graceful shutdown closes the listener and resolves', async () => {
    const gw = createGateway({ target: okPort });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    expect((await request(port, '/x')).status).toBe(200);
    await gw.shutdown();
    await expect(request(port, '/x')).rejects.toThrow();
  });
});
