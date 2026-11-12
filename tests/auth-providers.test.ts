import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import type { Gateway } from '../src/core/GatewayEngine.js';
import {
  createIntrospectionProvider,
  createJwksProvider,
  createJwtProvider,
  InMemoryRedis,
  signJwt,
} from '../src/index.js';
import type {
  AuthProvider,
  RouteConfig,
  VerifiedIdentity,
} from '../src/index.js';
import { asRoutePrefix, asUpstreamUrl } from '../src/index.js';

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

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url');

function signAsymmetricJwt(
  alg: 'RS256' | 'ES256',
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  kid: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg, typ: 'JWT', kid }));
  const payload = b64url(
    JSON.stringify({ iat: now, exp: now + 300, ...claims }),
  );
  const input = `${header}.${payload}`;
  const signature =
    alg === 'RS256'
      ? cryptoSign('sha256', Buffer.from(input), privateKey)
      : cryptoSign('sha256', Buffer.from(input), {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        });
  return `${input}.${signature.toString('base64url')}`;
}

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa2 = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwkRsa1 = { ...(rsa.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'rsa-k1' };
const jwkRsa2 = { ...(rsa2.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'rsa-k2' };
const jwkEc1 = { ...(ec.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'ec-k1' };

describe('createJwksProvider', () => {
  let jwksServer: http.Server;
  let jwksUri: string;
  let upstream: http.Server;
  let upstreamPort: number;
  let gateway: Gateway;
  let gatewayPort: number;
  const seenHeaders: Record<string, string | string[] | undefined>[] = [];
  let currentJwksKeys: Record<string, unknown>[] = [jwkRsa1, jwkEc1];

  beforeAll(async () => {
    jwksServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: currentJwksKeys }));
    });
    await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
    jwksUri = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/jwks`;

    upstream = http.createServer((req, res) => {
      seenHeaders.push(req.headers);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;

    gateway = createGateway({
      auth: {
        providers: [
          createJwksProvider({
            jwksUri,
            roleClaim: 'app_metadata.role',
            cacheTtlMs: 300_000,
          }),
        ],
      },
      routes: [
        {
          prefix: asRoutePrefix('/api'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
          auth: true,
        },
        {
          prefix: asRoutePrefix('/admin'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
          auth: ['admin'],
        },
      ],
    });
    await gateway.listen(0, '127.0.0.1');
    gatewayPort = (gateway.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await gateway.close();
    await Promise.all([
      new Promise<void>((r) => jwksServer.close(() => r())),
      new Promise<void>((r) => upstream.close(() => r())),
    ]);
  });

  it('verifies RS256 tokens and injects identity upstream', async () => {
    const token = signAsymmetricJwt('RS256', rsa.privateKey, {
      sub: 'rsa-user',
      app_metadata: { role: 'user' },
    }, 'rsa-k1');
    const res = await request(gatewayPort, '/api/x', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const seen = seenHeaders[seenHeaders.length - 1];
    expect(seen?.['x-user-id']).toBe('rsa-user');
    expect(seen?.['x-user-role']).toBe('user');
  });

  it('verifies ES256 tokens', async () => {
    const token = signAsymmetricJwt('ES256', ec.privateKey, {
      sub: 'ec-user',
      app_metadata: { role: 'admin' },
    }, 'ec-k1');
    const res = await request(gatewayPort, '/api/x', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const seen = seenHeaders[seenHeaders.length - 1];
    expect(seen?.['x-user-id']).toBe('ec-user');
    expect(seen?.['x-user-role']).toBe('admin');
  });

  it('enforces dot-path RBAC roles (403 vs 200)', async () => {
    const userToken = signAsymmetricJwt('RS256', rsa.privateKey, {
      sub: 'u',
      app_metadata: { role: 'user' },
    }, 'rsa-k1');
    const denied = await request(gatewayPort, '/admin/x', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(denied.status).toBe(403);

    const adminToken = signAsymmetricJwt('RS256', rsa.privateKey, {
      sub: 'a',
      app_metadata: { role: 'admin' },
    }, 'rsa-k1');
    const ok = await request(gatewayPort, '/admin/x', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.status).toBe(200);
  });

  it('rejects tampered signatures with 401', async () => {
    const token = signAsymmetricJwt('RS256', rsa.privateKey, { sub: 'u' }, 'rsa-k1');
    const tampered = `${token.slice(0, -4)}AAAA`;
    const res = await request(gatewayPort, '/api/x', {
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
  });

  it('refreshes JWKS once on unknown kid (key rotation)', async () => {
    // Rotate: drop rsa-k1, add rsa-k2
    currentJwksKeys = [jwkRsa2, jwkEc1];
    const token = signAsymmetricJwt('RS256', rsa2.privateKey, { sub: 'rotated' }, 'rsa-k2');
    const res = await request(gatewayPort, '/api/x', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const seen = seenHeaders[seenHeaders.length - 1];
    expect(seen?.['x-user-id']).toBe('rotated');
  });
});

describe('createIntrospectionProvider + provider chaining', () => {
  let authServer: http.Server;
  let upstream: http.Server;
  let upstreamPort: number;
  let introGateway: Gateway;
  let chainGateway: Gateway;
  let introPort: number;
  let chainPort: number;
  let introspectionHits = 0;
  const store = new InMemoryRedis();

  const customProvider: AuthProvider = {
    name: 'custom-header',
    async authenticate(req) {
      const key = req.headers['x-custom-auth'];
      if (typeof key !== 'string') return { skip: true };
      if (key === 'secret-token') {
        const identity: VerifiedIdentity = { userId: 'custom-user', roles: ['admin'] };
        return { authenticated: true, identity };
      }
      return { authenticated: false, reason: 'bad custom credential' };
    },
  };

  const routes = (port: number): RouteConfig[] => [
    {
      prefix: asRoutePrefix('/me'),
      upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${port}`) }],
      auth: true as const,
    },
    {
      prefix: asRoutePrefix('/admin'),
      upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${port}`) }],
      auth: ['admin'] as const,
    },
  ];

  beforeAll(async () => {
    authServer = http.createServer((req, res) => {
      introspectionHits += 1;
      if (req.headers.authorization === 'Bearer good-token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'sb-user-1',
            email: 'u@example.com',
            app_metadata: { role: 'user' },
          }),
        );
      } else {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid token' }));
      }
    });
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await Promise.all([
      new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r)),
      new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r)),
    ]);
    const authPort = (authServer.address() as AddressInfo).port;
    upstreamPort = (upstream.address() as AddressInfo).port;

    const introspection = createIntrospectionProvider({
      endpoint: `http://127.0.0.1:${authPort}/auth/v1/user`,
      method: 'GET',
      store,
      cacheTtlMs: 60_000,
      mapResponse: (body) => {
        if (typeof body !== 'object' || body === null) return null;
        const b = body as Record<string, unknown>;
        const meta = b['app_metadata'] as Record<string, unknown> | undefined;
        const role = meta?.['role'];
        return {
          userId: String(b['id'] ?? ''),
          roles: typeof role === 'string' ? [role] : [],
        };
      },
    });

    introGateway = createGateway({
      auth: { providers: [introspection] },
      routes: routes(upstreamPort),
    });
    chainGateway = createGateway({
      auth: {
        providers: [customProvider, createJwtProvider({ secret: 'chain-secret' })],
      },
      routes: routes(upstreamPort),
    });
    await Promise.all([introGateway.listen(0, '127.0.0.1'), chainGateway.listen(0, '127.0.0.1')]);
    introPort = (introGateway.server.address() as AddressInfo).port;
    chainPort = (chainGateway.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await Promise.all([introGateway.close(), chainGateway.close()]);
    await Promise.all([
      new Promise<void>((r) => authServer.close(() => r())),
      new Promise<void>((r) => upstream.close(() => r())),
    ]);
  });

  it('introspects Bearer tokens and caches outcomes in GatewayStore', async () => {
    const hitsBefore = introspectionHits;
    const r1 = await request(introPort, '/me', {
      headers: { authorization: 'Bearer good-token' },
    });
    expect(r1.status).toBe(200);
    expect(introspectionHits).toBe(hitsBefore + 1);

    // second request served from InMemoryRedis cache — no upstream call
    const r2 = await request(introPort, '/me', {
      headers: { authorization: 'Bearer good-token' },
    });
    expect(r2.status).toBe(200);
    expect(introspectionHits).toBe(hitsBefore + 1);
  });

  it('rejects bad introspection tokens with 401', async () => {
    const res = await request(introPort, '/me', {
      headers: { authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });

  it('chains custom provider before JWT with RBAC enforcement', async () => {
    // custom provider wins when its header is present
    const custom = await request(chainPort, '/admin/x', {
      headers: { 'x-custom-auth': 'secret-token' },
    });
    expect(custom.status).toBe(200);

    // falls through to JWT provider; role 'user' fails RBAC on /admin
    const userJwt = signJwt({ sub: 'jwt-u', role: 'user' }, 'chain-secret');
    const denied = await request(chainPort, '/admin/x', {
      headers: { authorization: `Bearer ${userJwt}` },
    });
    expect(denied.status).toBe(403);

    const adminJwt = signJwt({ sub: 'jwt-a', role: 'admin' }, 'chain-secret');
    const ok = await request(chainPort, '/admin/x', {
      headers: { authorization: `Bearer ${adminJwt}` },
    });
    expect(ok.status).toBe(200);
  });
});
