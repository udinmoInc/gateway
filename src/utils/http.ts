import type { ServerResponse } from 'node:http';
import { STATUS } from '../constants.js';
import type { GatewayResponse } from '../types.js';
import { BoundedMap } from '../shared/BoundedMap.js';

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): void {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

interface CachedBody {
  body: string;
  length: number;
}

/**
 * Pre-serialized error responses: the (status, code, message) triple is
 * almost always one of a small fixed set, so the JSON body + byte length
 * are computed once and replayed — zero stringify on the hot error path.
 * Bounded FIFO so dynamic messages can't grow it unboundedly.
 */
const ERROR_BODY_CACHE_MAX = 256;
const errorBodyCache = new BoundedMap<string, CachedBody>({
  maxEntries: ERROR_BODY_CACHE_MAX,
});

export function sendErrorJson(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): void {
  if (res.headersSent || res.writableEnded) return;
  // JSON tuple key — unambiguous even when code/message contain separators.
  const key = JSON.stringify([statusCode, code, message]);
  let cached = errorBodyCache.get(key);
  if (cached === undefined) {
    const body = JSON.stringify(defaultErrorBody(code, message));
    cached = { body, length: Buffer.byteLength(body) };
    errorBodyCache.set(key, cached); // bounded FIFO eviction
  }
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': cached.length,
    ...extraHeaders,
  });
  res.end(cached.body);
}

export function sendGatewayResponse(
  res: ServerResponse,
  response: GatewayResponse,
): void {
  if (res.headersSent || res.writableEnded) return;
  const body = response.body;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.headers ?? {})) {
    if (v === undefined) continue;
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  if (body !== undefined && headers['content-length'] === undefined) {
    headers['content-length'] = String(
      typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength ?? body.length,
    );
  }
  res.writeHead(response.statusCode, headers);
  res.end(body);
}

export const defaultErrorBody = (code: string, message: string) => ({
  error: { code, message },
});

export function secondsUntil(epochSeconds: number, nowMs: number): number {
  return Math.max(0, Math.ceil(epochSeconds - nowMs / 1000));
}

export { STATUS };
