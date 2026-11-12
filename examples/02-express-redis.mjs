// Express + Redis example — distributed rate limiting, custom client keys,
// per-route circuit breakers, weighted upstreams.
//
// Prereqs:  docker compose up -d   (starts Redis on :6379)
// Run:      node examples/02-express-redis.mjs

import express from 'express';
import { Redis } from 'ioredis';
import { gatewayMiddleware } from '../dist/express.mjs';
import {
  asRoutePrefix,
  asUpstreamUrl,
  extractApiKeyOrIp,
  defineRoute,
} from '../dist/index.mjs';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const app = express();

// Mount the gateway. Non-matching requests fall through to next().
app.use(
  gatewayMiddleware({
    limiter: { redis, failMode: 'fallback' }, // degrade to in-memory if Redis dies
    extractClientKey: extractApiKeyOrIp, // X-API-Key or Bearer token, else IP
    routes: [
      defineRoute({
        prefix: asRoutePrefix('/api/users'),
        upstreams: [
          { url: asUpstreamUrl('http://localhost:4001'), weight: 3 },
          { url: asUpstreamUrl('http://localhost:4002'), weight: 1 },
        ],
        rateLimit: { capacity: 100, refillPerSecond: 10 }, // ~600 rpm sustained
        circuitBreaker: {
          failureThreshold: 5,
          successThreshold: 2,
          openDurationMs: 30_000,
        },
      }),
      defineRoute({
        prefix: asRoutePrefix('/api/orders'),
        upstreams: [{ url: asUpstreamUrl('http://localhost:4003') }],
        rateLimit: { capacity: 20, refillPerSecond: 2 },
        stripPrefix: false, // upstream sees /api/orders/...
      }),
    ],
    hooks: {
      onUpstreamError(ctx, err) {
        console.warn(`[gateway] ${ctx.upstreamUrl} failed:`, err.message);
      },
    },
  }),
);

// Regular Express routes still work for unmatched paths.
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(8080, () => {
  console.log('Express gateway on http://localhost:8080');
  console.log('  /api/users/*  → weighted LB :4001/:4002, 100 burst / 10 rps');
  console.log('  /api/orders/* → :4003, 20 burst / 2 rps, prefix preserved');
  console.log('  /health       → express (unmatched fallthrough)');
});
