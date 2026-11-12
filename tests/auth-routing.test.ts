import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import {
  group,
  loadRoutesDir,
  loadRoutesDirSync,
  parseDurationMs,
  parseRateLimit,
  route,
  signJwt,
  verifyJwt,
} from '../src/index.js';
import type { Gateway } from '../src/core/GatewayEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
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
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('routing DSL', () => {
  it('parses rate limit strings', () => {
    expect(parseRateLimit('60/sec')).toEqual({ capacity: 60, refillPerSecond: 60 });
    expect(parseRateLimit('120/min')).toEqual({ capacity: 120, refillPerSecond: 2 });
    expect(parseRateLimit('1000/hour')).toEqual({ capacity: 1000, refillPerSecond: 1000 / 3600 });
    expect(() => parseRateLimit('bogus' as never)).toThrow(/Invalid rate limit/);
  });

  it('parses duration strings', () => {
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('5m')).toBe(300_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
    expect(parseDurationMs(250)).toBe(250);
    expect(() => parseDurationMs('soon' as never)).toThrow(/Invalid duration/);
  });

  it('route() normalizes wildcard, rate limit, cache, auth', () => {
    const r = route('/api/users/*', 'http://users:4001', {
      auth: true,
      rateLimit: '120/min',
      cache: '30s',
    });
    expect(r.prefix).toBe('/api/users');
    expect(r.rateLimit).toEqual({ capacity: 120, refillPerSecond: 2 });
    expect(r.cache).toEqual({ ttlMs: 30_000 });
    expect(r.auth).toBe(true);
    expect(r.upstreams[0]?.url).toBe('http://users:4001');
    expect(() => route('/bad', 'ftp://x' as never)).toThrow(/Invalid upstream/);
  });

  it('group() prefixes paths and inherits shared policy', () => {
    const routes = group('/api/v1', { auth: true, rateLimit: '100/min' }, [
      route('/users', 'http://u:1'),
      route('/orders', 'http://o:1', { rateLimit: '500/min', auth: ['admin'] }),
    ]);
    expect(routes).toHaveLength(2);
    expect(routes[0]?.prefix).toBe('/api/v1/users');
    expect(routes[0]?.auth).toBe(true);
    expect(routes[1]?.prefix).toBe('/api/v1/orders');
    expect(routes[1]?.rateLimit?.capacity).toBe(500);
    expect(routes[1]?.auth).toEqual(['admin']);
  });
});

describe('JWT (HS256)', () => {
  const secret = 'test-secret-key';

  it('signs and verifies roundtrip', () => {
    const token = signJwt({ sub: 'u1', role: 'admin' }, secret, {
      issuer: 'gw',
      audience: 'svc',
      expiresInSec: 60,
    });
    const claims = verifyJwt(token, secret, { issuer: 'gw', audience: 'svc' });
    expect(claims?.sub).toBe('u1');
    expect(claims?.role).toBe('admin');
  });

  it('rejects expired, wrong-secret, and wrong-audience tokens', () => {
    const expired = signJwt({ sub: 'u1' }, secret, { expiresInSec: -120 });
    expect(verifyJwt(expired, secret)).toBeNull();

    const token = signJwt({ sub: 'u1' }, secret);
    expect(verifyJwt(token, 'wrong-secret')).toBeNull();
    expect(verifyJwt(token, secret, { audience: 'other' })).toBeNull();
    expect(verifyJwt('not.a.jwt', secret)).toBeNull();
    expect(verifyJwt('a.b', secret)).toBeNull();
  });
});

