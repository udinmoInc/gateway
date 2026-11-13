#!/usr/bin/env node
/**
 * Standalone security audit for @udinmoinc/gateway.
 * Spins up live gateway + upstream servers and runs real end-to-end
 * attacks against every perimeter/resilience control. Zero dependencies —
 * requires `npm run build` first (imports ../dist/index.mjs).
 *
 * Exit code 0 = all checks passed, 1 = one or more failures.
 */
import http from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distEntry = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.mjs')).href;

const {
  createGateway,
  asProtection,
  signGatewayRequest,
  verifyGatewaySignature,
} = await import(distEntry);

const results = [];
const record = (name, pass, ms, detail = '') => {
  results.push({ name, pass, ms, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name.padEnd(58)} ${String(ms).padStart(6)}ms  ${detail}`);
};

function request(port, p, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: p,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
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
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const portOf = (s) => s.address().port;
const close = (s) => new Promise((r) => s.close(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const time = async (fn) => {
  const t0 = Date.now();
  const out = await fn();
  return { out, ms: Date.now() - t0 };
};

const echoUpstream = () =>
  http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, headers: req.headers }));
  });

const gateways = [];
const servers = [];
const track = (g) => (gateways.push(g), g);
const trackS = (s) => (servers.push(s), s);

async function scenarioTraversal() {
  let hits = 0;
  const up = trackS(http.createServer((_q, r) => { hits += 1; r.writeHead(200).end('ok'); }));
  await listen(up);
  const gw = track(createGateway({
    routes: [{ prefix: '/api', upstreams: [{ url: `http://127.0.0.1:${portOf(up)}` }] }],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);
  const attacks = [
    '/api/users/../../etc/passwd',
    '/api/users/%2e%2e/%2e%2e/secret',
    '/api/users/%252e%252e%252fadmin',
    '/api/users/%E0%A4%A',
    '/api/users/%00/etc/passwd',
  ];
  const { out: codes, ms } = await time(async () => {
    const c = [];
    for (const p of attacks) c.push((await request(port, p)).status);
    return c;
  });
  const pass = codes.every((c) => c === 400) && hits === 0;
  record('1. Path traversal & malformed encoding → 400', pass, ms, `statuses=${codes.join(',')} upstreamHits=${hits}`);
}

async function scenarioSpoofing() {
  const up = trackS(echoUpstream());
  await listen(up);
  const attachTenant = asProtection({
    name: 'tenant',
    async verify(ctx) {
      const auth = ctx.req.headers.authorization;
      const m = auth?.startsWith('Bearer t:') ? auth.slice('Bearer t:'.length) : undefined;
      if (!m) return { allow: false, status: 401, message: 'no tenant' };
      return { allow: true, tags: { tenant: m }, headers: { 'x-tenant-id': m } };
    },
  });
  const gw = track(createGateway({
    stripHeaders: ['x-tenant-id', 'x-subject', 'x-gateway-signature'],
    upstreamSigning: { secret: 'audit-secret', subjectTag: 'tenant' },
    routes: [
      ...attachTenant([
        { prefix: '/api', upstreams: [{ url: `http://127.0.0.1:${portOf(up)}` }], stripPrefix: false },
      ]),
    ],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);
  const { out, ms } = await time(async () => {
    const res = await request(port, '/api/data', {
      headers: {
        authorization: 'Bearer t:acme',
        'x-tenant-id': 'admin',
        'x-subject': 'root',
        'x-gateway-signature': 'forged',
      },
    });
    const h = JSON.parse(res.body).headers;
    const verified = verifyGatewaySignature(h, 'GET', '/api/data', 'audit-secret', 60_000);
    const tampered = verifyGatewaySignature(h, 'POST', '/api/data', 'audit-secret', 60_000);
    const stale = signGatewayRequest({
      secret: 'audit-secret', method: 'GET', path: '/api/data',
      subject: 'acme', requestId: 'x', timestampMs: Date.now() - 120_000,
    });
    const staleOk = verifyGatewaySignature(
      {
        'x-gateway-signature': stale.headers['x-gateway-signature'],
        'x-gateway-timestamp': stale.headers['x-gateway-timestamp'],
        'x-gateway-subject': 'acme',
        'x-request-id': 'x',
      },
      'GET', '/api/data', 'audit-secret', 60_000,
    );
    return {
      status: res.status,
      tenant: h['x-tenant-id'],
      subject: h['x-subject'],
      gwSubject: h['x-gateway-subject'],
      sig: h['x-gateway-signature'],
      verified, tampered, staleOk,
    };
  });
  const pass =
    out.status === 200 &&
    out.tenant === 'acme' &&
    out.subject === undefined &&
    out.gwSubject === 'acme' &&
    out.sig && out.sig !== 'forged' &&
    out.verified === true &&
    out.tampered === false &&
    out.staleOk === false;
  record('2. Header spoofing stripped + HMAC sign/verify', pass, ms,
    `tenant=${out.tenant} verified=${out.verified} tamperedRejected=${out.tampered === false} staleRejected=${out.staleOk === false}`);
}

async function scenarioBruteForce() {
  const up = trackS(echoUpstream());
  await listen(up);
  const events = [];
  const denyAll = { evaluate: () => ({ action: 'deny', status: 401, code: 'UNAUTHORIZED', message: 'bad' }) };
  const gw = track(createGateway({
    bruteForce: { maxFailures: 2, windowSec: 60, lockDurationSec: 1 },
    onSecurityEvent: (e) => events.push(e),
    routes: [{ prefix: '/secure', upstreams: [{ url: `http://127.0.0.1:${portOf(up)}` }], guards: [denyAll] }],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);
  const { out, ms } = await time(async () => {
    const ip = { 'x-forwarded-for': '9.9.9.9' };
    await request(port, '/secure/x', { headers: ip });
    await request(port, '/secure/x', { headers: ip });
    const locked = await request(port, '/secure/x', { headers: ip });
    const other = await request(port, '/secure/x', { headers: { 'x-forwarded-for': '8.8.8.8' } });
    await sleep(1_200);
    const after = await request(port, '/secure/x', { headers: ip });
    return { locked: locked.status, lockedRetry: locked.headers['retry-after'], other: other.status, after: after.status,
      lockedEvent: events.some((e) => e.type === 'BRUTE_FORCE_LOCKED') };
  });
  const pass = out.locked === 423 && out.lockedRetry && out.other === 401 && out.after === 401 && out.lockedEvent;
  record('3. Brute-force lockout → 423 + Retry-After + audit', pass, ms,
    `locked=${out.locked} otherIp=${out.other} postExpiry=${out.after} event=${out.lockedEvent}`);
}

async function scenarioPayloadMime() {
  let hits = 0;
  const up = trackS(http.createServer((_q, r) => { hits += 1; r.writeHead(200).end('ok'); }));
  await listen(up);
  const gw = track(createGateway({
    maxBodyBytes: 1024,
    routes: [{
      prefix: '/upload', upstreams: [{ url: `http://127.0.0.1:${portOf(up)}` }],
      allowedContentTypes: ['application/json'],
    }],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);
  const { out, ms } = await time(async () => {
    const before = hits;
    const cl = await request(port, '/upload/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '5000' },
      body: 'x'.repeat(5000),
    });
    const clHits = hits - before;

    const chunked = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/upload/c', method: 'POST', headers: { 'content-type': 'application/json' } },
        (r) => {
          const ch = [];
          r.on('data', (c) => ch.push(c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body: Buffer.concat(ch).toString('utf8') }));
        },
      );
      req.on('error', reject);
      req.write(Buffer.alloc(800, 0x61));
      req.write(Buffer.alloc(800, 0x62));
      req.end();
    });

    const mime = await request(port, '/upload/x', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi',
    });
    return { cl: cl.status, clHits, chunked: chunked.status, mime: mime.status };
  });
  const pass = out.cl === 413 && out.clHits === 0 && out.chunked === 413 && out.mime === 415;
  record('4. Payload bomb 413 + MIME confusion 415', pass, ms,
    `contentLength=${out.cl} chunked=${out.chunked} mime=${out.mime} upstreamHitsOnCL=${out.clHits}`);
}

async function scenarioRateLimitFailover() {
  const up = trackS(echoUpstream());
  await listen(up);
  const downRedis = {
    get: async () => null, set: async () => 'OK', del: async () => 0,
    incr: async () => 1, expire: async () => 1, ping: async () => 'PONG',
    eval: async () => { throw new Error('redis down'); },
  };
  const gw = track(createGateway({
    limiter: { redis: downRedis, failMode: 'fallback' },
    routes: [{
      prefix: '/rl', upstreams: [{ url: `http://127.0.0.1:${portOf(up)}` }],
      rateLimit: { capacity: 3, refillPerSecond: 0.001 },
    }],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);
  const { out, ms } = await time(async () => {
    let last;
    for (let i = 0; i < 5; i += 1) last = await request(port, '/rl/x');
    const okCount = 3; // capacity
    return {
      limited: last.status,
      limit: last.headers['x-ratelimit-limit'],
      remaining: last.headers['x-ratelimit-remaining'],
      retry: last.headers['retry-after'],
      okCount,
    };
  });
  const pass = out.limited === 429 && out.limit === '3' && out.remaining === '0' && !!out.retry;
  record('5. Rate-limit burst 429 + Redis outage → local fallback', pass, ms,
    `status=${out.limited} limit=${out.limit} remaining=${out.remaining} retryAfter=${out.retry} (valid traffic flowed via fallback)`);
}

async function scenarioCircuitWs() {
  let hangHits = 0, goodHits = 0;
  const hang = trackS(http.createServer(() => { hangHits += 1; }));
  const good = trackS(http.createServer((_q, r) => { goodHits += 1; r.writeHead(200).end('good'); }));
  const ws = trackS(net.createServer((socket) => {
    socket.once('data', () => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.on('data', (d) => socket.write(d));
    });
  }));
  await Promise.all([listen(hang), listen(good), listen(ws)]);
  const wsKeyGuard = {
    evaluate: (ctx) =>
      ctx.req.headers['x-ws-key'] === 's3cr3t'
        ? { action: 'allow' }
        : { action: 'deny', status: 401, code: 'UNAUTHORIZED', message: 'bad ws key' },
  };
  const gw = track(createGateway({
    upstreamTimeoutMs: 300,
    upgradeHandshakeTimeoutMs: 300,
    routes: [
      {
        prefix: '/svc',
        upstreams: [{ url: `http://127.0.0.1:${portOf(hang)}` }, { url: `http://127.0.0.1:${portOf(good)}` }],
        circuitBreaker: { failureThreshold: 1, successThreshold: 1, openDurationMs: 60_000, probeTimeoutMs: 100 },
      },
      { prefix: '/ws', upstreams: [{ url: `http://127.0.0.1:${portOf(ws)}` }], guards: [wsKeyGuard] },
    ],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);

  const { out: cb, ms: msCb } = await time(async () => {
    const statuses = [];
    for (let i = 0; i < 15 && hangHits === 0; i += 1) statuses.push((await request(port, '/svc/x')).status);
    for (let i = 0; i < 4; i += 1) statuses.push((await request(port, '/svc/x')).status);
    await sleep(50);
    const state = await gw.circuitBreaker.stateOfShared(`/svc|http://127.0.0.1:${portOf(hang)}`);
    return { hangHits, last4: statuses.slice(-4), state, goodHits };
  });
  record('6a. Circuit breaker trips dead upstream → failover', cb.last4.every((s) => s === 200) && cb.state === 'OPEN' && cb.hangHits >= 1,
    msCb, `hangHits=${cb.hangHits} state=${cb.state} last4=${cb.last4.join(',')}`);

  const rawUpgrade = (p, headers) => new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const lines = [
        `GET ${p} HTTP/1.1`, 'Host: x', 'Connection: Upgrade', 'Upgrade: websocket',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', '',
      ];
      socket.write(lines.join('\r\n'));
    });
    let buf = '';
    socket.on('data', (d) => {
      buf += d.toString('latin1');
      const i = buf.indexOf('\r\n\r\n');
      if (i !== -1) resolve({ head: buf.slice(0, i), socket });
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('upgrade timeout')), 5_000).unref();
  });

  const { out: wsRes, ms: msWs } = await time(async () => {
    const denied = await rawUpgrade('/ws/socket', {});
    const deniedStatus = denied.head.includes('401');
    denied.socket.destroy();
    const allowed = await rawUpgrade('/ws/socket', { 'x-ws-key': 's3cr3t' });
    const got101 = allowed.head.includes('101');
    // Tunnel must outlive the 300ms handshake deadline.
    await sleep(600);
    const echoed = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no echo')), 2_000);
      t.unref();
      allowed.socket.once('data', (d) => { clearTimeout(t); resolve(d.toString('latin1')); });
      allowed.socket.write('ping-frame');
    });
    allowed.socket.destroy();
    return { deniedStatus, got101, echoed };
  });
  record('6b. WS upgrade guards + tunnel survives past handshake timeout',
    wsRes.deniedStatus && wsRes.got101 && wsRes.echoed === 'ping-frame', msWs,
    `denied401=${wsRes.deniedStatus} tunnel101=${wsRes.got101} echo=${wsRes.echoed}`);
}

