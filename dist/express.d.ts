import { IncomingMessage, ServerResponse } from 'node:http';
export { G as Gateway, a as GatewayConfig, R as RouteConfig, c as createGateway } from './GatewayEngine-DmwnEblF.js';
import { A as AdapterGatewayConfig } from './adapterCore-9O5pMn_7.js';

type ExpressGatewayOptions<TReq extends IncomingMessage = IncomingMessage> = AdapterGatewayConfig<TReq>;
/**
 * Express middleware adapter.
 *
 * Usage:
 *   import { gatewayMiddleware } from '@udinmoinc/gateway/express';
 *   app.use(gatewayMiddleware({ routes: [...] }));
 */
declare function gatewayMiddleware<TReq extends IncomingMessage = IncomingMessage>(config: ExpressGatewayOptions<TReq>): (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => void;

export { type ExpressGatewayOptions, gatewayMiddleware };
