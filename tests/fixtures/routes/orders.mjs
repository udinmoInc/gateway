export default {
  path: '/svc/orders',
  to: ['http://127.0.0.1:1', 'http://127.0.0.1:2'],
  rateLimit: '60/min',
  stripPrefix: false,
};