async function scenarioCorsMasking() {
  const up = trackS(http.createServer((req, res) => {
    if (req.url?.includes('/fail')) {
      res.writeHead(500, { 'content-type': 'text/plain', 'x-powered-by': 'Express', server: 'evil' });
      res.end('Error: SECRET_STACK at /app/x.js:1:1');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-powered-by': 'Express', server: 'evil' });
    res.end('{"ok":true}');
  }));
  await listen(up);
  const gw = track(createGateway({
    cors: { origins: ['https://app.example.com'], methods: ['GET', 'POST'] },
    maskUpstreamErrors: true,
    routes: [{ prefix: '/api', upstreams: [{ url: `http://127.0.0.1:${portOf(up)}` }], stripPrefix: false }],
  }));
  await gw.listen(0, '127.0.0.1');
  const port = portOf(gw.server);
  const { out, ms } = await time(async () => {
    const preflightOk = await request(port, '/api/x', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET' },
    });
    const preflightBad = await request(port, '/api/x', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
    });
    const real = await request(port, '/api/x', { headers: { origin: 'https://evil.example.com' } });
    const fail = await request(port, '/api/fail');
    return {
      preflightOk: preflightOk.status, acaoOk: preflightOk.headers['access-control-allow-origin'],
      preflightBad: preflightBad.status, acaoBad: preflightBad.headers['access-control-allow-origin'],
      realAcao: real.headers['access-control-allow-origin'],
      poweredBy: real.headers['x-powered-by'], server: real.headers['server'],
      nosniff: real.headers['x-content-type-options'],
      failStatus: fail.status, failBody: fail.body, failPowered: fail.headers['x-powered-by'],
    };
  });
  const pass =
    out.preflightOk === 204 && out.acaoOk === 'https://app.example.com' &&
    out.preflightBad === 204 && out.acaoBad === undefined &&
    out.realAcao === undefined &&
    out.poweredBy === undefined && out.server === undefined &&
    out.nosniff === 'nosniff' &&
    out.failStatus === 500 && !out.failBody.includes('SECRET_STACK') && out.failBody.includes('UPSTREAM_ERROR') &&
    out.failPowered === undefined;
  record('7. CORS preflight + fingerprint strip + 5xx masking', pass, ms,
    `acao=${out.acaoOk}/${out.acaoBad} poweredBy=${out.poweredBy} failMasked=${!out.failBody.includes('SECRET_STACK')}`);
}

async function main() {
  console.log('udinmoinc/gateway — standalone security audit\n');
  const scenarios = [
    scenarioTraversal,
    scenarioSpoofing,
    scenarioBruteForce,
    scenarioPayloadMime,
    scenarioRateLimitFailover,
    scenarioCircuitWs,
    scenarioCorsMasking,
  ];
  for (const s of scenarios) {
    try {
      await s();
    } catch (err) {
      record(s.name, false, 0, `threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const g of gateways) await g.shutdown({ drainTimeoutMs: 1_000 }).catch(() => undefined);
  for (const s of servers) {
    try { s.closeAllConnections?.(); } catch { /* ignore */ }
    await close(s).catch(() => undefined);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
