import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import Fastify from 'fastify';
import { createGateway } from '../src/core/GatewayEngine.js';
import type { GatewayConfig } from '../src/types.js';
import { gatewayMiddleware } from '../src/adapters/express.js';
import { registerGateway } from '../src/adapters/fastify.js';
import { createFetchGateway } from '../src/adapters/fetch.js';

const closeServer = (s: http.Server | express.Express | undefined): Promise<void> =>
  new Promise((r) => {
    if (s === undefined) return r();
    const srv = s as unknown as http.Server;
    // Keep-alive client sockets would otherwise stall close().
    srv.closeAllConnections?.();
    srv.close(() => r());
  });

function echoServer(): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          url: req.url,
          method: req.method ?? 'GET',
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
  });
}

function binaryServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.from([0, 1, 2, 250, 255]));
  });
}

const get = (
  port: number,
  path: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }),
      );
    });
    r.on('error', reject);
    r.end();
  });

let upstream: http.Server;
let upstreamPort: number;
let servers: http.Server[] = [];

beforeAll(async () => {
  upstream = echoServer();
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = (upstream.address() as AddressInfo).port;
});

afterAll(async () => {
  await Promise.all([closeServer(upstream), ...servers.map(closeServer)]);
});

async function withGateway(
  config: GatewayConfig,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const gw = createGateway(config);
  await gw.listen(0, '127.0.0.1');
  const port = (gw.server.address() as AddressInfo).port;
  try {
    await fn(port);
  } finally {
    await gw.close();
  }
}

// ---------- 1. target + basePrefix parity across entry points ----------
describe('entry-point parity: target & basePrefix', () => {
  it('standalone: { target, rateLimit } catch-all works', async () => {
    await withGateway(
      { target: upstreamPort, rateLimit: '60/min' },
      async (port) => {
        const res = await get(port, '/deep/path?q=1');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).url).toBe('/deep/path?q=1');
      },
    );
  });

  it('standalone: basePrefix with trailing slash normalizes', async () => {
    await withGateway(
      { basePrefix: '/api/', routes: { '/users': upstreamPort } },
      async (port) => {
        expect((await get(port, '/api/users/x')).status).toBe(200);
        expect((await get(port, '/users/x')).status).toBe(404);
      },
    );
  });

  it('express: target shorthand + basePrefix', async () => {
    const app = express();
    app.use(
      gatewayMiddleware({
        target: upstreamPort,
        basePrefix: '/api/',
        rateLimit: '60/min',
      }),
    );
    const srv = app.listen(0, '127.0.0.1');
    servers.push(srv);
    await new Promise<void>((r) => srv.once('listening', r));
    const port = (srv.address() as AddressInfo).port;
    expect((await get(port, '/api/anything')).status).toBe(200);
    expect((await get(port, '/other')).status).toBe(404);
  });

  it('fastify: target shorthand + basePrefix', async () => {
    const app = Fastify();
    registerGateway(app, {
      target: upstreamPort,
      basePrefix: '/api',
      rateLimit: '60/min',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app.server);
    const port = (app.server.address() as AddressInfo).port;
    expect((await get(port, '/api/x')).status).toBe(200);
    await app.close();
  });

  it('fetch: target shorthand + basePrefix', async () => {
    const gw = createFetchGateway({
      target: upstreamPort,
      basePrefix: '/api',
    });
    const res = await gw(new Request('http://localhost/api/fetch'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    // basePrefix '/api' matched and stripped → upstream sees '/fetch'.
    expect(json.url).toBe('/fetch');
    const miss = await gw(new Request('http://localhost/other'));
    expect(miss.status).toBe(404);
  });
});

// ---------- 2. reloadRoutes preserves basePrefix & global defaults ----------
describe('reloadRoutes parity', () => {
  it('options-form reload applies basePrefix + target defaults like boot', async () => {
    const gw = createGateway({
      basePrefix: '/api',
      target: upstreamPort,
      rateLimit: '60/min',
    });
    await gw.listen(0, '127.0.0.1');
    const port = (gw.server.address() as AddressInfo).port;
    try {
      // Plain routes reload still gets basePrefix.
      gw.reloadRoutes({ '/v2': upstreamPort });
      expect((await get(port, '/api/v2/x')).status).toBe(200);
      expect((await get(port, '/v2/x')).status).toBe(404);
      // Options form with a new target → catch-all under /api.
      gw.reloadRoutes({ target: upstreamPort, rateLimit: '30/min' });
      expect((await get(port, '/api/anything')).status).toBe(200);
      expect((await get(port, '/anything')).status).toBe(404);
    } finally {
      await gw.close();
    }
  });

  it('reloadRoutes rejects an empty route table', async () => {
    const gw = createGateway({ target: upstreamPort });
    await gw.listen(0, '127.0.0.1');
    try {
      expect(() => gw.reloadRoutes([])).toThrow(/empty route table/);
    } finally {
      await gw.close();
    }
  });
});

// ---------- 3. undefined-safety & boundary edges ----------
describe('undefined & boundary safety', () => {
  it('explicit undefined config keys never throw or misfire', async () => {
    // Simulates JS consumers passing explicit undefined (EOPT runtime edge).
    const cfg = {
      routes: { '/u': upstreamPort },
      rateLimit: undefined,
      basePrefix: undefined,
      stripHeaders: undefined,
      target: undefined,
      autoRoutes: undefined,
    } as unknown as GatewayConfig;
    await withGateway(cfg, async (port) => {
      expect((await get(port, '/u/x')).status).toBe(200);
    });
  });

  it('missing req.url / req.method / remoteAddress do not throw', async () => {
    const gw = createGateway({ target: upstreamPort });
    // Real streams with undefined optional fields at the boundary.
    const req = new Readable({ read() {} }) as unknown as IncomingMessage;
    req.url = undefined;
    req.method = undefined;
    req.headers = {};
    req.aborted = false;
    req.complete = true;
    req.socket = { remoteAddress: undefined } as unknown as IncomingMessage['socket'];
    req.push(null); // empty body, stream ended

    const res = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }) as unknown as ServerResponse;
    res.statusCode = 0;
    Object.assign(res, {
      headersSent: false,
      setHeader() {},
      getHeader() {
        return undefined;
      },
      writeHead(code: number) {
        res.statusCode = code;
        return res;
      },
    });

    await gw.handleRequest(req, res);
    // Routed to catch-all '/' → proxied upstream → 200 written.
    expect(res.statusCode).toBe(200);
  });

  it('empty route table throws a clear boot error', () => {
    expect(() => createGateway({})).toThrow(/empty route table/);
    // …unless a probe/metrics path is configured (probe-only gateway).
    expect(() =>
      createGateway({ healthPath: '/health' }),
    ).not.toThrow();
  });
});

