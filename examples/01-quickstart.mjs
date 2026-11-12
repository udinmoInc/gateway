// 30-second quickstart — no Redis, no Docker, no config plumbing.
// Run:  node examples/01-quickstart.mjs
// Then: curl http://localhost:8080/api/hello
//       curl http://localhost:8080/api/hello   (repeat >10x to see 429)

import http from 'node:http';
import { startGateway } from '../dist/index.mjs';

// 1. Tiny mock upstream on :4001
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ upstream: 'mock', url: req.url }));
});
await new Promise((r) => upstream.listen(4001, '127.0.0.1', r));

// 2. Gateway on :8080 — 5 lines, in-memory limiter, auto circuit breaker
const gateway = startGateway({
  port: 8080,
  routes: { '/api': 'http://localhost:4001' },
  rateLimit: { requestsPerMinute: 10 },
});
await gateway.listen();

console.log('upstream:  http://localhost:4001');
console.log('gateway:   http://localhost:8080');
console.log('');
console.log('Try it:');
console.log('  curl http://localhost:8080/api/hello');
console.log('  curl http://localhost:8080/api/hello   # x10 → last one returns 429');
console.log('');
console.log('Press Ctrl+C to stop.');
