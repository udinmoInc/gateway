import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Gateway } from '../core/GatewayEngine.js';
import type { GatewayConfig, RouteConfig } from '../types.js';
import { createAdapterGateway, routeMatches } from './adapterCore.js';
import type { AdapterGatewayConfig } from './adapterCore.js';

export type FastifyGatewayOptions = AdapterGatewayConfig;

/**
 * Fastify adapter using the onRequest lifecycle + reply.hijack().
 *
 * Usage:
 *   import Fastify from 'fastify';
 *   import { registerGateway } from '@udinmoinc/gateway/fastify';
 *   const app = Fastify();
 *   registerGateway(app, { routes: [...] });
 */
export function registerGateway(
  fastify: FastifyInstance,
  config: FastifyGatewayOptions,
): Gateway {
  const gateway = createAdapterGateway(config);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!routeMatches(gateway, request.raw)) return; // let other routes/plugins handle it

    reply.hijack();
    await gateway.handleRequest(request.raw, reply.raw);
  });

  fastify.addHook('onClose', async () => {
    await gateway.close();
  });

  return gateway;
}

export { createGateway } from '../core/GatewayEngine.js';
export type { Gateway, GatewayConfig, RouteConfig };