describe('route loader', () => {
  it('loadRoutesDirSync loads .cjs route modules', async () => {
    const routes = loadRoutesDirSync(path.join(FIXTURES, 'routes-sync'));
    expect(routes).toHaveLength(1);
    expect(routes[0]?.prefix).toBe('/svc/users');
  });

  it('loadRoutesDir loads mixed .cjs/.mjs modules', async () => {
    const routes = await loadRoutesDir(path.join(FIXTURES, 'routes'));
    expect(routes.map((r) => r.prefix).sort()).toEqual(['/svc/orders', '/svc/users']);
    const orders = routes.find((r) => (r.prefix as string) === '/svc/orders');
    expect(orders?.stripPrefix).toBe(false);
    expect(orders?.rateLimit?.capacity).toBe(60);
    expect(orders?.upstreams).toHaveLength(2);
  });

  it('fails fast on duplicate prefixes', async () => {
    await expect(loadRoutesDir(path.join(FIXTURES, 'routes-bad'))).rejects.toThrow(
      /duplicate\/conflicting route prefix/,
    );
  });

  it('createGateway({ routesDir }) loads .cjs routes synchronously', async () => {
    const gw = createGateway({
      routesDir: path.join(FIXTURES, 'routes-sync'),
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    // upstream is 127.0.0.1:1 (refused) — a 502 proves the route matched
    const res = await request(port, '/svc/users/x');
    expect(res.status).toBe(502);
    await gw.close();
  });
});


describe('stateless edge auth', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let gateway: Gateway;
  let gatewayPort: number;
  const seenHeaders: Record<string, string | string[] | undefined>[] = [];

  const jwtFor = (claims: Record<string, unknown>, secret = 'gw-secret') =>
    signJwt(claims, secret, { issuer: 'tests', expiresInSec: 300 });

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      seenHeaders.push(req.headers);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;

    gateway = createGateway({
      auth: {
        jwt: { secret: 'gw-secret', issuer: 'tests' },
        realm: 'gateway',
      },
      routes: [
        {
          prefix: '/private' as never,
          upstreams: [{ url: `http://127.0.0.1:${upstreamPort}` as never }],
          auth: true,
        },
        {
          prefix: '/admin' as never,
          upstreams: [{ url: `http://127.0.0.1:${upstreamPort}` as never }],
          auth: ['admin'],
        },
        {
          prefix: '/public' as never,
          upstreams: [{ url: `http://127.0.0.1:${upstreamPort}` as never }],
        },
        {
          prefix: '/plugin-guard' as never,
          upstreams: [{ url: `http://127.0.0.1:${upstreamPort}` as never }],
        },
      ],
      plugins: [
        {
          name: 'custom-header-auth',
          onRequest: (ctx) =>
            ctx.req.url?.startsWith('/plugin-guard') &&
            ctx.req.headers['x-plugin-key'] !== 's3cr3t'
              ? { action: 'deny', statusCode: 401, code: 'UNAUTHORIZED', message: 'missing plugin credential' }
              : undefined,
        },
      ],
    });
    await gateway.listen(0, '127.0.0.1');
    gatewayPort = (gateway.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it('401 without credentials, with Bearer realm challenge', async () => {
    const res = await request(gatewayPort, '/private/x');
    expect(res.status).toBe(401);
    expect(res.body).toContain('UNAUTHORIZED');
    expect(res.headers['www-authenticate']).toContain('Bearer realm="gateway"');
  });

  it('rejects expired and wrong-secret JWTs', async () => {
    const expired = signJwt({ sub: 'u' }, 'gw-secret', { issuer: 'tests', expiresInSec: -120 });
    const bad = await request(gatewayPort, '/private/x', {
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(bad.status).toBe(401);

    const wrongSecret = jwtFor({ sub: 'u' }, 'other-secret');
    const res = await request(gatewayPort, '/private/x', {
      headers: { authorization: `Bearer ${wrongSecret}` },
    });
    expect(res.status).toBe(401);
  });

  it('verifies Bearer JWT and injects X-User-Id / X-User-Role upstream', async () => {
    const token = jwtFor({ sub: 'jwt-user', role: 'user' });
    const res = await request(gatewayPort, '/private/x', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const lastSeen = seenHeaders[seenHeaders.length - 1];
    expect(lastSeen?.['x-user-id']).toBe('jwt-user');
    expect(lastSeen?.['x-user-role']).toBe('user');
    expect(lastSeen?.['x-session-id']).toBeUndefined(); // stateless: no session header
  });

  it('RBAC: user role gets 403 on admin route, admin role gets 200', async () => {
    const userToken = jwtFor({ sub: 'u1', role: 'user' });
    const denied = await request(gatewayPort, '/admin/x', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(denied.status).toBe(403);
    expect(denied.body).toContain('FORBIDDEN');

    const adminToken = jwtFor({ sub: 'a1', role: 'admin' });
    const ok = await request(gatewayPort, '/admin/x', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.status).toBe(200);
  });

  it('strips spoofed identity headers on public routes', async () => {
    const before = seenHeaders.length;
    await request(gatewayPort, '/public/x', {
      headers: { 'x-user-id': 'attacker', 'x-user-role': 'admin', 'x-session-id': 'fake' },
    });
    const seen = seenHeaders[seenHeaders.length - 1];
    expect(seenHeaders.length).toBe(before + 1);
    expect(seen?.['x-user-id']).toBeUndefined();
    expect(seen?.['x-user-role']).toBeUndefined();
    expect(seen?.['x-session-id']).toBeUndefined();
    expect(seen?.['x-request-id']).toBeTruthy();
  });

  it('custom auth via GatewayPlugin onRequest', async () => {
    const denied = await request(gatewayPort, '/plugin-guard/x');
    expect(denied.status).toBe(401);

    const allowed = await request(gatewayPort, '/plugin-guard/x', {
      headers: { 'x-plugin-key': 's3cr3t' },
    });
    expect(allowed.status).toBe(200);
  });
});
