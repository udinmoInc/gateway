# @udinmoinc/gateway

A lightweight, modular **API Gateway & Distributed Rate Limiter** for Node.js — pure edge infrastructure: routing, stateless credential verification, rate limiting, circuit breaking, caching, and perimeter security. It is **not** an auth/session server: business logic and session issuance stay in your downstream services (or in a `GatewayPlugin` you write). Runs standalone as a high-concurrency HTTP edge proxy, or as a drop-in adapter for Express and Fastify.

- **Dual ESM/CJS builds** with full TypeScript declarations (`tsup`), zero runtime dependencies
- **Atomic Redis token-bucket** rate limiting via Lua + `TIME` (clock-safe across nodes), with bounded in-memory fallback — or skip Redis entirely
- **Per-route circuit breaker** — `CLOSED → OPEN → HALF_OPEN` with error-ratio tripping and probe gating
- **Zero-copy streaming proxy** on native `node:http`/`node:https` — bodies are piped, never buffered
- **Ergonomic routing** — `route()`/`group()` DSL with `'120/min'` rate strings, `'30s'` durations, and file-based route discovery (`routesDir`)
- **Stateless edge auth** — HS256 Bearer JWT verification (`exp`/`nbf`/`iss`/`aud`) and SHA-256-scoped API keys; verified identity injected as `X-User-Id`/`X-User-Role`
- **Perimeter hardening** — path-traversal/SSRF guards, CORS, security headers, body-size & content-type enforcement, upstream HMAC signing, brute-force lockout, `GatewayPlugin` lifecycle hooks, structured security audit events
- **Strict TypeScript** — `strict` + `exactOptionalPropertyTypes`, branded route/URL types, generic request typing, zero `any`

---

## 30-Second Quickstart (No Redis Required)

```bash
npm install @udinmoinc/gateway
```

```ts
import { startGateway } from '@udinmoinc/gateway';

const gateway = startGateway({
  port: 8080,
  routes: { '/api': 'http://localhost:4001' },
  rateLimit: { requestsPerMinute: 10 },
});
await gateway.listen();
```

That's it — requests to `http://localhost:8080/api/*` are proxied to `localhost:4001` (prefix stripped), rate-limited to 10 req/min with automatic `429` + `Retry-After`, and protected by an auto circuit breaker. No Redis, no Docker, no token-bucket math: `startGateway` uses an internal in-memory limiter and sane defaults (`60 rpm`, burst `60`, circuit breaker on).

Runnable demo: `node examples/01-quickstart.mjs`

### Quickstart options

| Option | Default | Description |
|---|---|---|
| `routes` | — | Object map `{ '/api': 'http://host' }` **or** `SimpleRoute[]` with `path`, `to`, `stripPrefix`, `limitPerMinute` |
| `rateLimit.requestsPerMinute` | `60` | Sustained rate; converted to `capacity`/`refillPerSecond` automatically |
| `rateLimit.burst` | `requestsPerMinute` | Max burst tokens |
| `autoCircuitBreaker` | `true` | Error-ratio breaker: trips at ≥50% failures after ≥10 upstream calls, 15 s cooldown |
| `redis` | in-memory | Pass an `ioredis` client for distributed limits |
| `port` / `host` / `upstreamTimeoutMs` / `hooks` | engine defaults | Standard `GatewayConfig` fields also accepted |

---

## Production Multi-Node Setup (With Redis & Load Balancing)

For distributed rate limits shared across nodes, pass an `ioredis` client:

```bash
npm install @udinmoinc/gateway ioredis
docker compose up -d   # Redis on :6379
```

```ts
import { Redis } from 'ioredis';
import { startGateway } from '@udinmoinc/gateway';

const redis = new Redis(process.env.REDIS_URL);

const gateway = startGateway({
  port: 8080,
  redis,                              // distributed token bucket via Lua+TIME
  routes: [
    {
      path: '/api/users',
      to: [
        'http://api-a.internal',       // weighted round-robin
        'http://api-b.internal',
      ],
      limitPerMinute: 600,             // per-route override
      stripPrefix: true,
    },
    { path: '/api', to: 'https://api.internal' },
  ],
  rateLimit: { requestsPerMinute: 60, burst: 120 },
});
await gateway.listen();
```

If Redis becomes unreachable, `failMode` controls behavior: `'fallback'` (default — bounded in-memory LRU bucket), `'open'` (allow traffic), or `'closed'` (deny traffic).

### Full `createGateway` config

When you need per-route extractors, hooks, or fine-grained control, drop down to the core API — `defineGatewayConfig`/`defineRoute` give compile-time validation and IDE autocomplete:

