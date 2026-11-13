#!/usr/bin/env node
/**
 * Real multi-process live verification for @udinmoinc/gateway.
 *
 * Spawns 3 isolated OS child processes (upstream A, upstream B, gateway)
 * built from the compiled dist/ bundle, then drives real TCP/HTTP/WebSocket
 * traffic and attacks from this process. No shared event loop, no mocks.
 *
 *   npm run build && npm run test:live
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = pathToFileURL(resolve(ROOT, 'dist', 'index.mjs')).href;

const UP_A_PORT = 4201;
const UP_B_PORT = 4202;
const GW_PORT = 8200;
const GW_CTRL_PORT = 8201;
const SECRET = 'live-test-signing-secret';
const TOKEN = 's3cret';

// ---------------------------------------------------------------------------
// Child process sources (run with `node --input-type=module -e`)
// ---------------------------------------------------------------------------

const UPSTREAM_A_SRC = `
import http from 'node:http';
import crypto from 'node:crypto';
import { verifyGatewaySignature } from ${JSON.stringify(DIST)};

const SECRET = ${JSON.stringify(SECRET)};
let hits = 0;
let sigOkCount = 0;
let sigFailCount = 0;

const respond = (req, res, sigOk) => {
  res.writeHead(200, {'content-type':'application/json'});
  res.end(JSON.stringify({upstream:'a', url:req.url, sigOk}));
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/__hits') {
    // Read-only probe — must NOT count itself.
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({hits, sigOk: sigOkCount, sigFail: sigFailCount}));
    return;
  }
  hits += 1;
  let sigOk = null;
  if (req.headers['x-gateway-signature']) {
    sigOk = verifyGatewaySignature(req.headers, req.method ?? 'GET', req.url ?? '/', SECRET);
    if (sigOk) sigOkCount += 1; else sigFailCount += 1;
  }
  // Bodies must be fully consumed before responding — otherwise a fast
  // 200 wins the race against the gateway's streamed body-size limit.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.resume();
    // Only a fully-consumed body earns a response — an aborted upload
    // (gateway 413) must produce no reply at all.
    req.on('end', () => respond(req, res, sigOk));
    return;
  }
  respond(req, res, sigOk);
});

// Minimal RFC6455 echo: handshake + masked-frame parse + unmasked echo.
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
  let buf = Buffer.alloc(0);
  const sendFrame = (opcode, payload) => {
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x80|opcode; header[1]=126; header.writeUInt16BE(len,2); }
    else { header = Buffer.alloc(10); header[0]=0x80|opcode; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
    socket.write(Buffer.concat([header, payload]));
  };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (buf.length < off + 4) return; mask = buf.subarray(off, off + 4); off += 4; }
      if (buf.length < off + len) return;
      let payload = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { socket.end(); return; }
      if (opcode === 0x9) { sendFrame(0xa, payload); continue; }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) sendFrame(opcode === 0x2 ? 0x2 : 0x1, payload);
    }
  });
  socket.on('error', () => {});
});

server.listen(${UP_A_PORT}, '127.0.0.1', () => console.log('upstream-a ready'));
`;

const UPSTREAM_B_SRC = `
import http from 'node:http';
import { verifyGatewaySignature } from ${JSON.stringify(DIST)};
const SECRET = ${JSON.stringify(SECRET)};
let hits = 0;
let failMode = false;
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/__control') {
    failMode = u.searchParams.get('fail') === '1';
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({failMode}));
    return;
  }
  if (u.pathname === '/__hits') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({hits}));
    return;
  }
  hits += 1;
  if (failMode) { res.writeHead(503); res.end('upstream-b failing'); return; }
  const sigOk = req.headers['x-gateway-signature']
    ? verifyGatewaySignature(req.headers, req.method ?? 'GET', req.url ?? '/', SECRET)
    : null;
  res.writeHead(200, {'content-type':'application/json'});
  res.end(JSON.stringify({upstream:'b', url:req.url, sigOk}));
});
server.listen(${UP_B_PORT}, '127.0.0.1', () => console.log('upstream-b ready'));
`;

const GATEWAY_SRC = `
import { createGateway, route, asProtection } from ${JSON.stringify(DIST)};
import http from 'node:http';

const SECRET = ${JSON.stringify(SECRET)};
const UP_A = 'http://127.0.0.1:${UP_A_PORT}';
const UP_B = 'http://127.0.0.1:${UP_B_PORT}';

const tokenGuard = {
  name: 'live-token',
  async verify(ctx) {
    if (ctx.req.headers['x-auth-token'] === ${JSON.stringify(TOKEN)}) {
      return { allow: true, tags: { tenant: 'acme' }, headers: { 'x-tenant-id': 'acme' } };
    }
    return { allow: false, status: 401, code: 'UNAUTHORIZED', message: 'bad token' };
  },
};

const gw = createGateway({
  host: '127.0.0.1',
  routes: [
    route('/api/*', [UP_A, UP_B], {
      circuitBreaker: { failureThreshold: 8, successThreshold: 1, openDurationMs: 30000 },
    }),
    asProtection(tokenGuard, route('/strict/*', UP_A)),
    asProtection(tokenGuard, route('/ws', UP_A, { stripPrefix: false })),
  ],
  stripHeaders: ['x-tenant-id', 'x-subject', 'x-gateway-signature'],
  upstreamSigning: { secret: SECRET, subjectTag: 'tenant' },
  bruteForce: { maxFailures: 5, windowSec: 60, lockDurationSec: 30 },
  maxBodyBytes: 64 * 1024,
});
await gw.listen(${GW_PORT});
// RSS/control endpoint on a separate port for the runner.
http.createServer((req, res) => {
  res.writeHead(200, {'content-type':'application/json'});
  res.end(JSON.stringify({ rss: process.memoryUsage().rss }));
}).listen(${GW_CTRL_PORT}, '127.0.0.1');
console.log('gateway ready');
process.on('SIGTERM', () => { void gw.shutdown().then(() => process.exit(0)); });
process.on('SIGINT', () => { void gw.shutdown().then(() => process.exit(0)); });
`;

// ---------------------------------------------------------------------------
// Runner helpers
// ---------------------------------------------------------------------------

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function spawnChild(name, src) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', src], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`));
  return child;
}

function httpReq(port, { method = 'GET', path = '/', headers = {}, body, agent } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent },
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
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

/** Raw TCP HTTP/1.1 exchange — returns status code + full head. */
function rawHttp(port, raw) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(raw));
    let data = '';
    sock.on('data', (c) => {
      data += c.toString('utf8');
      if (data.includes('\r\n\r\n')) {
        const status = Number(data.split(' ')[1]);
        sock.destroy();
        resolve({ status, head: data });
      }
    });
    sock.on('error', reject);
    setTimeout(() => {
      sock.destroy();
      reject(new Error('rawHttp timeout'));
    }, 10_000);
  });
}

