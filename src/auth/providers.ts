import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { DEFAULTS, HEADERS } from '../constants.js';
import type {
  AuthOutcome,
  AuthProvider,
  GatewayStore,
  IntrospectionProviderOptions,
  JwtAuthConfig,
  JwksProviderOptions,
  VerifiedIdentity,
} from '../types.js';
import { getHeaderString } from '../utils/extractors.js';
import { verifyJwt } from './jwt.js';
import type { JwtClaims } from './jwt.js';

// ---------- shared helpers ----------

function bearerToken(req: IncomingMessage): string | null {
  const auth = getHeaderString(req, HEADERS.authorization);
  if (!auth) return null;
  const [scheme, token] = auth.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toRoles(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((r): r is string => typeof r === 'string');
  }
  return [];
}

/** Dot-notation claim lookup: 'app_metadata.role' → claims.app_metadata.role */
function resolveClaim(claims: Record<string, unknown>, path: string): unknown {
  let current: unknown = claims;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function identityFromClaims(
  claims: JwtClaims,
  options: { userIdClaim?: string; roleClaim?: string } = {},
): VerifiedIdentity | null {
  const userIdPath = options.userIdClaim ?? 'sub';
  const rawUserId = resolveClaim(claims as Record<string, unknown>, userIdPath);
  const userId =
    typeof rawUserId === 'string' ? rawUserId :
    typeof claims.userId === 'string' ? claims.userId : undefined;
  if (!userId) return null;

  let roles: string[];
  if (options.roleClaim !== undefined) {
    roles = toRoles(resolveClaim(claims as Record<string, unknown>, options.roleClaim));
  } else {
    roles = Array.isArray(claims.roles)
      ? claims.roles.filter((r): r is string => typeof r === 'string')
      : typeof claims.role === 'string'
        ? [claims.role]
        : [];
  }
  return { userId, roles };
}

function validateTimeClaims(
  claims: Record<string, unknown>,
  issuer: string | undefined,
  audience: string | readonly string[] | undefined,
  leewaySec: number,
  nowSec: number,
): boolean {
  const exp = claims['exp'];
  const nbf = claims['nbf'];
  if (typeof exp === 'number' && exp + leewaySec < nowSec) return false;
  if (typeof nbf === 'number' && nbf - leewaySec > nowSec) return false;
  if (issuer !== undefined && claims['iss'] !== issuer) return false;
  if (audience !== undefined) {
    const aud = claims['aud'];
    const expected = Array.isArray(audience) ? audience : [audience as string];
    const actual = Array.isArray(aud) ? aud : [aud];
    if (!expected.some((e) => typeof e === 'string' && actual.includes(e))) return false;
  }
  return true;
}

const b64urlToBuffer = (input: string): Buffer => Buffer.from(input, 'base64url');

function decodeJwtParts(token: string):
  | { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer }
  | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  try {
    const header = JSON.parse(b64urlToBuffer(h).toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(b64urlToBuffer(p).toString('utf8')) as Record<string, unknown>;
    return { header, payload, signingInput: `${h}.${p}`, signature: b64urlToBuffer(s) };
  } catch {
    return null;
  }
}

// ---------- 1. HS256 JWT provider ----------

/** Wraps symmetric HS256 Bearer verification as an AuthProvider. */
export function createJwtProvider<TReq extends IncomingMessage = IncomingMessage>(
  config: JwtAuthConfig,
): AuthProvider<TReq> {
  return {
    name: 'jwt-hs256',
    async authenticate(req: TReq): Promise<AuthOutcome> {
      const token = bearerToken(req);
      if (!token) return { skip: true };
      const claims = verifyJwt(token, config.secret, {
        ...(config.issuer !== undefined ? { issuer: config.issuer } : {}),
        ...(config.audience !== undefined ? { audience: config.audience } : {}),
        ...(config.clockToleranceSec !== undefined
          ? { clockToleranceSec: config.clockToleranceSec }
          : {}),
      });
      if (!claims) {
        return { authenticated: false, reason: 'invalid or expired token' };
      }
      const identity = identityFromClaims(claims);
      if (!identity) {
        return { authenticated: false, reason: 'token missing user id claim' };
      }
      return { authenticated: true, identity };
    },
  };
}

// ---------- 2. JWKS provider (RS256 / ES256, zero-dep) ----------

type PublicKey = ReturnType<typeof createPublicKey>;

const JWKS_SUPPORTED_KTY = new Set(['RSA', 'EC']);

/**
 * Asymmetric JWT verification against a remote JWKS endpoint.
 * Uses node:crypto only — `createPublicKey({ format: 'jwk' })` +
 * `crypto.verify`. Caches keys and refreshes once on unknown `kid`.
 */
export function createJwksProvider<TReq extends IncomingMessage = IncomingMessage>(
  options: JwksProviderOptions,
): AuthProvider<TReq> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULTS.auth.jwksCacheTtlMs;
  const leeway = options.clockToleranceSec ?? DEFAULTS.auth.jwtLeewaySec;
  let keys = new Map<string, PublicKey>();
  let fetchedAt = 0;
  let inflight: Promise<void> | null = null;

  async function refresh(force: boolean): Promise<void> {
    if (!force && Date.now() - fetchedAt < cacheTtlMs) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await fetch(options.jwksUri, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
        const body = (await res.json()) as { keys?: unknown };
        const next = new Map<string, PublicKey>();
        if (Array.isArray(body.keys)) {
          for (const jwk of body.keys) {
            if (typeof jwk !== 'object' || jwk === null) continue;
            const k = jwk as { kid?: unknown; kty?: unknown };
            if (typeof k.kid !== 'string' || typeof k.kty !== 'string') continue;
            if (!JWKS_SUPPORTED_KTY.has(k.kty)) continue;
            try {
              next.set(k.kid, createPublicKey({ key: jwk, format: 'jwk' }));
            } catch {
              // skip unusable keys
            }
          }
        }
        keys = next;
        fetchedAt = Date.now();
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function verifyWith(key: PublicKey, alg: unknown, signingInput: string, signature: Buffer): boolean {
    if (alg !== 'RS256' && alg !== 'ES256') return false;
    try {
      // ieee-p1363 gives raw R||S for EC — exactly the JWS ES256 format.
      // RSA keys must not receive dsaEncoding.
      const keyParam =
        key.asymmetricKeyType === 'ec'
          ? { key, dsaEncoding: 'ieee-p1363' as const }
          : key;
      return cryptoVerify(
        'sha256',
        Buffer.from(signingInput, 'utf8'),
        keyParam,
        signature,
      );
    } catch {
      return false;
    }
  }

  return {
    name: 'jwks',
    async authenticate(req: TReq): Promise<AuthOutcome> {
      const token = bearerToken(req);
      if (!token) return { skip: true };
      const parts = decodeJwtParts(token);
      if (!parts) return { authenticated: false, reason: 'malformed token' };

      await refresh(false);
      const kid = typeof parts.header['kid'] === 'string' ? parts.header['kid'] : undefined;

      let key: PublicKey | undefined;
      if (kid !== undefined) {
        key = keys.get(kid);
        if (key === undefined) {
          // Possible key rotation — refresh once and retry.
          await refresh(true);
          key = keys.get(kid);
        }
      } else if (keys.size > 0) {
        // No kid: try every cached key.
        for (const candidate of keys.values()) {
          if (verifyWith(candidate, parts.header['alg'], parts.signingInput, parts.signature)) {
            key = candidate;
            break;
          }
        }
        if (key === undefined) {
          return { authenticated: false, reason: 'no matching signing key' };
        }
      }

      if (kid !== undefined && key === undefined) {
        return { authenticated: false, reason: 'unknown signing key id' };
      }
      if (key === undefined) {
        return { authenticated: false, reason: 'jwks unavailable' };
      }
      if (!verifyWith(key, parts.header['alg'], parts.signingInput, parts.signature)) {
        return { authenticated: false, reason: 'invalid signature' };
      }

      const nowSec = Date.now() / 1000;
      if (!validateTimeClaims(parts.payload, options.issuer, options.audience, leeway, nowSec)) {
        return { authenticated: false, reason: 'claims validation failed' };
      }

      const identity = identityFromClaims(parts.payload as JwtClaims, {
        ...(options.userIdClaim !== undefined ? { userIdClaim: options.userIdClaim } : {}),
        ...(options.roleClaim !== undefined ? { roleClaim: options.roleClaim } : {}),
      });
      if (!identity) {
        return { authenticated: false, reason: 'token missing user id claim' };
      }
      return { authenticated: true, identity };
    },
  };
}

// ---------- 3. Introspection provider ----------

function defaultCredential(req: IncomingMessage): string | null {
  const auth = getHeaderString(req, HEADERS.authorization);
  return auth && /^Bearer\s+\S+/i.test(auth) ? auth : null;
}

function storeGet(store: GatewayStore, key: string): Promise<string | null> {
  if (store.get) return store.get(key);
  return store
    .eval('return redis.call("GET", KEYS[1])', 1, key)
    .then((raw) => (typeof raw === 'string' ? raw : null));
}

function storeSet(store: GatewayStore, key: string, value: string, ttlMs: number): Promise<unknown> {
  if (store.set) return store.set(key, value, 'PX', ttlMs);
  return store.eval(
    'redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2]); return 1',
    1,
    key,
    value,
    ttlMs,
  );
}

/**
 * Forward the request credential to an external auth/introspection
 * endpoint (Supabase /auth/v1/user, Ory, custom service) and map the
 * JSON response into a VerifiedIdentity. Positive results can be
 * cached in a GatewayStore to eliminate per-request latency.
 */
export function createIntrospectionProvider<TReq extends IncomingMessage = IncomingMessage>(
  options: IntrospectionProviderOptions,
): AuthProvider<TReq> {
  const method = options.method ?? 'GET';
  const extract = options.extractCredential ?? defaultCredential;
  const cacheKeyFor = (credential: string): string =>
    `${DEFAULTS.auth.authCacheKeyPrefix}${createHash('sha256')
      .update(`${options.endpoint}|${credential}`, 'utf8')
      .digest('hex')}`;

  return {
    name: 'introspection',
    async authenticate(req: TReq): Promise<AuthOutcome> {
      const credential = extract(req);
      if (!credential) return { skip: true };

      const cacheKey = cacheKeyFor(credential);
      if (options.store && options.cacheTtlMs !== undefined) {
        const cached = await storeGet(options.store, cacheKey);
        if (cached) {
          try {
            const identity = JSON.parse(cached) as VerifiedIdentity;
            if (typeof identity.userId === 'string') {
              return { authenticated: true, identity };
            }
          } catch {
            // corrupt cache entry — fall through to live call
          }
        }
      }

      const headers: Record<string, string> = {
        accept: 'application/json',
        authorization: credential,
        ...options.headers,
      };
      const init: RequestInit = { method, headers };
      if (method === 'POST') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify({ token: credential });
      }

      let body: unknown;
      try {
        const res = await fetch(options.endpoint, init);
        if (!res.ok) {
          return { authenticated: false, reason: `introspection rejected (${res.status})` };
        }
        body = (await res.json()) as unknown;
      } catch {
        return { authenticated: false, reason: 'introspection endpoint unreachable' };
      }

      const identity = options.mapResponse(body);
      if (!identity) {
        return { authenticated: false, reason: 'credential rejected by provider' };
      }

      if (options.store && options.cacheTtlMs !== undefined) {
        void storeSet(options.store, cacheKey, JSON.stringify(identity), options.cacheTtlMs).catch(
          () => undefined,
        );
      }
      return { authenticated: true, identity };
    },
  };
}
