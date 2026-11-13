import { IncomingMessage } from 'node:http';
import { a as GatewayConfig, b as RoutesInput } from './GatewayEngine-DmwnEblF.js';

/** Shared config shape for all framework adapters. */
interface AdapterGatewayConfig<TReq extends IncomingMessage = IncomingMessage> extends Omit<GatewayConfig<TReq>, 'routes'> {
    /** Optional — `target`, `routesDir`, or `autoRoutes` may provide routes instead. */
    routes?: RoutesInput<TReq>;
}

export type { AdapterGatewayConfig as A };
