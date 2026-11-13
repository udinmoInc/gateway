// Express + Redis example — distributed rate limiting, custom client keys,
// per-route circuit breakers, weighted upstreams, basePrefix shorthand.
//
// Prereqs:  docker compose up -d   (starts Redis on :6379)
// Run:      node examples/02-express-redis.mjs

import express from 'express';
import { Redis } from 'ioredis';
import { gatewayMiddleware } from '../dist/express.mjs';
import { extractApiKeyOrIp, route, group } from '../dist/index.mjs';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const app = express();

// Mount the gateway. Non-matching requests fall through to next().
app.use(
  gatewayMiddleware({
    // Every route below is automatically served under /api/*.
    basePrefix: '/api',
    limiter: { redis, failMode: 'fallback' }, // degrade to in-memory if Redis dies
    extractClientKey: extractApiKeyOrIp, // X-API-Key or Bearer token, else IP
    routes: [
      // Port numbers and {url, weight} objects — no URLs, no casts.
      route('/users/*', [{ url: 4001, weight: 3 }, { url: 4002, weight: 1 }], {
        rateLimit: '600/min', // human shorthand → 100 burst / 10 rps
        circuitBreaker: {
          failureThreshold: 5,
          successThreshold: 2,
          openDurationMs: '30s', // duration shorthand → 30_000 ms
        },
      }),
      // Scheme-less 'host:port' works too.
      route('/status', 'localhost:9090'),
      // group() inherits shared policies; basePrefix prepends /api/v1/…
      ...group('/v1', { rateLimit: '300/min' }, [
        route('/orders', 4003, { stripPrefix: false }),
        route('/billing', 'orders:4004'),
      ]),
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
  console.log('  /api/users/*    → weighted LB :4001/:4002, 600 rpm');
  console.log('  /api/status     → localhost:9090');
  console.log('  /api/v1/orders  → :4003, prefix preserved');
  console.log('  /api/v1/billing → orders:4004');
  console.log('  /health         → express (unmatched fallthrough)');
});
