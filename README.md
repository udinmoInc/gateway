node -e '
const fs = require("fs");
const md = `<div align="center">

# \`@udinmoinc/gateway\`

**A zero-dependency, high-concurrency API Gateway, Reverse Proxy & Distributed Rate Limiter for Node.js.**

[![npm version](https://img.shields.io/badge/npm-@udinmoinc%2Fgateway-cb3837?style=flat-square&logo=npm)](https://github.com/udinmoInc/gateway)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20%7C%20Zero%20any-3178c6?style=flat-square&logo=typescript)](https://github.com/udinmoInc/gateway)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20runtime-2ea44f?style=flat-square)](https://github.com/udinmoInc/gateway)
[![Tests](https://img.shields.io/badge/tests-60%2B%20passing-2ea44f?style=flat-square&logo=vitest)](https://github.com/udinmoInc/gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

*Pure edge infrastructure: routing, pluggable credential verification, atomic Redis rate limiting, circuit breaking, response caching, and perimeter security — standalone or embedded in Express & Fastify.*

</div>

---

## Why \`@udinmoinc/gateway\`?

- **Zero Runtime Dependencies** — Built exclusively on native \`node:http\`, \`node:https\`, and \`node:crypto\`. Dual ESM/CJS builds with full \`.d.ts\` declarations (\`tsup\`).
- **Zero-Copy Streaming Proxy** — Request and response bodies are piped directly via native streams without buffering in memory.
- **Clock-Safe Distributed Rate Limiting** — Atomic Redis Lua token buckets keyed on Redis \`TIME\` (immune to node clock drift), with an automatic bounded LRU in-memory fallback when Redis is offline or omitted.
- **Pluggable Edge Authentication** — Ordered \`AuthProvider\` chain supporting \`HS256\` JWTs, \`RS256\`/\`ES256\` JWKS (Supabase, Auth0, Clerk, Keycloak) with automatic \`kid\` rotation refresh, cached introspection, and SHA-256 scoped API keys.
- **Resilient Upstream Protection** — Per-route \`CLOSED → OPEN → HALF_OPEN\` circuit breakers, weighted round-robin load balancing, LRU response caching with stale-while-open fallback, and graceful connection draining.
- **Hardened Perimeter Security** — Path-traversal & SSRF metadata guards, anti-spoofing identity header stripping/injection, upstream HMAC request signing, CORS, security headers, and SIEM audit events.

---

## Request Lifecycle & Architecture

\`\`\`text
Incoming Client Request
  │
  ├─► 1. Perimeter Guards     (Path Traversal, SSRF, CORS, Body Size, Content-Type, Brute-Force Lockout)
  ├─► 2. Identity Sanitizer   (Strip inbound X-User-Id / X-User-Role to prevent spoofing)
  ├─► 3. AuthProvider Chain   (JWKS RS256/ES256 ─► Introspection ─► HS256 JWT ─► API Key ─► RBAC)
  ├─► 4. Rate Limiter         (Atomic Redis Lua + TIME Token Bucket ──[fallback]──► In-Memory LRU)
  ├─► 5. Response Cache       (HTTP Cache-Control LRU ──[Circuit OPEN]──► Serve Stale Fallback)
  ├─► 6. Circuit Breaker      (CLOSED ─► OPEN ─► HALF_OPEN Probe Gating + Weighted Load Balancer)
  │
  ▼
Zero-Copy Stream Proxy ───────► Downstream Microservice (X-User-Id, X-User-Role, X-Request-ID, HMAC Sig)
\`\`\`

---

## 30-Second Quickstart (No Redis Required)

\`\`\`bash
npm install @udinmoinc/gateway
\`\`\`

\`\`\`ts
import { startGateway } from "@udinmoinc/gateway";

const gateway = startGateway({
  port: 8080,
  routes: { "/api": "http://localhost:4001" },
  rateLimit: { requestsPerMinute: 60 },
});

await gateway.listen();
\`\`\`

Requests to \`http://localhost:8080/api/*\` are immediately proxied to \`localhost:4001\` (prefix stripped), rate-limited to \`60 req/min\` with standard \`X-RateLimit-*\` and \`429 Retry-After\` headers, and protected by an automatic error-ratio circuit breaker.

> **Runnable demo:** \`node examples/01-quickstart.mjs\`

<details>
<summary><strong>View Quickstart Configuration Options</strong></summary>

| Option | Default | Description |
| :--- | :--- | :--- |
| \`routes\` | — | Object map \`{ "/api": "http://host" }\` **or** \`SimpleRoute[]\` with \`path\`, \`to\`, \`stripPrefix\`, \`limitPerMinute\` |
| \`rateLimit.requestsPerMinute\` | \`60\` | Sustained request rate; automatically converted to \`capacity\` and \`refillPerSecond\` |
| \`rateLimit.burst\` | \`requestsPerMinute\` | Maximum burst token capacity |
| \`autoCircuitBreaker\` | \`true\` | Trips at \`≥50%\` failure ratio after \`≥10\` upstream calls with a \`15s\` cooldown |
| \`redis\` | *in-memory* | Optional \`ioredis\`-compatible client for cluster-wide distributed limits |
| \`port\` / \`host\` / \`upstreamTimeoutMs\` | *engine defaults* | All core \`GatewayConfig\` options are supported |

</details>

---

## Production Multi-Node Setup (Redis + Load Balancing)

\`\`\`bash
npm install @udinmoinc/gateway ioredis
docker compose up -d   # Starts local Redis on :6379
\`\`\`

\`\`\`ts
import { Redis } from "ioredis";
import { startGateway } from "@udinmoinc/gateway";

const redis = new Redis(process.env.REDIS_URL);

const gateway = startGateway({
  port: 8080,
  redis, // Atomic Lua + TIME distributed token bucket
  routes: [
    {
      path: "/api/users",
      to: [
        "http://api-a.internal", // Weighted round-robin upstream pool
        "http://api-b.internal",
      ],
      limitPerMinute: 600,
      stripPrefix: true,
    },
    { path: "/api", to: "https://api.internal" },
  ],
  rateLimit: { requestsPerMinute: 60, burst: 120 },
});

await gateway.listen();
\`\`\`

If Redis becomes unreachable, \`failMode\` governs failover behavior: \`"fallback"\` *(default — bounded in-memory LRU bucket)*, \`"open"\` *(fail-open)*, or \`"closed"\` *(fail-closed)*.

---

## Centralized Edge Authentication & Pluggable Providers

Inbound \`X-User-Id\` and \`X-User-Role\` headers are always stripped from client requests and injected upstream **only** after cryptographic verification succeeds.

### 1. Built-in HS256 JWT & RBAC (10 Lines)

\`\`\`ts
import { createGateway, asRoutePrefix, asUpstreamUrl } from "@udinmoinc/gateway";

const gateway = createGateway({
  auth: {
    jwt: { secret: process.env.JWT_SECRET!, issuer: "my-app" },
  },
  routes: [
    { prefix: asRoutePrefix("/admin"),  upstreams: [{ url: asUpstreamUrl("http://admin:4001") }], auth: ["admin"] },
    { prefix: asRoutePrefix("/api"),    upstreams: [{ url: asUpstreamUrl("http://api:4002") }],   auth: true },
    { prefix: asRoutePrefix("/public"), upstreams: [{ url: asUpstreamUrl("http://web:4003") }] },
  ],
});
\`\`\`

### 2. Supabase / Auth0 / Clerk / Keycloak — Zero-Dep JWKS (\`RS256\` & \`ES256\`)

\`\`\`ts
import { createGateway, createJwksProvider, asRoutePrefix, asUpstreamUrl } from "@udinmoinc/gateway";

const gateway = createGateway({
  auth: {
    providers: [
      createJwksProvider({
        jwksUri: "https://<project>.supabase.co/auth/v1/.well-known/jwks.json",
        roleClaim: "app_metadata.role",
        cacheTtlMs: 300_000,
      }),
    ],
  },
  routes: [
    { prefix: asRoutePrefix("/api"), upstreams: [{ url: asUpstreamUrl("http://api:4001") }], auth: true },
  ],
});
\`\`\`

### 3. Token Introspection & Custom Provider Chaining

<details>
<summary><strong>View Introspection & Custom Cookie Provider Examples</strong></summary>

\`\`\`ts
import { createIntrospectionProvider } from "@udinmoinc/gateway";

createIntrospectionProvider({
  endpoint: "https://<project>.supabase.co/auth/v1/user",
  method: "GET",
  store: redis,
  cacheTtlMs: 60_000,
  mapResponse: (body) => {
    const b = body as { id?: string; app_metadata?: { role?: string } };
    return b.id ? { userId: b.id, roles: b.app_metadata?.role ? [b.app_metadata.role] : [] } : null;
  },
});
\`\`\`

\`\`\`ts
import { createGateway, createJwtProvider, type AuthProvider } from "@udinmoinc/gateway";

const cookieProvider: AuthProvider = {
  name: "cookie-session",
  async authenticate(req) {
    const sid = readSessionCookie(req);
    if (!sid) return { skip: true };
    const user = await mySessionStore.get(sid);
    return user
      ? { authenticated: true, identity: { userId: user.id, roles: user.roles } }
      : { authenticated: false, reason: "Session expired" };
  },
};

const gateway = createGateway({
  auth: {
    providers: [cookieProvider, createJwtProvider({ secret: process.env.JWT_SECRET! })],
  },
  routes: [],
});
\`\`\`

</details>

---

## Framework Adapters (Express & Fastify)

<table>
<tr>
<th width="50%">Express</th>
<th width="50%">Fastify</th>
</tr>
<tr>
<td>

\`\`\`ts
import express from "express";
import { gatewayMiddleware } from "@udinmoinc/gateway/express";

const app = express();
app.use(gatewayMiddleware({ routes: [] }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(3000);
\`\`\`

</td>
<td>

\`\`\`ts
import Fastify from "fastify";
import { registerGateway } from "@udinmoinc/gateway/fastify";

const app = Fastify();
registerGateway(app, { routes: [] });
await app.listen({ port: 3000 });
\`\`\`

</td>
</tr>
</table>

---

## Standardized Error Responses

| Status | Error Code | Trigger Condition |
| :---: | :--- | :--- |
| \`401\` | \`UNAUTHORIZED\` | Missing, malformed, invalid, or expired JWT / API key / session |
| \`403\` | \`FORBIDDEN\` | Valid credential, but identity lacks required route role or scope |
| \`404\` | \`NO_ROUTE\` | Request path did not match any configured route prefix |
| \`413\` | \`PAYLOAD_TOO_LARGE\` | Inbound request body exceeds \`maxBodyBytes\` |
| \`415\` | \`UNSUPPORTED_MEDIA_TYPE\` | \`Content-Type\` header is not in \`allowedContentTypes\` |
| \`423\` | \`LOCKED\` | Per-IP brute-force lockout active (\`Retry-After\` header included) |
| \`429\` | \`RATE_LIMITED\` | Token bucket exhausted (\`X-RateLimit-*\` & \`Retry-After\` included) |
| \`502\` | \`UPSTREAM_ERROR\` | Upstream connection refused, reset, or protocol error |
| \`503\` | \`CIRCUIT_OPEN\` / \`DRAINING\` | Route circuit breaker is \`OPEN\` or gateway is shutting down |
| \`504\` | \`UPSTREAM_ERROR\` | Upstream exceeded \`upstreamTimeoutMs\` |

---

## Local Development & Benchmarks

\`\`\`bash
npm install
docker compose up -d   # Optional local Redis (tests run standalone without it)
npm run build          # Dual ESM/CJS + .d.ts build via tsup
npm run typecheck      # Strict tsc --noEmit verification
npm test               # Full unit + live-socket integration suite (60+ tests)
k6 run benchmarks/load-test.js -e GATEWAY_URL=http://localhost:8080
\`\`\`

## License

MIT © [Vijay Singh](https://github.com/udinmoInc)
`;
fs.writeFileSync("README.md", md);
console.log("README.md written cleanly!");
' && git add README.md && git commit -m "docs: format README with badges, architecture diagram, and collapsible guides" && git push