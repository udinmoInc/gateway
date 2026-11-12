import type { IncomingMessage, ServerResponse } from 'node:http';
import { createGateway } from '../core/GatewayEngine.js';
import type { Gateway } from '../core/GatewayEngine.js';
import type { GatewayConfig, RouteConfig } from '../types.js';

export interface ExpressGatewayOptions<TReq extends IncomingMessage = IncomingMessage>
  extends Omit<GatewayConfig<TReq>, 'routes'> {
  routes: readonly RouteConfig<TReq>[];
}

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
  const gateway: Gateway<TReq> = createGateway<TReq>(config);

  return function gatewayExpressMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next?: (err?: unknown) => void,
  ): void {
    // Only handle requests that match a configured route prefix.
    const matched = gateway.router.resolve(req as TReq) !== undefined;
    if (!matched) {
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

export { createGateway };
export type { Gateway, GatewayConfig, RouteConfig };
