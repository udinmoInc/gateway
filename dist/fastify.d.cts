import { FastifyInstance } from 'fastify';
import { G as GatewayConfig, R as RouteConfig, a as Gateway } from './GatewayEngine-Ba8hOw4K.cjs';
export { c as createGateway } from './GatewayEngine-Ba8hOw4K.cjs';
import 'node:http';

interface FastifyGatewayOptions extends Omit<GatewayConfig, 'routes'> {
    routes: readonly RouteConfig[];
}
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

export { type FastifyGatewayOptions, Gateway, GatewayConfig, RouteConfig, registerGateway };
