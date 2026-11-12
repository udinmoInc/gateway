import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/GatewayEngine.js';
import type { Gateway } from '../src/core/GatewayEngine.js';
import {
  hashApiKey,
  signGatewayRequest,
  verifyGatewaySignature,
} from '../src/index.js';
import type { ApiKeyProvider, ApiKeyRecord, SecurityAuditEvent } from '../src/index.js';
import { asRoutePrefix, asUpstreamUrl } from '../src/index.js';

function request(
  port: number,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    rawPath?: string;
  } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: options.rawPath ?? path,
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

describe('UpstreamSigner', () => {
  const secret = 'signing-secret';

  it('signs and verifies a gateway request', () => {
    const signed = signGatewayRequest({
      secret,
      method: 'GET',
      path: '/api/x',
      userId: 'u1',
      requestId: 'req-1',
    });
    const headers = {
      'x-gateway-signature': signed.headers['x-gateway-signature'] as string,
      'x-gateway-timestamp': signed.headers['x-gateway-timestamp'] as string,
      'x-user-id': 'u1',
      'x-request-id': 'req-1',
    };
    expect(
      verifyGatewaySignature(headers, 'GET', '/api/x', secret, 60_000),
    ).toBe(true);
  });

  it('rejects tampered payloads and expired timestamps', () => {
    const old = signGatewayRequest({
      secret,
      method: 'GET',
      path: '/api/x',
      userId: '',
      requestId: 'r',
      timestampMs: Date.now() - 120_000,
    });
    const headers = {
      'x-gateway-signature': old.headers['x-gateway-signature'] as string,
      'x-gateway-timestamp': old.headers['x-gateway-timestamp'] as string,
      'x-request-id': 'r',
    };
    expect(verifyGatewaySignature(headers, 'GET', '/api/x', secret, 60_000)).toBe(false);
    expect(verifyGatewaySignature(headers, 'POST', '/api/x', secret, 300_000)).toBe(false);
    expect(verifyGatewaySignature(headers, 'GET', '/api/y', secret, 300_000)).toBe(false);
    expect(verifyGatewaySignature({}, 'GET', '/api/x', secret)).toBe(false);
  });
});

