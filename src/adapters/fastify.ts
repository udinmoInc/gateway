import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createGateway } from '../core/GatewayEngine.js';
import type { Gateway } from '../core/GatewayEngine.js';
import type { GatewayConfig, RouteConfig } from '../types.js';

export interface FastifyGatewayOptions
  extends Omit<GatewayConfig, 'routes'> {
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
export function registerGateway(
  fastify: FastifyInstance,
  config: FastifyGatewayOptions,
): Gateway {
  const gateway = createGateway(config);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const matched = gateway.router.resolve(request.raw) !== undefined;
    if (!matched) return; // let other routes/plugins handle it

    reply.hijack();
    await gateway.handleRequest(request.raw, reply.raw);
  });

  fastify.addHook('onClose', async () => {
    await gateway.close();
  });

  return gateway;
}

export { createGateway };
export type { Gateway, GatewayConfig, RouteConfig };
