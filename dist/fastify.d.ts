import { FastifyInstance } from 'fastify';
import { G as Gateway } from './GatewayEngine-DmwnEblF.js';
export { a as GatewayConfig, R as RouteConfig, c as createGateway } from './GatewayEngine-DmwnEblF.js';
import { A as AdapterGatewayConfig } from './adapterCore-9O5pMn_7.js';
import 'node:http';

type FastifyGatewayOptions = AdapterGatewayConfig;
/**
 * Fastify adapter using the onRequest lifecycle + reply.hijack().
 *
 * Usage:
 *   import Fastify from 'fastify';
 *   import { registerGateway } from '@udinmoinc/gateway/fastify';
 *   const app = Fastify();
 *   registerGateway(app, { routes: [...] });
 */
declare function registerGateway(fastify: FastifyInstance, config: FastifyGatewayOptions): Gateway;

export { type FastifyGatewayOptions, Gateway, registerGateway };