describe('perimeter hardening', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let gateway: Gateway;
  let gatewayPort: number;
  const events: SecurityAuditEvent[] = [];

  const keys = new Map<string, ApiKeyRecord>([
    [
      hashApiKey('good-key'),
      {
        id: 'k1',
        keyHash: hashApiKey('good-key'),
        tenantId: 't1',
        scopes: ['read'],
        expiresAtMs: Date.now() + 3_600_000,
      },
    ],
    [
      hashApiKey('write-key'),
      {
        id: 'k2',
        keyHash: hashApiKey('write-key'),
        tenantId: 't1',
        scopes: ['write'],
      },
    ],
    [
      hashApiKey('expired-key'),
      {
        id: 'k3',
        keyHash: hashApiKey('expired-key'),
        tenantId: 't1',
        scopes: ['read'],
        expiresAtMs: Date.now() - 1_000,
      },
    ],
  ]);
  const provider: ApiKeyProvider = {
    resolveByHash: async (h) => keys.get(h) ?? null,
  };

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url === '/fail') {
        res.writeHead(500, {
          'content-type': 'text/plain',
          'x-powered-by': 'SecretFramework/9.9',
          server: 'nginx-secret',
        });
        res.end('INTERNAL_STACK_TRACE_DO_NOT_LEAK');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-powered-by': 'UpstreamX' });
      res.end(JSON.stringify({ ok: true, url: req.url, headers: req.headers }));
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as AddressInfo).port;

    gateway = createGateway({
      upstreamSigning: { secret: 'gw-hmac-secret' },
      apiKeys: { provider },
      bruteForce: { maxFailures: 2, windowSec: 60, lockDurationSec: 60 },
      auth: { jwt: { secret: 'jwt-secret' } },
      cors: {
        origins: ['https://app.example.com'],
        credentials: true,
        methods: ['GET', 'POST'],
        headers: ['content-type'],
      },
      maskUpstreamErrors: true,
      healthPath: asRoutePrefix('/healthz'),
      maxBodyBytes: 1024,
      routes: [
        {
          prefix: asRoutePrefix('/open'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
        },
        {
          prefix: asRoutePrefix('/api'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
          requiredScopes: ['read'],
          allowedContentTypes: ['application/json'],
        },
        {
          prefix: asRoutePrefix('/masked'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
        },
        {
          prefix: asRoutePrefix('/private'),
          upstreams: [{ url: asUpstreamUrl(`http://127.0.0.1:${upstreamPort}`) }],
          auth: true,
        },
      ],
      plugins: [
        {
          name: 'deny-blocked',
          onRequest: (ctx) =>
            ctx.req.url?.includes('/blocked')
              ? { action: 'deny', statusCode: 403, code: 'POLICY_DENIED', message: 'blocked by plugin' }
              : undefined,
        },
      ],
      onSecurityEvent: (e) => events.push(e),
    });
    await gateway.listen(0, '127.0.0.1');
    gatewayPort = (gateway.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it('HMAC-signs proxied requests verifiable by downstream services', async () => {
    const res = await request(gatewayPort, '/open/signed?q=1');
    expect(res.status).toBe(200);
    const echoed = JSON.parse(res.body) as { headers: Record<string, string> };
    const h = echoed.headers;
    expect(h['x-gateway-signature']).toBeTruthy();
    expect(h['x-gateway-timestamp']).toBeTruthy();
    // path forwarded is '/signed?q=1' (prefix stripped)
    expect(
      verifyGatewaySignature(h, 'GET', '/signed?q=1', 'gw-hmac-secret', 60_000),
    ).toBe(true);
    expect(h['x-request-id']).toBeTruthy();
  });

  it('strips upstream fingerprint headers', async () => {
    const res = await request(gatewayPort, '/open/fp');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['server']).toBeUndefined();
    // security headers present
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('masks upstream 5xx bodies when maskUpstreamErrors', async () => {
    const res = await request(gatewayPort, '/masked/fail');
    expect(res.status).toBe(500);
    expect(res.body).not.toContain('INTERNAL_STACK_TRACE');
    expect(res.body).toContain('UPSTREAM_ERROR');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('blocks path traversal with 400', async () => {
    const res = await request(gatewayPort, '/x', { rawPath: '/../etc/passwd' });
    expect(res.status).toBe(400);
    expect(res.body).toContain('PATH_TRAVERSAL_BLOCKED');
    const res2 = await request(gatewayPort, '/x', { rawPath: '/%2e%2e/secret' });
    expect(res2.status).toBe(400);
  });

  it('rejects oversized bodies with 413 (content-length and chunked)', async () => {
    const big = 'x'.repeat(2048);
    const res = await request(gatewayPort, '/open/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '2048' },
      body: big,
    });
    expect(res.status).toBe(413);
    expect(res.body).toContain('PAYLOAD_TOO_LARGE');
  });

  it('enforces allowedContentTypes with 415', async () => {
    const res = await request(gatewayPort, '/api/data', {
      method: 'POST',
      headers: { 'x-api-key': 'good-key', 'content-type': 'text/plain' },
      body: 'hi',
    });
    expect(res.status).toBe(415);
    expect(res.body).toContain('UNSUPPORTED_MEDIA_TYPE');
  });

  it('handles CORS preflight with 204 and injects CORS headers', async () => {
    const pre = await request(gatewayPort, '/open/x', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(pre.headers['access-control-allow-credentials']).toBe('true');

    const res = await request(gatewayPort, '/open/x', {
      headers: { origin: 'https://app.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const badOrigin = await request(gatewayPort, '/open/x', {
      headers: { origin: 'https://evil.example.com' },
    });
    expect(badOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('denies requests via GatewayPlugin policy', async () => {
    const res = await request(gatewayPort, '/open/blocked');
    expect(res.status).toBe(403);
    expect(res.body).toContain('POLICY_DENIED');
  });

  it('API keys: 401 missing/invalid/expired, 403 scope, 200 valid', async () => {
    // distinct XFF IPs per attempt so brute-force buckets stay isolated
    const missing = await request(gatewayPort, '/api/data', {
      headers: { 'x-forwarded-for': '10.9.9.11' },
    });
    expect(missing.status).toBe(401);
    expect(missing.body).toContain('API_KEY_INVALID');

    const invalid = await request(gatewayPort, '/api/data', {
      headers: { 'x-api-key': 'nope', 'x-forwarded-for': '10.9.9.12' },
    });
    expect(invalid.status).toBe(401);

    const expired = await request(gatewayPort, '/api/data', {
      headers: { 'x-api-key': 'expired-key', 'x-forwarded-for': '10.9.9.13' },
    });
    expect(expired.status).toBe(401);

    const wrongScope = await request(gatewayPort, '/api/data', {
      headers: {
        'x-api-key': 'write-key',
        'content-type': 'application/json',
        'x-forwarded-for': '10.9.9.14',
      },
      method: 'POST',
      body: '{}',
    });
    expect(wrongScope.status).toBe(403);

    const ok = await request(gatewayPort, '/api/data', {
      headers: { 'x-api-key': 'good-key' },
    });
    expect(ok.status).toBe(200);
  });

  it('brute-force lockout: 401s then 423 Locked with Retry-After', async () => {
    const eventsBefore = events.length;
    const ip = { 'x-forwarded-for': '10.9.9.2' };
    // /private requires auth; no credentials → 401 + failure count
    const r1 = await request(gatewayPort, '/private/x', { headers: ip });
    expect(r1.status).toBe(401);
    const r2 = await request(gatewayPort, '/private/x', { headers: ip });
    expect(r2.status).toBe(401);
    // third request hits the lock
    const r3 = await request(gatewayPort, '/private/x', { headers: ip });
    expect(r3.status).toBe(423);
    expect(r3.headers['retry-after']).toBeTruthy();
    expect(r3.body).toContain('LOCKED');
    const locked = events.slice(eventsBefore).some((e) => e.type === 'BRUTE_FORCE_LOCKED');
    expect(locked).toBe(true);
  });

  it('/healthz returns 200 when the store is healthy', async () => {
    const res = await request(gatewayPort, '/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toContain('"ok"');
  });
});

describe('healthPath with closed failMode', () => {
  it('returns 503 when failMode is closed and store ping fails', async () => {
    const deadStore = {
      eval: async () => {
        throw new Error('redis down');
      },
      ping: async () => {
        throw new Error('redis down');
      },
    };
    const gw = createGateway({
      healthPath: asRoutePrefix('/healthz'),
      limiter: { redis: deadStore, failMode: 'closed' },
      routes: [],
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    const res = await request(port, '/healthz');
    expect(res.status).toBe(503);
    await gw.close();
  });
});

describe('SSRF upstream guard', () => {
  it('rejects metadata upstreams at boot', () => {
    expect(() =>
      createGateway({
        routes: [
          {
            prefix: asRoutePrefix('/meta'),
            upstreams: [{ url: asUpstreamUrl('http://169.254.169.254/latest') }],
          },
        ],
      }),
    ).toThrow(/link-local\/metadata/);
  });

  it('allows them with allowMetadataUpstreams', () => {
    const gw = createGateway({
      allowMetadataUpstreams: true,
      routes: [
        {
          prefix: asRoutePrefix('/meta'),
          upstreams: [{ url: asUpstreamUrl('http://169.254.169.254/latest') }],
        },
      ],
    });
    expect(gw).toBeDefined();
    void gw.close();
  });
});

describe('signGatewayRequest determinism', () => {
  it('produces stable HMAC for fixed inputs', () => {
    const a = signGatewayRequest({
      secret: 's',
      method: 'post',
      path: '/p',
      userId: 'u',
      requestId: 'r',
      timestampMs: 1000,
    });
    const expected = createHmac('sha256', 's')
      .update('1000.POST./p.u.r')
      .digest('hex');
    expect(a.headers['x-gateway-signature']).toBe(expected);
  });
});