```ts
import {
  createGateway, defineGatewayConfig, defineRoute,
  asRoutePrefix, asUpstreamUrl,
} from '@udinmoinc/gateway';

const gateway = createGateway(defineGatewayConfig({
  port: 8080,
  limiter: { redis, failMode: 'fallback', keyPrefix: 'gw:rl' },
  extractClientKey: extractApiKeyOrIp,   // X-API-Key / Bearer, else IP
  routes: [
    defineRoute({
      prefix: asRoutePrefix('/api/users'),
      upstreams: [
        { url: asUpstreamUrl('https://users-a.internal'), weight: 3 },
        { url: asUpstreamUrl('https://users-b.internal'), weight: 1 },
      ],
      rateLimit: { capacity: 100, refillPerSecond: 10 },
      circuitBreaker: { failureThreshold: 5, successThreshold: 2, openDurationMs: 30_000 },
    }),
  ],
  hooks: {
    onUpstreamError(ctx, err) { console.warn(ctx.upstreamUrl, err); },
  },
}));
await gateway.listen();
```

---

## Express & Fastify Integration

### Express

```ts
import express from 'express';
import { gatewayMiddleware } from '@udinmoinc/gateway/express';

const app = express();
app.use(gatewayMiddleware({ routes: [/* RouteConfig[] */] }));
app.get('/health', (_req, res) => res.json({ ok: true })); // unmatched paths fall through
app.listen(3000);
```

Full example with Redis, custom key extraction, and per-route circuit breakers: `examples/02-express-redis.mjs`

### Fastify

```ts
import Fastify from 'fastify';
import { registerGateway } from '@udinmoinc/gateway/fastify';

const app = Fastify();
registerGateway(app, { routes: [/* RouteConfig[] */] });
await app.listen({ port: 3000 });
```

The Fastify adapter uses `onRequest` + `reply.hijack()` so raw Node streams are proxied without serialization overhead. Non-matching requests continue through the normal Fastify lifecycle.

---

## Architecture & Engineering Guarantees

| Guarantee | Implementation |
|---|---|
| **Distributed rate limiting** | Atomic Redis Lua token bucket keyed on `TIME` — all nodes share one clock, no client-skew drift |
| **Redis-outage resilience** | `LocalFallback`: bounded LRU in-memory bucket (10k keys) + `open`/`closed`/`fallback` fail modes with command timeout |
| **Circuit breaking** | Per route+upstream `CLOSED → OPEN → HALF_OPEN` state machine; consecutive-failure or error-ratio (`failureRatioThreshold` + `minimumRequests`) tripping; limited concurrent probes; automatic recovery |
| **Zero-copy proxying** | Native `node:http`/`node:https` request/response piping — bodies never buffered; keep-alive agents, hop-by-hop header stripping, `X-Forwarded-For/Proto` injection, client-abort cleanup |
| **Routing** | Longest-prefix match (first match wins after length sort), weighted round-robin upstreams, optional prefix stripping |
| **Observability** | `X-RateLimit-Limit/Remaining/Reset` + `Retry-After` on every limited response; `x-gateway` marker on proxied responses; lifecycle hooks (`onRequest`, `onAuthorized`, `onUpstreamResponse`, `onUpstreamError`) |
| **Type safety** | `strict` + `exactOptionalPropertyTypes`, branded `` `/${string}` `` / `` `http(s)://…` `` template types, generic `TReq extends IncomingMessage` across config/extractors/hooks, zero `any` |
| **Stateless auth** | `auth.jwt` verifies HS256 Bearer tokens (`exp`/`nbf`/`iss`/`aud`, timing-safe) and `apiKeys` resolves SHA-256 key hashes via your `ApiKeyProvider` — per-route `auth: true` / `auth: ['admin']` RBAC; identity headers are stripped from clients and re-injected only when verified |
| **Custom auth** | Need cookies/sessions/OAuth? Write a `GatewayPlugin` — `onRequest(ctx)` can return `{ action: 'deny' }` for any custom policy without touching core config |
| **Edge security** | Path-traversal blocking, SSRF metadata-upstream guard, CORS (preflight `204`), `nosniff`/`X-Frame-Options`/`Referrer-Policy`/optional HSTS, `maxBodyBytes` + `allowedContentTypes`, upstream HMAC request signing (`upstreamSigning` + `verifyGatewaySignature` for downstreams), per-IP brute-force lockout (`423`), upstream fingerprint stripping and `maskUpstreamErrors` |
| **Auditability** | `onSecurityEvent` emits structured `SecurityAuditEvent`s (`PATH_TRAVERSAL_BLOCKED`, `BRUTE_FORCE_LOCKED`, `AUTH_DENIED`, `API_KEY_DENIED`, `POLICY_DENIED`) for SIEM sinks |

