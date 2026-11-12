import { IncomingMessage, ServerResponse } from 'node:http';
import { G as GatewayConfig, R as RouteConfig } from './GatewayEngine-Ba8hOw4K.cjs';
export { a as Gateway, c as createGateway } from './GatewayEngine-Ba8hOw4K.cjs';

interface ExpressGatewayOptions<TReq extends IncomingMessage = IncomingMessage> extends Omit<GatewayConfig<TReq>, 'routes'> {
    routes: readonly RouteConfig<TReq>[];
}
/**
 * Express middleware adapter.
 *
 * Usage:
 *   import { gatewayMiddleware } from '@udinmoinc/gateway/express';
 *   app.use(gatewayMiddleware({ routes: [...] }));
 */
declare function gatewayMiddleware<TReq extends IncomingMessage = IncomingMessage>(config: ExpressGatewayOptions<TReq>): (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => void;

export { type ExpressGatewayOptions, GatewayConfig, RouteConfig, gatewayMiddleware };
