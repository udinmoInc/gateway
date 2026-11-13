import type { IncomingMessage } from 'node:http';
import { HEADERS } from '../constants.js';
import type { ClientKeyExtractor, RouteConfig } from '../types.js';

import { headerString } from '../shared/httpUtils.js';

export function getHeaderString(
  req: IncomingMessage,
  name: string,
): string | undefined {
  return headerString(req.headers, name);
}

function firstForwardedIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(',')[0]?.trim() || undefined;
}

/** Extracts the client IP honoring common proxy headers. */
export function extractClientIp<TReq extends IncomingMessage = IncomingMessage>(
  req: TReq,
): string {
  return (
    firstForwardedIp(getHeaderString(req, HEADERS.forwardedFor)) ??
    getHeaderString(req, HEADERS.realIp) ??
    req.socket.remoteAddress ??
    'unknown'
  );
}

/** Extracts API key from X-API-Key or Authorization: Bearer <key>. */
export function extractApiKeyOrIp<TReq extends IncomingMessage = IncomingMessage>(
  req: TReq,
): string {
  const apiKey = getHeaderString(req, HEADERS.apiKey);
  if (apiKey) return `key:${apiKey}`;

  const auth = getHeaderString(req, HEADERS.authorization);
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return `key:${auth.slice(7).trim()}`;
  }

  return `ip:${extractClientIp(req)}`;
}

/** Composes multiple extractors; first non-empty result wins. */
export function createCompositeExtractor<TReq extends IncomingMessage = IncomingMessage>(
  ...extractors: ClientKeyExtractor<TReq>[]
): ClientKeyExtractor<TReq> {
  return async (req) => {
    for (const extractor of extractors) {
      const key = await extractor(req);
      if (key) return key;
    }
    return extractClientIp(req);
  };
}

/** Resolves the effective extractor for a route (route override > global). */
export function resolveExtractor<TReq extends IncomingMessage = IncomingMessage>(
  route: RouteConfig<TReq>,
  globalExtractor?: ClientKeyExtractor<TReq>,
): ClientKeyExtractor<TReq> {
  return route.extractClientKey ?? globalExtractor ?? extractApiKeyOrIp;
}
