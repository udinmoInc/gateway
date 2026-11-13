export { G as Gateway, a as GatewayConfig, R as RouteConfig, c as createGateway } from './GatewayEngine-DmwnEblF.js';
import { A as AdapterGatewayConfig } from './adapterCore-9O5pMn_7.js';
import 'node:http';

type FetchGatewayOptions = AdapterGatewayConfig;
/**
 * Web-standard fetch adapter — runs the full gateway pipeline in-process
 * for Request → Response handlers (Next.js route.ts, Hono, Bun, Node 20+).
 *
 * Usage:
 *   const gw = createFetchGateway({ routes: [...] });
 *   export async function GET(req: Request) { return gw(req); }
 */
declare function createFetchGateway(config: FetchGatewayOptions): (request: Request) => Promise<Response>;

export { type FetchGatewayOptions, createFetchGateway };