// ---------- 4. Adapter fallthrough & body parity ----------
describe('adapter fallthrough & bodies', () => {
  it('express: unmatched → next() to app routes; matched → proxied', async () => {
    const app = express();
    app.use(gatewayMiddleware({ routes: { '/gw': upstreamPort } }));
    app.get('/app-route', (_req, res) => res.json({ app: true }));
    const srv = app.listen(0, '127.0.0.1');
    servers.push(srv);
    await new Promise<void>((r) => srv.once('listening', r));
    const port = (srv.address() as AddressInfo).port;

    const appRes = await get(port, '/app-route');
    expect(appRes.status).toBe(200);
    expect(JSON.parse(appRes.body).app).toBe(true);
    expect((await get(port, '/gw/x')).status).toBe(200);
    expect((await get(port, '/nowhere')).status).toBe(404);
  });

  it('fastify: unmatched falls through; matched proxies without double-send', async () => {
    const app = Fastify();
    registerGateway(app, { routes: { '/gw': upstreamPort } });
    app.get('/app-route', async () => ({ app: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app.server);
    const port = (app.server.address() as AddressInfo).port;

    const appRes = await get(port, '/app-route');
    expect(appRes.status).toBe(200);
    expect(JSON.parse(appRes.body).app).toBe(true);
    expect((await get(port, '/gw/x')).status).toBe(200);
    await app.close();
  });

  it('fetch: binary response roundtrip + POST body', async () => {
    const bin = binaryServer();
    servers.push(bin);
    await new Promise<void>((r) => bin.listen(0, '127.0.0.1', r));
    const binPort = (bin.address() as AddressInfo).port;

    const gw = createFetchGateway({ routes: { '/bin': binPort, '/echo': upstreamPort } });

    const binRes = await gw(new Request('http://localhost/bin/x'));
    expect(binRes.status).toBe(200);
    const bytes = new Uint8Array(await binRes.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0, 1, 2, 250, 255]);

    const post = await gw(
      new Request('http://localhost/echo/p', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array([9, 8, 7]),
      }),
    );
    expect(post.status).toBe(200);
    const json = (await post.json()) as { body: string };
    expect(json.body).toBe(Buffer.from([9, 8, 7]).toString('utf8'));
  });
});
