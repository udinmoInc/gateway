// Pluggable protection example — custom session/tenant/plan logic via
// asProtection + ctx.tags, composed with requireTag, zero vendor lock-in.
//
// Run:  npm run build && node examples/03-pluggable-protection.mjs
//       (starts its own demo upstream on :4101, gateway on :8090)

import http from 'node:http';
import { startGateway } from '../dist/index.mjs';
import {
  asProtection,
  route,
  group,
  requireTag,
  anyOf,
} from '../dist/index.mjs';

// ---- demo "session store" (swap for Supabase/Clerk/DB/API keys) ----
const sessions = new Map([
  ['tok-free', { tenant: 'acme', plan: 'free' }],
  ['tok-pro', { tenant: 'acme', plan: 'pro' }],
  ['tok-ent', { tenant: 'globex', plan: 'enterprise' }],
]);

// A ProtectionProvider is just { name?, verify(ctx) } — the gateway
// knows nothing about sessions, tenants, or plans.
const sessionProvider = {
  name: 'demo-session',
  async verify(ctx) {
    const auth = ctx.req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const session = sessions.get(token);
    if (!session) {
      return {
        allow: false,
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'missing or invalid session token',
      };
    }
    return {
      allow: true,
      // Arbitrary domain tags → readable as ctx.tags downstream,
      // varyTags, requireTag, and upstreamSigning.subjectTag.
      tags: { tenant: session.tenant, plan: session.plan },
      // Trusted headers injected into the upstream request.
      headers: { 'x-tenant-id': session.tenant },
    };
  },
};

// ---- demo upstream: echoes the trusted headers the gateway injected ----
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      url: req.url,
      tenant: req.headers['x-tenant-id'] ?? null,
      note: 'upstream only sees gateway-attested headers',
    }),
  );
});
await new Promise((r) => upstream.listen(4101, '127.0.0.1', r));

const protect = asProtection(sessionProvider); // curried route wrapper

const gw = startGateway({
  port: 8090, // used by gw.listen() below
  basePrefix: '/api',
  routes: [
    // Public route — no protection.
    route('/status', 4101),

    // Whole group protected; child routes add tag rules on top.
    ...protect(
      group('/v1', {}, [
        route('/profile', 4101),
        // requireTag reads ctx.tags.plan emitted by the session provider.
        route('/billing', 4101, {
          guards: [requireTag('plan', ['pro', 'enterprise'])],
        }),
        // anyOf: admin role OR enterprise plan.
        route('/admin', 4101, {
          guards: [
            anyOf(
              requireTag('role', 'admin'),
              requireTag('plan', 'enterprise'),
            ),
          ],
        }),
      ]),
    ),
  ],
  // Strip client-sent identity headers so only guard-emitted ones pass.
  stripHeaders: ['x-tenant-id', 'x-user-id', 'x-plan'],
  // HMAC-sign upstream requests; subject = the tenant tag.
  upstreamSigning: {
    secret: 'demo-secret-change-me',
    subjectTag: 'tenant',
  },
});
await gw.listen();

console.log('gateway on http://localhost:8090  (upstream demo on :4101)');
console.log('try:');
console.log('  curl -H "Authorization: Bearer tok-pro" localhost:8090/api/v1/profile');
console.log('  curl -H "Authorization: Bearer tok-free" localhost:8090/api/v1/billing   # 403');
console.log('  curl -H "Authorization: Bearer tok-ent" localhost:8090/api/v1/admin     # 200');
console.log('  curl localhost:8090/api/v1/profile                                       # 401');
console.log('  curl localhost:8090/api/status                                           # 200 (public)');
