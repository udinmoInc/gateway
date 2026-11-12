import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEFAULTS } from '../constants.js';

export interface JwtVerifyOptions {
  issuer?: string;
  audience?: string | readonly string[];
  clockToleranceSec?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface JwtClaims {
  sub?: string;
  userId?: string;
  role?: string;
  roles?: string[];
  iss?: string;
  aud?: string | readonly string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  [key: string]: unknown;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

const fromB64url = (input: string): Buffer => Buffer.from(input, 'base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Sign HS256 JWT claims. `expiresInSec` sets `exp`; `now` in seconds. */
export function signJwt(
  claims: JwtClaims,
  secret: string,
  options: { issuer?: string; audience?: string | readonly string[]; expiresInSec?: number; now?: number } = {},
): string {
  const nowSec = options.now ?? Math.floor(Date.now() / 1000);
  const payload: JwtClaims = { iat: nowSec, ...claims };
  if (options.expiresInSec !== undefined) payload.exp = nowSec + options.expiresInSec;
  if (options.issuer !== undefined) payload.iss = options.issuer;
  if (options.audience !== undefined) payload.aud = options.audience;

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

function audienceMatches(aud: string | readonly string[] | undefined, expected: string | readonly string[]): boolean {
  if (aud === undefined) return false;
  const expectedList = Array.isArray(expected) ? expected : [expected as string];
  const actualList = Array.isArray(aud) ? aud : [aud];
  return expectedList.some((e) => actualList.includes(e));
}

/**
 * Verify an HS256 JWT: signature (timing-safe), exp, nbf, iss, aud.
 * Returns claims or null — never throws on bad input.
 */
export function verifyJwt(
  token: string,
  secret: string,
  options: JwtVerifyOptions = {},
): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  let alg: unknown;
  try {
    alg = (JSON.parse(fromB64url(header).toString('utf8')) as { alg?: unknown }).alg;
  } catch {
    return null;
  }
  if (alg !== 'HS256') return null;

  const expected = sign(`${header}.${payload}`, secret);
  const sigBuf = fromB64url(signature);
  const expBuf = fromB64url(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(fromB64url(payload).toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }

  const nowSec = (options.now ?? (() => Date.now() / 1000))();
  const leeway = options.clockToleranceSec ?? DEFAULTS.auth.jwtLeewaySec;

  if (typeof claims.exp === 'number' && claims.exp + leeway < nowSec) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - leeway > nowSec) return null;
  if (options.issuer !== undefined && claims.iss !== options.issuer) return null;
  if (options.audience !== undefined && !audienceMatches(claims.aud, options.audience)) return null;

  return claims;
}