### Stateless auth in 10 lines

```ts
import { createGateway, signJwt, asRoutePrefix, asUpstreamUrl } from '@udinmoinc/gateway';

const gateway = createGateway({
  auth: { jwt: { secret: process.env.JWT_SECRET!, issuer: 'my-app' } },
  routes: [
    { prefix: asRoutePrefix('/admin'), upstreams: [{ url: asUpstreamUrl('http://admin:4001') }], auth: ['admin'] },
    { prefix: asRoutePrefix('/api'),   upstreams: [{ url: asUpstreamUrl('http://api:4002') }],   auth: true },
    { prefix: asRoutePrefix('/public'),upstreams: [{ url: asUpstreamUrl('http://web:4003') }] }, // public
  ],
});
```

Tokens are issued by **your** identity service — the gateway only verifies. `X-User-Id`/`X-User-Role` are stripped from inbound requests and injected upstream only after a signature-valid JWT (or scoped API key) is presented.

### Pluggable `AuthProvider`s — any identity provider

`auth.providers` is an ordered chain: each provider returns `{ authenticated: true, identity }`, `{ authenticated: false, reason }` (instant `401`), or `{ skip: true }` (try the next). `auth.jwt` is shorthand for the built-in HS256 provider.

**Supabase / Auth0 / Clerk / Keycloak — JWKS (RS256 & ES256, zero deps):**

```ts
import { createGateway, createJwksProvider, asRoutePrefix, asUpstreamUrl } from '@udinmoinc/gateway';

const gateway = createGateway({
  auth: {
    providers: [
      createJwksProvider({
        jwksUri: 'https://<project>.supabase.co/auth/v1/.well-known/jwks.json',
        roleClaim: 'app_metadata.role',        // dot-path: Supabase, Keycloak ('realm_access.roles'), etc.
        // issuer: '...', audience: '...', cacheTtlMs: 300_000,
      }),
    ],
  },
  routes: [
    { prefix: asRoutePrefix('/api'), upstreams: [{ url: asUpstreamUrl('http://api:4001') }], auth: true },
  ],
});
```

Keys are fetched via `fetch`, cached in memory, verified with `node:crypto` only, and the cache refreshes once automatically on unknown `kid` (zero-downtime rotation).

**Introspection — Supabase `/user`, Ory, or any custom auth service:**

```ts
createIntrospectionProvider({
  endpoint: 'https://<project>.supabase.co/auth/v1/user',
  method: 'GET',
  store: redis,                 // optional GatewayStore — caches positive outcomes by credential hash
  cacheTtlMs: 60_000,
  mapResponse: (body) => {
    const b = body as { id?: string; app_metadata?: { role?: string } };
    return b.id ? { userId: b.id, roles: b.app_metadata?.role ? [b.app_metadata.role] : [] } : null;
  },
})
```

**Custom `AuthProvider` — cookies, mTLS, OAuth introspection, anything:**

```ts
const cookieProvider: AuthProvider = {
  name: 'cookie-session',
  async authenticate(req) {
    const session = readSessionCookie(req);       // your logic
    if (!session) return { skip: true };
    const user = await mySessionStore.get(session);
    return user
      ? { authenticated: true, identity: { userId: user.id, roles: user.roles } }
      : { authenticated: false, reason: 'session expired' };
  },
};

createGateway({ auth: { providers: [cookieProvider, createJwtProvider({ secret })] }, /* ... */ });
```

### Error responses

All errors are JSON: `{ "error": { "code", "message" } }`

| Status | Code | Cause |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing/invalid/expired JWT or API key |
| 403 | `FORBIDDEN` | Valid credential, insufficient role/scope |
| 404 | `NO_ROUTE` | No route prefix matched |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds `maxBodyBytes` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Content-Type not in `allowedContentTypes` |
| 423 | `LOCKED` | Brute-force lockout active (`Retry-After` set) |
| 429 | `RATE_LIMITED` | Token bucket exhausted |
| 502 | `UPSTREAM_ERROR` | Upstream connect/protocol error |
| 503 | `CIRCUIT_OPEN` | Circuit breaker is open |
| 504 | `UPSTREAM_ERROR` | Upstream timeout |

---

## Development

```bash
npm install
docker compose up -d   # local Redis (optional — tests run without it)
npm run build          # tsup → dist/*.mjs + *.cjs + *.d.ts
npm run typecheck      # strict tsc --noEmit
npm test               # vitest unit + live-socket integration (60 tests)
```

## Benchmark

```bash
k6 run benchmarks/load-test.js -e GATEWAY_URL=http://localhost:8080
```

## License

MIT © Vijay Singh
#   g a t e w a y  
 