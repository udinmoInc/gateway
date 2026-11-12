import type { ServerResponse } from 'node:http';
import { STATUS } from '../constants.js';
import type { GatewayResponse } from '../types.js';

export function getHeaderString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

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
