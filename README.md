# @udinmoinc/gateway

Zero-runtime-dependency reverse proxy and distributed rate limiter for Node.js. Pluggable edge guards, per-upstream circuit breakers, response caching, perimeter hardening, and adapters for standalone HTTP servers, Express, Fastify, and Web Standard `fetch` — with no built-in authentication or domain model.

- **License:** MIT
- **Node.js:** `>=18.17.0`
- **Runtime dependencies:** none (Node built-ins + global `fetch` only)

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Routing & Configuration Shorthands](#routing--configuration-shorthands)
- [Rate Limiting & Resilience](#rate-limiting--resilience)
- [Pluggable Protection & Tags](#pluggable-protection--tags-asprotection)
- [Perimeter Security & Upstream Signing](#perimeter-security--upstream-signing)
- [Framework Adapters](#framework-adapters)
- [Observability, Probes & Shutdown](#observability-probes--shutdown)
- [Configuration Reference](#configuration-reference)
- [Error Codes](#error-codes)

## Installation

```bash
npm install @udinmoinc/gateway
```

Optional peer for distributed rate limiting across processes/nodes:

```bash
npm install ioredis
```

`InMemoryRedis` is bundled — single-node deployments need no Redis. Without a `redis` client, limits are per-process.

## Quick Start

### 5-line standalone gateway

```js
import { startGateway } from '@udinmoinc/gateway';

const gw = startGateway({
  port: 8080,
  target: 4000,          // → http://localhost:4000, catch-all route
  rateLimit: '120/min',  // human shorthand
});
await gw.listen();       // or gw.listen(3000) to override
// serving on :8080 → http://localhost:4000
```

`startGateway` returns a `Gateway` (`listen`, `handleRequest`, `shutdown`, `reloadRoutes`, `listenCluster`, `metrics`, `poolMetrics`).

### CLI

```bash
npx @udinmoinc/gateway init                        # writes gateway.config.mjs
npx @udinmoinc/gateway start --port 8080 --target http://localhost:4000 --limit 600/min
npx @udinmoinc/gateway doctor --config gateway.config.mjs   # validates routes, pings upstreams, SSRF check
```

`gateway.config.mjs` template:

```js
export const routes = {
  '/api/users': 4001,
  '/api/orders': ['http://localhost:4002', 'http://localhost:4003'],
};
export default { port: 8080, routes };
```

## Routing & Configuration Shorthands

Routes are matched by **exact path first (O(1) map lookup), then longest-prefix**. A route `/api` matches `/api` and `/api/*`; `stripPrefix: true` (default) forwards only the remainder to the upstream.

### Accepted route shapes

Everything below is valid `GatewayConfig.routes` input — plain strings are validated and branded internally at boot:

```ts
// 1. Zero-route catch-all
createGateway({ target: 4000, rateLimit: '120/min' });

// 2. Object map — prefix → upstream(s)
createGateway({
  basePrefix: '/api',
  routes: {
    '/users': 4001,                                  // port number
    '/orders': [4002, 4003],                         // port array
    '/billing': [{ url: 'orders:4004', weight: 3 }], // weighted canary
  },
});
// serves /api/users/*, /api/orders/*, /api/billing/*

// 3. route() / group() DSL
import { route, group } from '@udinmoinc/gateway';

routes: [
  route('/users/*', [
    { url: 4001, weight: 3 },
    { url: 4002, weight: 1 },
  ], {
    rateLimit: '600/min',
    circuitBreaker: { failureThreshold: 5, openDurationMs: '30s' },
  }),
  ...group('/v1', { rateLimit: '300/min' }, [
    route('/orders', 4003, { stripPrefix: false }),
  ]),
]

// 4. routesDir — drop .js/.cjs/.mjs route modules in a directory
createGateway({ routesDir: './routes' });

// 5. autoRoutes — env-var discovery
createGateway({
  basePrefix: '/svc',
  autoRoutes: { envPrefix: 'GATEWAY_' },
  // GATEWAY_USERS=4001        → /svc/users  → http://localhost:4001
  // GATEWAY_ORDER_ITEMS=orders:4002 → /svc/order-items
});
```

### Upstream target expansion

| Input | Resolves to |
|---|---|
| `4001`, `':4001'` | `http://localhost:4001` |
| `'users:4001'`, `'10.0.0.5:8080'` | `http://users:4001`, `http://10.0.0.5:8080` |
| `'http://…'`, `'https://…'` | unchanged |
| `{ url, weight }` | weighted upstream (default weight 1) |

Multiple upstreams per route are balanced with **P2C** (power of two choices) by default; `upstreamStrategy: 'weighted-rr'` selects weighted round-robin.

### Live reload

```ts
gateway.reloadRoutes({ '/new': 4005 });                    // RoutesInput
gateway.reloadRoutes({ target: 4006, rateLimit: '60/min' }); // full options form
gateway.reloadRoutes(routesArrayFromFileWatcher);
```

`basePrefix` and probe/metrics routes are preserved; an empty result throws. Boot fails fast when `routes`, `target`, `routesDir`, and `autoRoutes` all produce zero routes (unless a health/metrics path is configured).

## Rate Limiting & Resilience

### Distributed token bucket

With `limiter.redis` (ioredis-compatible `eval`/`evalsha`), each request runs a Lua script against Redis `TIME` for clock-skew-free token buckets, cached via `EVALSHA` with `NOSCRIPT` fallback to `EVAL`. `InMemoryRedis` implements the same contract in-process.

```ts
createGateway({
  limiter: {
    redis,                    // ioredis client or InMemoryRedis
    failMode: 'fallback',     // 'fallback' | 'open' | 'closed'
    keyPrefix: 'gw:rl',
    commandTimeoutMs: 500,
    localMaxKeys: 10_000,
  },
});
```

`failMode`: `fallback` degrades to a bounded in-memory limiter, `open` allows all traffic, `closed` rejects with 429/503. Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Source` (`redis` | `local` | `local-fallback` | `fail-open` | `fail-closed` | `batch`), and denials include `Retry-After`.

Rate-limit rules are `{ capacity, refillPerSecond, batchSize? }` — `batchSize` leases up to N tokens per Redis round-trip (clamped to `capacity`, default 1). Input forms: `{ capacity, refillPerSecond, batchSize? }`, `'600/min'`, `'100/sec'`, `'2/hour'`. Client key defaults to `extractClientIp`; override globally (`extractClientKey`) or per route. Built-ins: `extractClientIp`, `extractApiKeyOrIp`, `createCompositeExtractor`.

### Circuit breakers

Per route+upstream state machine `CLOSED → OPEN → HALF_OPEN`. OPEN rejects fast (503) for `openDurationMs`, then admits probe requests; `successThreshold` consecutive successes close it, one failure re-opens. Distributed deployments share OPEN markers and HALF_OPEN probe leases through `GatewayStore`.

```ts
route('/api', 4001, {
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    openDurationMs: '30s',   // duration shorthand
    failureRatioThreshold: 0.5,
    minimumRequests: 10,
    probeTimeoutMs: 5_000,
  },
})
```

### Request resilience

- **Coalescing** — concurrent identical cache-miss GET/HEAD requests collapse onto one upstream fetch (`cache.coalesce`, default on when caching is enabled).
- **Idempotency** — `idempotency: { enabled: true }` replays stored responses for mutating requests carrying `Idempotency-Key`.
- **Hedging** — `hedging: { enabled: true, delayMs: 150 }` fires a duplicate upstream attempt for slow idempotent requests (GET/HEAD or requests with `Idempotency-Key`).
- **Upgrades** — `Upgrade: websocket` requests are tunneled raw to the upstream (SSE included); `upgradeHandshakeTimeoutMs` bounds the handshake.
- **Load shedding** — `loadShedding: { enabled: true, maxConcurrentRequests, maxEventLoopDelayMs }` returns 503 `OVERLOADED` under pressure.
- **Timeouts** — `upstreamTimeoutMs` per request; pending sockets are destroyed on abort.

## Pluggable Protection & Tags (`asProtection`)

The gateway ships **no authentication, sessions, users, roles, or tenants**. Domain logic enters through `EdgeGuard`s and `ProtectionProvider`s you write.

### ProtectionProvider — the friendly contract

```ts
import { asProtection, route, requireTag, anyOf } from '@udinmoinc/gateway';
import type { ProtectionProvider } from '@udinmoinc/gateway';

const tenantGuard: ProtectionProvider = {
  name: 'tenant',
  async verify(ctx) {
    const session = await lookupSession(ctx.req.headers.cookie);
    if (!session) {
      return { allow: false, status: 401, code: 'UNAUTHORIZED', message: 'login required' };
    }
    return {
      allow: true,
      tags: { tenant: session.tenantId, plan: session.plan },   // → ctx.tags
      headers: { 'x-tenant-id': session.tenantId },             // → upstream headers
    };
  },
};

const protected = asProtection(tenantGuard); // curried wrapper

routes: [
  protected(route('/api/admin/*', 4001)),
  // or two-arg form: asProtection(tenantGuard, route(...))
]
```

### Composing guards

```ts
import { composeGuards, anyOf, allOf, requireTag, requireHeader } from '@udinmoinc/gateway';

route('/api/billing', 4001, {
  guards: [
    // sequential — all must allow; tags/headers merge downstream
    composeGuards(
      requireTag('plan', (p) => p === 'pro' || p === 'enterprise'),
      requireTag('tenant'),
      requireHeader('x-requested-with', 'XMLHttpRequest'),
    ),
    // first allow wins
    anyOf(
      requireTag('role', 'admin'),
      requireTag('role', 'billing'),
    ),
  ],
})
```

`requireTag(key, expected?, { status, code, message })` — `expected` is a string, list, or predicate; default deny is 403 `FORBIDDEN`. `requireHeader(name, expected?)` — missing → 401, mismatch → 403.

Guards receive `EdgeRequestContext` (`req`, `res`, `route`, `clientKey`, `tags`, `headers`, `upstreamPath`) and return `{ action: 'allow', headers?, tags? }` or `{ action: 'deny', status, code, message, headers? }`. Global guards run via `GatewayConfig.guards`; per-route via `RouteConfig.guards`.

### Header anti-spoofing

```ts
createGateway({
  stripHeaders: ['x-tenant-id', 'x-user-id', 'x-plan'],
  routes: [{ prefix: '/api', upstreams: 4001, stripHeaders: ['x-internal'] }],
})
```

Client-sent copies are removed before proxying; guard-emitted `headers` are then injected, so upstreams only trust gateway-attested values.

## Perimeter Security & Upstream Signing

Applied before routing/proxying:

| Control | Config | Behavior |
|---|---|---|
| Path traversal | always on | Rejects `..`, multi-encoded `%252e%252e`, null bytes, backslashes — 400 |
| Body limit | `maxBodyBytes` (default 1 MiB) | 413 `PAYLOAD_TOO_LARGE` |
| MIME allowlist | per-route `allowedContentTypes` | 415 `UNSUPPORTED_MEDIA_TYPE` on non-GET/HEAD |
| Brute-force lockout | `bruteForce: { maxFailures, windowSec, lockDurationSec }` | 423 `LOCKED` per client IP on guard denials |
| CORS | `cors: { origins, methods?, headers?, credentials?, maxAgeSec? }` | Preflight handled; `'*'` + `credentials` rejected at boot |
| Security headers | `securityHeaders: { frameOptions?, hsts? }` | `X-Frame-Options` (default `DENY`), optional HSTS |
| Error masking | `maskUpstreamErrors: true` | Upstream 5xx bodies replaced with sanitized JSON |
| SSRF guard | always on | Blocks link-local/metadata upstreams unless `allowMetadataUpstreams: true` |
| Audit | `onSecurityEvent` | Structured `SecurityAuditEvent`s for SIEM sinks |

### HMAC-SHA256 upstream signing

```ts
createGateway({
  upstreamSigning: {
    secret: process.env.GATEWAY_SIGNING_SECRET!,
    subjectTag: 'tenant',        // signs ctx.tags.tenant as the subject
    subjectHeader: 'x-gateway-subject',
    headerName: 'x-gateway-signature',
    timestampHeader: 'x-gateway-timestamp',
  },
});
```

Every proxied request carries `X-Gateway-Signature`, `X-Gateway-Timestamp`, and (when `subjectTag` is set) `X-Gateway-Subject`. The signature covers timestamp + method + path + subject + request ID. Downstream verifies with:

```ts
import { verifyGatewaySignature } from '@udinmoinc/gateway';

const ok = verifyGatewaySignature(req.headers, req.method, req.url, SECRET, 300_000);
// headers, method, path, secret, maxAgeMs?, { headerName?, timestampHeader?, subjectHeader? }
```

`signGatewayRequest()` is exported for non-HTTP callers; `resolveSigningConfig()` normalizes partial configs.

## Framework Adapters

All adapters accept the same `GatewayConfig` (routes optional when `target`/`routesDir`/`autoRoutes` is set) and share `handleRequest`.

### Standalone

```ts
import { createGateway } from '@udinmoinc/gateway';

const gw = createGateway({ routes: { '/api': 4001 } });
await gw.listen(8080);
await gw.shutdown();                 // drains connections, closes limiter timers
await gw.listenCluster();            // node:cluster multi-core supervisor
```

### Express — `@udinmoinc/gateway/express`

```ts
import express from 'express';
import { gatewayMiddleware } from '@udinmoinc/gateway/express';

const app = express();
app.use(gatewayMiddleware({
  basePrefix: '/api',
  routes: { '/users': [{ url: 4001, weight: 3 }, { url: 4002, weight: 1 }] },
}));
app.get('/health', (_req, res) => res.json({ ok: true })); // unmatched → next()
app.listen(8080);
```

### Fastify — `@udinmoinc/gateway/fastify`

```ts
import Fastify from 'fastify';
import { registerGateway } from '@udinmoinc/gateway/fastify';

const app = Fastify();
registerGateway(app, { target: 4000 });
app.get('/health', async () => ({ ok: true })); // unmatched → fastify route
await app.listen({ port: 8080 });
```

`reply.hijack()` is invoked before raw response streaming — no `FST_ERR_REP_ALREADY_SENT`.

### Fetch / Next.js / Bun — `@udinmoinc/gateway/fetch`

```ts
import { createFetchGateway } from '@udinmoinc/gateway/fetch';

const gw = createFetchGateway({ routes: { '/api': 4001 } });

// Next.js App Router
export async function GET(req: Request) {
  return gw(req); // Request → Response, in-process, no socket
}
```

Bodies (`ReadableStream`/`ArrayBuffer`), binary responses, and unmatched-route 404s are handled.

## Observability, Probes & Shutdown

- **Request IDs** — `X-Request-ID` is honored/generated; spoofed inbound IDs are replaced unless trusted. Propagated upstream and into audit events.
- **Health** — `healthPath: '/healthz'` → 200/503. `probes: { livenessPath, readinessPath, readinessTimeoutMs }` → liveness always 200, readiness pings Redis + circuits.
- **Metrics** — `metricsPath: '/gateway/metrics'` serves Prometheus text (`Accept: text/plain`) or JSON (`Accept: application/json`) through the normal route pipeline (guard/rate-limit it like any route).
- **Hooks** — `hooks: { onRequest, onAuthorized, onUpstreamResponse, onUpstreamError, onRateLimited, onCircuitOpen, onProxyError }` plus lifecycle `plugins` (`GatewayPlugin.onRequest`/`onResponse`) and `onSecurityEvent`.
- **Shutdown** — `gateway.shutdown()` stops accepting, drains in-flight requests, closes caches/limiters, and resolves. SIGINT/SIGTERM handlers are wired by `listen()`/`startGateway`.

## Configuration Reference

`GatewayConfig` (all optional except one of `routes`/`target`/`routesDir`/`autoRoutes`):

| Field | Type | Default |
|---|---|---|
| `routes` | `RoutesInput` — array, `route()`/`group()` output, or `{ '/path': target }` map | — |
| `target` | `UpstreamInput` | catch-all when `routes` omitted |
| `basePrefix` | `string` (`'/api'`) | none |
| `autoRoutes` | `{ envPrefix?, env? }` | `GATEWAY_` prefix, `process.env` |
| `rateLimit` / `circuitBreaker` / `cache` | top-level defaults for `target` route | — |
| `limiter` | `RateLimiterOptions` | in-memory |
| `port` / `host` | `number` / `string` | `0` / `'0.0.0.0'` (via `listen`) |
| `upstreamTimeoutMs` | `number` | per `DEFAULTS` |
| `extractClientKey` | `ClientKeyExtractor` | client IP |
| `guards` / `stripHeaders` | `EdgeGuard[]` / `string[]` | — |
| `upstreamSigning` | `UpstreamSigningConfig` | off |
| `bruteForce` | `BruteForceConfig` | off |
| `cors` | `CorsConfig` | off |
| `securityHeaders` | `SecurityHeadersConfig` | off |
| `maskUpstreamErrors` | `boolean` | off |
| `maxBodyBytes` | `number` | 1 MiB |
| `allowedContentTypes` | per-route `string[]` | all |
| `healthPath` / `metricsPath` / `probes` | paths | off |
| `loadShedding` | `LoadSheddingConfig` | off |
| `routesDir` | `string` | — |
| `plugins` / `hooks` / `onSecurityEvent` | lifecycle | — |
| `allowMetadataUpstreams` | `boolean` | false (SSRF on) |

Per-route `RouteConfig` adds: `rateLimit`, `circuitBreaker`, `stripPrefix`, `cache`, `guards`, `stripHeaders`, `allowedContentTypes`, `idempotency`, `hedging`, `upstreamStrategy`, `extractClientKey`.

## Error Codes

| Status | Code | Cause |
|---|---|---|
| 400 | `BAD_REQUEST` | malformed request / path traversal |
| 401 | `UNAUTHORIZED` | guard denial (missing credentials/header) |
| 403 | `FORBIDDEN` | guard denial (tag/role mismatch) |
| 404 | `NOT_FOUND` | no route matched |
| 408 | `UPSTREAM_TIMEOUT` | upstream exceeded `upstreamTimeoutMs` |
| 413 | `PAYLOAD_TOO_LARGE` | body over `maxBodyBytes` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Content-Type not in `allowedContentTypes` |
| 423 | `LOCKED` | brute-force lockout active |
| 429 | `RATE_LIMITED` | token bucket exhausted |
| 500 | `UPSTREAM_ERROR` | upstream connection failure |
| 502 | `BAD_GATEWAY` | upstream returned invalid response |
| 503 | `SERVICE_UNAVAILABLE` / `OVERLOADED` / `CIRCUIT_OPEN` | circuit open, shed load, or upstream down |
