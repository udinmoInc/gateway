// CJS route module — loaded via createGateway({ routesDir }) / loadRoutesDirSync
module.exports = {
  path: '/svc/users',
  to: 'http://127.0.0.1:1', // placeholder; tests override upstream via routes array instead
  auth: false,
};