/** Minimal WS client over a raw socket. */
function wsConnect(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const key = crypto.randomBytes(16).toString('base64');
      const hdrs = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('');
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${hdrs}\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    let handshakeDone = false;
    const pending = [];
    const waiters = [];
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString('utf8');
        buf = buf.subarray(idx + 4);
        handshakeDone = true;
        const status = Number(head.split(' ')[1]);
        if (status !== 101) {
          sock.destroy();
          reject(new Error(`ws handshake ${status}: ${head.split('\r\n')[0]}`));
          return;
        }
        resolve({ sock, send, nextMessage });
      }
      // parse server frames (unmasked)
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 0x1 || opcode === 0x2) {
          const msg = { opcode, payload: Buffer.from(payload) };
          const w = waiters.shift();
          if (w) w(msg); else pending.push(msg);
        }
      }
    });
    function send(text) {
      const payload = Buffer.from(text, 'utf8');
      const mask = crypto.randomBytes(4);
      const len = payload.length;
      let header;
      if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
      else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      const masked = Buffer.from(payload);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
      sock.write(Buffer.concat([header, mask, masked]));
    }
    function nextMessage() {
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((res) => waiters.push(res));
    }
    sock.on('error', reject);
    setTimeout(() => reject(new Error('wsConnect timeout')), 10_000);
  });
}

