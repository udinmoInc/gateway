import type { IncomingMessage } from 'node:http';
import { createGateway } from '../core/GatewayEngine.js';
import type { Gateway } from '../core/GatewayEngine.js';
import type { GatewayConfig, RoutesInput } from '../types.js';

/** Shared config shape for all framework adapters. */
export interface AdapterGatewayConfig<
  TReq extends IncomingMessage = IncomingMessage,
> extends Omit<GatewayConfig<TReq>, 'routes'> {
  /** Optional — `target`, `routesDir`, or `autoRoutes` may provide routes instead. */
  routes?: RoutesInput<TReq>;
}

/** Single gateway factory shared by express/fastify/fetch adapters. */
export function createAdapterGateway<
  TReq extends IncomingMessage = IncomingMessage,
>(config: AdapterGatewayConfig<TReq>): Gateway<TReq> {
  return createGateway<TReq>({
    ...config,
    ...(config.routes !== undefined ? { routes: config.routes } : {}),
  });
}

/** True when the request resolves to a configured route prefix. */
export function routeMatches<
  TReq extends IncomingMessage = IncomingMessage,
>(gateway: Gateway<TReq>, req: IncomingMessage): boolean {
  return gateway.router.resolve(req as TReq) !== undefined;
}
