// k6 load test for @udinmoinc/gateway
// Usage: k6 run benchmarks/load-test.js -e GATEWAY_URL=http://localhost:8080 -e API_PREFIX=/api
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },   // ramp up
    { duration: '30s', target: 200 },  // sustain
    { duration: '10s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<100', 'p(99)<250'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.GATEWAY_URL || 'http://localhost:8080';
const PREFIX = __ENV.API_PREFIX || '/api';

export default function () {
  const res = http.get(`${BASE}${PREFIX}/health`, {
    headers: { 'x-api-key': `bench-${__VU}-${__ITER}` },
    tags: { name: 'gateway-proxy' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has rate limit headers': (r) => r.headers['X-RateLimit-Limit'] !== undefined,
    'latency < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(0.1);
}