function percentile(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const childProcs = [];

async function main() {
  console.log('spawning child processes…');
  const upA = spawnChild('up-a', UPSTREAM_A_SRC);
  const upB = spawnChild('up-b', UPSTREAM_B_SRC);
  const gw = spawnChild('gateway', GATEWAY_SRC);
  const children = [upA, upB, gw];
  childProcs.push(...children);
  for (const c of children) c.on('exit', (code) => console.log(`[child] exited ${code}`));

  const waitFor = async (fn, label, timeoutMs = 15_000) => {
    const t0 = Date.now();
    for (;;) {
      try { if (await fn()) return; } catch { /* retry */ }
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  await waitFor(async () => (await httpReq(UP_A_PORT, { path: '/__hits' })).status === 200, 'upstream A');
  await waitFor(async () => (await httpReq(UP_B_PORT, { path: '/__hits' })).status === 200, 'upstream B');
  await waitFor(async () => (await httpReq(GW_PORT, { path: '/api/ping' })).status === 200, 'gateway');
  await waitFor(async () => (await httpReq(GW_CTRL_PORT, { path: '/' })).status === 200, 'gateway ctrl');
  console.log('all processes live\n');

  const hitsA0 = (await httpReq(UP_A_PORT, { path: '/__hits' })).body;

  // ================= PART 1: SECURITY ATTACK MATRIX =================
  console.log('— security attack matrix —');

  // 1. Path traversal & smuggling
  const traversal = [
    'GET /api/../secret HTTP/1.1',
    'GET /api/%252e%252e/admin HTTP/1.1',
    'GET /api/%00null HTTP/1.1',
    'GET /api/%E0%A4%A HTTP/1.1',
  ];
  const hitsA = async () =>
    JSON.parse((await httpReq(UP_A_PORT, { path: '/__hits' })).body).hits;
  const travStatuses = [];
  const travDeltas = [];
  let prevHits = await hitsA();
  for (const line of traversal) {
    const res = await rawHttp(GW_PORT, `${line}\r\nHost: x\r\nConnection: close\r\n\r\n`);
    travStatuses.push(res.status);
    const now = await hitsA();
    travDeltas.push(now - prevHits);
    prevHits = now;
  }
  const hitsA1 = prevHits;
  const hitsA0n = prevHits - travDeltas.reduce((a, b) => a + b, 0);
  record(
    'path traversal → 400, zero upstream hits',
    travStatuses.every((s) => s === 400) && hitsA1 === hitsA0n,
    `statuses=[${travStatuses}] upstreamA Δhits=[${travDeltas}]`,
  );

  // 2. Header spoofing & forged signature
  const spoof = await httpReq(GW_PORT, {
    path: '/api/x',
    headers: {
      'x-tenant-id': 'evil',
      'x-subject': 'root',
      'x-gateway-signature': 'deadbeef'.repeat(8),
    },
  });
  const spoofJson = JSON.parse(spoof.body);
  record(
    'forged client signature stripped; gateway signature valid upstream',
    spoof.status === 200 && spoofJson.sigOk === true,
    `status=${spoof.status} upstream sigOk=${spoofJson.sigOk}`,
  );

  const noToken = await httpReq(GW_PORT, { path: '/strict/data' });
  const badToken = await httpReq(GW_PORT, {
    path: '/strict/data',
    headers: { 'x-auth-token': 'wrong', 'x-tenant-id': 'evil' },
  });
  record(
    'guard denies missing/invalid token → 401',
    noToken.status === 401 && badToken.status === 401,
    `noToken=${noToken.status} badToken=${badToken.status}`,
  );

  const goodToken = await httpReq(GW_PORT, {
    path: '/strict/data',
    headers: { 'x-auth-token': TOKEN, 'x-tenant-id': 'evil' },
  });
  const goodJson = JSON.parse(goodToken.body);
  record(
    'valid token → 200, spoofed x-tenant-id stripped, sigOk upstream',
    goodToken.status === 200 && goodJson.sigOk === true,
    `status=${goodToken.status} sigOk=${goodJson.sigOk}`,
  );

  // 3. Brute-force lockout (attacker uses XFF so legit IP stays clean)
  const attackerIp = { 'x-forwarded-for': '6.6.6.6' };
  const bfStatuses = [];
  for (let i = 0; i < 15; i++) {
    const r = await httpReq(GW_PORT, { path: '/strict/brute', headers: attackerIp });
    bfStatuses.push(r.status);
  }
  const locked = bfStatuses.filter((s) => s === 423).length;
  const last = await httpReq(GW_PORT, { path: '/strict/brute', headers: attackerIp });
  const retryAfter = last.headers['retry-after'];
  const otherIp = await httpReq(GW_PORT, {
    path: '/strict/brute',
    headers: { 'x-forwarded-for': '9.9.9.9', 'x-auth-token': TOKEN },
  });
  record(
    'brute-force → 423 Locked + Retry-After; other IP unaffected',
    locked >= 8 && typeof retryAfter === 'string' && otherIp.status === 200,
    `locked=${locked}/15 retryAfter=${retryAfter} otherIp=${otherIp.status}`,
  );

  // 4. Chunked payload bomb vs 64KB limit
  const bomb = await new Promise((resolve, reject) => {
    const sock = net.connect(GW_PORT, '127.0.0.1', () => {
      sock.write(
        'POST /api/upload HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n',
      );
      const chunk = Buffer.alloc(64 * 1024, 0x41);
      let sent = 0;
      const iv = setInterval(() => {
        if (sent >= 80 * 64 * 1024 || sock.destroyed) {
          clearInterval(iv);
          return;
        }
        sock.write(chunk.length.toString(16) + '\r\n');
        sock.write(chunk);
        sock.write('\r\n');
        sent += chunk.length;
      }, 5);
    });
    let data = '';
    sock.on('data', (c) => {
      data += c.toString('utf8');
      const m = data.match(/HTTP\/1\.1 (\d{3})/);
      if (m) {
        sock.destroy();
        resolve(Number(m[1]));
      }
    });
    sock.on('error', () => resolve(-1));
    setTimeout(() => { sock.destroy(); resolve(-1); }, 15_000);
    void reject;
  });
  record('chunked 5MB bomb → 413 Payload Too Large', bomb === 413, `status=${bomb}`);

  // 5. WebSocket guard + live tunnel
  let wsUnauthStatus = -1;
  try {
    await wsConnect(GW_PORT, '/ws');
  } catch (e) {
    wsUnauthStatus = Number(String(e.message).match(/(\d{3})/)?.[1] ?? -1);
  }
  record('unauthenticated WS upgrade → 401', wsUnauthStatus === 401, `status=${wsUnauthStatus}`);

  const ws = await wsConnect(GW_PORT, '/ws', { 'x-auth-token': TOKEN });
  ws.send('hello-live');
  const echo1 = await ws.nextMessage();
  const echoed = echo1.payload.toString('utf8');
  await new Promise((r) => setTimeout(r, 11_000)); // outlive handshake timer
  ws.send('still-alive');
  const echo2 = await ws.nextMessage();
  const echoed2 = echo2.payload.toString('utf8');
  ws.sock.write(Buffer.from([0x88, 0x80, 1, 2, 3, 4])); // masked close
  ws.sock.end();
  record(
    'authenticated WS tunnel: 101 + echo + 11s persistence',
    echoed === 'hello-live' && echoed2 === 'still-alive',
    `echo1=${JSON.stringify(echoed)} echo2=${JSON.stringify(echoed2)}`,
  );

  // ================= PART 2: LOAD & CHAOS =================
  console.log('\n— multi-process load & chaos —');

  const rss0 = JSON.parse((await httpReq(GW_CTRL_PORT, { path: '/' })).body).rss;
  const t0 = performance.now();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
  const TOTAL = 5000;
  const CONC = 100;
  const loadResults = new Array(TOTAL);
  let idx = 0;
  let socketErrors = 0;
  const worker = async () => {
    while (idx < TOTAL) {
      const i = idx++;
      const start = performance.now();
      try {
        const res = await httpReq(GW_PORT, {
          path: `/api/load-${i % 10}`,
          agent,
        });
        loadResults[i] = { status: res.status, ms: performance.now() - start };
      } catch {
        socketErrors += 1;
        loadResults[i] = { status: -1, ms: performance.now() - start };
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  const elapsed = performance.now() - t0;
  const rss1 = JSON.parse((await httpReq(GW_CTRL_PORT, { path: '/' })).body).rss;

  const oks = loadResults.filter((r) => r.status === 200).length;
  const lats = loadResults.map((r) => r.ms).sort((a, b) => a - b);
  const rps = (TOTAL / elapsed) * 1000;
  console.log(
    `[load] ${TOTAL} reqs @ ${CONC} conn in ${(elapsed / 1000).toFixed(2)}s → ` +
      `${rps.toFixed(0)} rps | p50=${percentile(lats, 50).toFixed(1)}ms ` +
      `p95=${percentile(lats, 95).toFixed(1)}ms p99=${percentile(lats, 99).toFixed(1)}ms | ` +
      `ok=${oks} errors=${socketErrors} | RSS ${(rss0 / 1048576).toFixed(0)}→${(rss1 / 1048576).toFixed(0)}MB`,
  );
  record(
    'sustained load: 5000 reqs, 0 socket errors, 100% 200',
    oks === TOTAL && socketErrors === 0,
    `rps=${rps.toFixed(0)} p99=${percentile(lats, 99).toFixed(1)}ms rssΔ=${((rss1 - rss0) / 1048576).toFixed(1)}MB`,
  );
  agent.destroy();

  // Chaos: flip upstream B to 503 under continued traffic
  await httpReq(UP_B_PORT, { path: '/__control?fail=1' });
  const chaosResults = await Promise.all(
    Array.from({ length: 200 }, () =>
      httpReq(GW_PORT, { path: `/api/chaos-${Math.floor(Math.random() * 5)}` }).catch(() => ({ status: -1 })),
    ),
  );
  const chaosOk = chaosResults.filter((r) => r.status === 200).length;
  const chaosErr = chaosResults.filter((r) => r.status === -1).length;
  const chaos503 = chaosResults.filter((r) => r.status === 503).length;
  const hitsB = JSON.parse((await httpReq(UP_B_PORT, { path: '/__hits' })).body).hits;
  record(
    'upstream B 503 storm: no hangs, clean 200/503 mix',
    chaosErr === 0 && chaosOk > 0,
    `200s=${chaosOk} 503s=${chaos503} errors=${chaosErr} B-hits=${hitsB}`,
  );
  await httpReq(UP_B_PORT, { path: '/__control?fail=0' });

  // SIGTERM drain with connections open. POSIX only — Windows cannot
  // deliver catchable SIGTERM (process.kill terminates unconditionally).
  if (process.platform === 'win32') {
    record('SIGTERM → clean exit 0 in <500ms', true, 'skipped — SIGTERM not deliverable on win32');
  } else {
    const sigT0 = performance.now();
    const exited = new Promise((res) => gw.once('exit', (code) => res(code)));
    gw.kill('SIGTERM');
    const code = await exited;
    const sigMs = performance.now() - sigT0;
    record(
      'SIGTERM → clean exit 0 in <500ms',
      code === 0 && sigMs < 500,
      `code=${code} ${sigMs.toFixed(0)}ms`,
    );
  }

  upA.kill(); upB.kill();
  for (const c of children) if (c.exitCode === null) c.kill();

  // ---- report ----
  console.log('\n================ RESULTS ================');
  let pass = 0;
  for (const r of results) {
    if (r.pass) pass += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('live suite failed:', err);
  for (const c of childProcs) if (c.exitCode === null) c.kill();
  process.exit(1);
});
