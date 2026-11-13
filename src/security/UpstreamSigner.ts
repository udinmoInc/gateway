import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { DEFAULTS, HEADERS } from '../constants.js';
import type { UpstreamSigningConfig } from '../types.js';

export interface SignInput {
  secret: string;
  method: string;
  path: string;
  /**
   * Generic subject bound into the signature (e.g. a tag value like
   * tenant id). Empty string when no subject is configured.
   */
  subject: string;
  requestId: string;
  timestampMs?: number;
  headerName?: string;
  timestampHeader?: string;
}

function signaturePayload(
  timestampMs: number,
  method: string,
  path: string,
  subject: string,
  requestId: string,
): string {
  return `${timestampMs}.${method.toUpperCase()}.${path}.${subject}.${requestId}`;
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Produce the signature + timestamp header pair for an upstream request.
 * Downstream services verify with `verifyGatewaySignature`.
 */
export interface SignResult {
  /** Header name → value pairs to attach to the upstream request. */
  headers: Record<string, string>;
  timestampMs: number;
}

export function signGatewayRequest(input: SignInput): SignResult {
  const timestampMs = input.timestampMs ?? Date.now();
  const headerName = input.headerName ?? DEFAULTS.perimeter.signatureHeader;
  const timestampHeader =
    input.timestampHeader ?? DEFAULTS.perimeter.signatureTimestampHeader;
  const signature = hmac(
    signaturePayload(timestampMs, input.method, input.path, input.subject, input.requestId),
    input.secret,
  );
  return {
    headers: {
      [headerName]: signature,
      [timestampHeader]: String(timestampMs),
    },
    timestampMs,
  };
}

export interface VerifyOptions {
  headerName?: string;
  timestampHeader?: string;
  /**
   * Header carrying the signed subject (default 'x-gateway-subject').
   * Must match the `subjectHeader` used at signing time.
   */
  subjectHeader?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

function headerValue(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verify an upstream request signature. Returns true only when the
 * HMAC matches (timing-safe) and the timestamp is within `maxAgeMs`.
 * Intended for downstream Node services to confirm gateway origin
 * and reject replays.
 */
export function verifyGatewaySignature(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  method: string,
  path: string,
  secret: string,
  maxAgeMs: number = DEFAULTS.perimeter.signatureMaxAgeMs,
  options: VerifyOptions = {},
): boolean {
  const headerName = options.headerName ?? DEFAULTS.perimeter.signatureHeader;
  const timestampHeader =
    options.timestampHeader ?? DEFAULTS.perimeter.signatureTimestampHeader;
  const subjectHeader =
    options.subjectHeader ?? HEADERS.gatewaySubject;

  const signature = headerValue(headers, headerName);
  const timestampRaw = headerValue(headers, timestampHeader);
  if (!signature || !timestampRaw) return false;

  const timestampMs = Number(timestampRaw);
  if (!Number.isFinite(timestampMs)) return false;

  const now = options.now?.() ?? Date.now();
  if (Math.abs(now - timestampMs) > maxAgeMs) return false;

  // subject/requestId are embedded in the signed payload; extract them
  // from the headers the gateway also forwards.
  const subject = headerValue(headers, subjectHeader) ?? '';
  const requestId = headerValue(headers, HEADERS.requestId) ?? '';

  const expected = hmac(
    signaturePayload(timestampMs, method, path, subject, requestId),
    secret,
  );
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve signing config into concrete header names (for ProxyHandler). */
export function resolveSigningConfig(
  config: UpstreamSigningConfig,
): Required<UpstreamSigningConfig> {
  return {
    secret: config.secret,
    subjectTag: config.subjectTag ?? '',
    subjectHeader: config.subjectHeader ?? HEADERS.gatewaySubject,
    headerName: config.headerName ?? DEFAULTS.perimeter.signatureHeader,
    timestampHeader:
      config.timestampHeader ?? DEFAULTS.perimeter.signatureTimestampHeader,
  };
}
