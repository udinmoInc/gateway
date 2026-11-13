import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Gateway } from '../core/GatewayEngine.js';
import type { GatewayConfig, RouteConfig } from '../types.js';
import { createAdapterGateway, routeMatches } from './adapterCore.js';
import type { AdapterGatewayConfig } from './adapterCore.js';

export type ExpressGatewayOptions<
  TReq extends IncomingMessage = IncomingMessage,
> = AdapterGatewayConfig<TReq>;

/**
 * Express middleware adapter.
 *
 * Usage:
 *   import { gatewayMiddleware } from '@udinmoinc/gateway/express';
 *   app.use(gatewayMiddleware({ routes: [...] }));
 */
export function gatewayMiddleware<TReq extends IncomingMessage = IncomingMessage>(
  config: ExpressGatewayOptions<TReq>,
) {
  const gateway: Gateway<TReq> = createAdapterGateway<TReq>(config);

  return function gatewayExpressMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next?: (err?: unknown) => void,
  ): void {
    // Only handle requests that match a configured route prefix.
    if (!routeMatches(gateway, req)) {
      if (next) {
        next();
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NO_ROUTE', message: 'no matching route' } }));
      return;
    }
    void gateway.handleRequest(req, res);
  };
}

export { createGateway } from '../core/GatewayEngine.js';
export type { Gateway, GatewayConfig, RouteConfig };
