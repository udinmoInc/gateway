import { IncomingMessage, ServerResponse, IncomingHttpHeaders } from 'node:http';
import { b as RateLimitRule, d as RateLimitResult, U as UpstreamTarget, e as UpstreamResponseInfo, C as ClientKeyExtractor, R as RouteConfig, f as GatewayResponse, g as RedisLike, I as IntrospectionProviderOptions, A as AuthProvider, J as JwksProviderOptions, h as JwtAuthConfig, i as RouteCacheConfig, j as CircuitBreakerOptions, k as UpstreamSigningConfig, l as ApiKeyRecord, m as ApiKeyGuardConfig, n as GatewayStore, B as BruteForceConfig, o as CorsConfig, p as UpstreamUrl, G as GatewayConfig, a as Gateway, q as RoutePrefix, D as DefineRouteOptions } from './GatewayEngine-Ba8hOw4K.js';
export { r as ApiKeyProvider, s as AuthConfig, t as AuthOutcome, u as Brand, v as CACHE_STATUS, w as CIRCUIT_STATES, x as CircuitBreaker, y as CircuitBreakerLike, z as CircuitState, E as DEFAULTS, F as ERROR_CODES, H as ErrorCode, K as FAIL_MODES, L as FailMode, M as GatewayHooks, N as GatewayPlugin, O as GatewayProbes, P as HEADERS, Q as PluginContext, S as PolicyDecision, T as RateLimiterOptions, V as RedisRateLimiter, W as RequestContext, X as RouteAuth, Y as Router, Z as SECURITY_EVENT_TYPES, _ as STATUS, $ as SecurityAuditEvent, a0 as SecurityEventType, a1 as SecurityHeadersConfig, a2 as ShutdownOptions, a3 as VerifiedIdentity, c as createGateway } from './GatewayEngine-Ba8hOw4K.js';

/**
 * Bounded in-memory token bucket used when Redis is unavailable
 * (fail-open fallback) or when no Redis client is configured.
 * LRU eviction keeps memory bounded under key-cardinality attacks.
 */
declare class LocalFallback {
    private readonly buckets;
    private readonly maxKeys;
    constructor(maxKeys?: number);
    consume(key: string, rule: RateLimitRule, now?: number): RateLimitResult;
    get size(): number;
    private evictIfNeeded;
}

interface ProxyTarget {
    upstream: UpstreamTarget;
    /** Path (with query) to request upstream. */
    path: string;
    /** Extra headers merged into the upstream response. */
    responseHeaders?: Record<string, string> | undefined;
    /**
     * Verified identity headers injected onto the upstream request
     * (e.g. x-user-id, x-user-role, x-session-id).
     */
    identityHeaders?: Record<string, string> | undefined;
    /** Additional client headers to strip before forwarding. */
    stripHeaders?: readonly string[] | undefined;
    /** Pre-generated request id (used for signing payload consistency). */
    requestId?: string | undefined;
    /** Zero-trust upstream HMAC signing parameters. */
    signing?: {
        secret: string;
        userId: string;
        headerName?: string;
        timestampHeader?: string;
    } | undefined;
}
/**
 * Zero-copy HTTP/HTTPS forwarder. Streams the client body straight into the
 * upstream request and pipes the upstream response straight back — no
 * buffering of payloads.
 */
declare class ProxyHandler {
    private readonly agents;
    private readonly timeoutMs;
    private readonly maxSockets;
    constructor(options?: {
        timeoutMs?: number;
        maxSockets?: number;
    });
    /**
     * Forward `req` to the upstream and stream the response into `res`.
     * Resolves with response metadata once upstream headers arrive.
     * Rejects on connect/timeout errors (response may be partially written —
     * callers should treat rejection as fatal for the request).
     */
    forward(req: IncomingMessage, res: ServerResponse, target: ProxyTarget, options?: {
        captureBody?: boolean;
        maxBodyBytes?: number;
        maskErrors?: boolean;
    }): Promise<UpstreamResponseInfo>;
    private resolveRequestId;
    private buildHeaders;
    private responseHeadersFor;
    private writeResponse;
    private pipeResponse;
    /**
     * maskUpstreamErrors: consume and discard a 5xx upstream body, then
     * answer with a sanitized JSON error so internals never leak.
     */
    private maskedResponse;
    private agentFor;
    close(): Promise<void>;
}

declare function getHeaderString(req: IncomingMessage, name: string): string | undefined;
/** Extracts the client IP honoring common proxy headers. */
declare function extractClientIp<TReq extends IncomingMessage = IncomingMessage>(req: TReq): string;
/** Extracts API key from X-API-Key or Authorization: Bearer <key>. */
declare function extractApiKeyOrIp<TReq extends IncomingMessage = IncomingMessage>(req: TReq): string;
/** Composes multiple extractors; first non-empty result wins. */
declare function createCompositeExtractor<TReq extends IncomingMessage = IncomingMessage>(...extractors: ClientKeyExtractor<TReq>[]): ClientKeyExtractor<TReq>;
/** Resolves the effective extractor for a route (route override > global). */
declare function resolveExtractor<TReq extends IncomingMessage = IncomingMessage>(route: RouteConfig<TReq>, globalExtractor?: ClientKeyExtractor<TReq>): ClientKeyExtractor<TReq>;

declare function sendJson(res: ServerResponse, statusCode: number, payload: unknown, extraHeaders?: Record<string, string>): void;
declare function sendGatewayResponse(res: ServerResponse, response: GatewayResponse): void;
declare const defaultErrorBody: (code: string, message: string) => {
    error: {
        code: string;
        message: string;
    };
};

interface CacheEntry {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
    /** Epoch ms when the entry was stored. */
    storedAt: number;
}
interface CacheLookup {
    /** Entry still within TTL. */
    fresh?: CacheEntry;
    /** Entry past TTL (candidate for stale-while-circuit-open). */
    stale?: CacheEntry;
}

/**
 * In-memory RedisLike adapter: implements the token-bucket eval contract
 * plus get/set/del/ping KV ops, so sessions and rate limits work with
 * zero infrastructure. Per-process only — not shared across nodes.
 */
declare class InMemoryRedis implements RedisLike {
    private readonly buckets;
    private readonly kv;
    private readonly maxKeys;
    eval(_script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    ping(): Promise<string>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: (string | number)[]): Promise<'OK'>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}

interface JwtVerifyOptions {
    issuer?: string;
    audience?: string | readonly string[];
    clockToleranceSec?: number;
    /** Injectable clock for tests. */
    now?: () => number;
}
interface JwtClaims {
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
/** Sign HS256 JWT claims. `expiresInSec` sets `exp`; `now` in seconds. */
declare function signJwt(claims: JwtClaims, secret: string, options?: {
    issuer?: string;
    audience?: string | readonly string[];
    expiresInSec?: number;
    now?: number;
}): string;
/**
 * Verify an HS256 JWT: signature (timing-safe), exp, nbf, iss, aud.
 * Returns claims or null — never throws on bad input.
 */
declare function verifyJwt(token: string, secret: string, options?: JwtVerifyOptions): JwtClaims | null;

/** Wraps symmetric HS256 Bearer verification as an AuthProvider. */
declare function createJwtProvider<TReq extends IncomingMessage = IncomingMessage>(config: JwtAuthConfig): AuthProvider<TReq>;
/**
 * Asymmetric JWT verification against a remote JWKS endpoint.
 * Uses node:crypto only — `createPublicKey({ format: 'jwk' })` +
 * `crypto.verify`. Caches keys and refreshes once on unknown `kid`.
 */
declare function createJwksProvider<TReq extends IncomingMessage = IncomingMessage>(options: JwksProviderOptions): AuthProvider<TReq>;
/**
 * Forward the request credential to an external auth/introspection
 * endpoint (Supabase /auth/v1/user, Ory, custom service) and map the
 * JSON response into a VerifiedIdentity. Positive results can be
 * cached in a GatewayStore to eliminate per-request latency.
 */
declare function createIntrospectionProvider<TReq extends IncomingMessage = IncomingMessage>(options: IntrospectionProviderOptions): AuthProvider<TReq>;

type RateLimitString = `${number}/sec` | `${number}/min` | `${number}/hour`;
type DurationString = `${number}ms` | `${number}s` | `${number}m` | `${number}h` | `${number}d`;
type RateLimitInput = RateLimitRule | RateLimitString;
type CacheInput = number | DurationString | RouteCacheConfig;
type UpstreamInput = `http://${string}` | `https://${string}` | readonly (`http://${string}` | `https://${string}`)[];
/** Parse '60/sec' | '120/min' | '1000/hour' → token bucket rule. Throws on malformed input. */
declare function parseRateLimit(input: RateLimitInput): RateLimitRule;
/** Parse '500ms' | '30s' | '5m' | '7d' (or a number of ms) → milliseconds. */
declare function parseDurationMs(input: number | DurationString): number;
/** Normalize '/api/*' → '/api' (wildcard suffix supported in the DSL). */
declare function normalizePrefix(path: string): string;
interface RouteShortcut<TReq extends IncomingMessage = IncomingMessage> {
    auth?: boolean | readonly string[];
    rateLimit?: RateLimitInput;
    cache?: CacheInput;
    stripPrefix?: boolean;
    circuitBreaker?: Partial<CircuitBreakerOptions>;
    extractClientKey?: ClientKeyExtractor<TReq>;
}
interface RouteDefinition<TReq extends IncomingMessage = IncomingMessage> extends RouteShortcut<TReq> {
    path: `/${string}` | `${string}/*`;
    to: UpstreamInput;
}
/**
 * Concise route helper:
 *
 * ```ts
 * route('/api/users/*', 'http://users:4001', { auth: true, rateLimit: '120/min', cache: '30s' })
 * ```
 */
/** A built route that also retains its DSL definition for group() merging. */
type RouteResult<TReq extends IncomingMessage = IncomingMessage> = RouteConfig<TReq> & RouteDefinition<TReq>;
declare function route<TReq extends IncomingMessage = IncomingMessage>(path: `/${string}` | `${string}/*`, to: UpstreamInput, options?: RouteShortcut<TReq>): RouteResult<TReq>;
/**
 * Route group: shared policies are inherited by every child route and
 * the group prefix is prepended to each child path.
 *
 * ```ts
 * group('/api/v1', { auth: true, rateLimit: '100/min' }, [
 *   route('/users', 'http://users:4001'),
 *   route('/orders', 'http://orders:4002', { rateLimit: '500/min' }),
 * ]);
 * ```
 */
declare function group<TReq extends IncomingMessage = IncomingMessage>(prefix: `/${string}`, shared: RouteShortcut<TReq>, routes: readonly RouteDefinition<TReq>[]): RouteConfig<TReq>[];

/**
 * Async route discovery — supports .js/.cjs/.mjs/.ts modules.
 * Each module may default-export (or named-export) a route object,
 * an array of routes, or the output of `route()`/`group()`.
 */
declare function loadRoutesDir<TReq extends IncomingMessage = IncomingMessage>(dir: string): Promise<RouteConfig<TReq>[]>;
/**
 * Synchronous route discovery for `createGateway({ routesDir })`.
 * Supports .js/.cjs only — use `loadRoutesDir` for .ts/.mjs.
 */
declare function loadRoutesDirSync<TReq extends IncomingMessage = IncomingMessage>(dir: string): RouteConfig<TReq>[];

interface SignInput {
    secret: string;
    method: string;
    path: string;
    userId: string;
    requestId: string;
    timestampMs?: number;
    headerName?: string;
    timestampHeader?: string;
}
/**
 * Produce the signature + timestamp header pair for an upstream request.
 * Downstream services verify with `verifyGatewaySignature`.
 */
interface SignResult {
    /** Header name → value pairs to attach to the upstream request. */
    headers: Record<string, string>;
    timestampMs: number;
}
declare function signGatewayRequest(input: SignInput): SignResult;
interface VerifyOptions {
    headerName?: string;
    timestampHeader?: string;
    /** Injectable clock for tests. */
    now?: () => number;
}
/**
 * Verify an upstream request signature. Returns true only when the
 * HMAC matches (timing-safe) and the timestamp is within `maxAgeMs`.
 * Intended for downstream Node services to confirm gateway origin
 * and reject replays.
 */
declare function verifyGatewaySignature(headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>, method: string, path: string, secret: string, maxAgeMs?: number, options?: VerifyOptions): boolean;
/** Resolve signing config into concrete header names (for ProxyHandler). */
declare function resolveSigningConfig(config: UpstreamSigningConfig): Required<UpstreamSigningConfig>;

/** SHA-256 hex digest of a raw API key — keys are never stored/compared raw. */
declare function hashApiKey(rawKey: string): string;
type ApiKeyAuthResult = {
    ok: true;
    record: ApiKeyRecord;
} | {
    ok: false;
    reason: 'missing' | 'invalid' | 'expired' | 'forbidden';
};
/**
 * Scoped API key guard. Extracts the raw key from the configured header,
 * hashes it, resolves via the provider, enforces expiry and route scopes,
 * and exposes per-key rate limit overrides.
 */
declare class ApiKeyGuard {
    private readonly provider;
    private readonly headerName;
    constructor(config: ApiKeyGuardConfig);
    /** Returns the raw key if present on the request. */
    extractKey(req: IncomingMessage): string | undefined;
    /**
     * Authenticate the request's API key against the route's required scopes.
     * Only invoked for routes that declare `requiredScopes`.
     */
    authenticate<TReq extends IncomingMessage>(req: IncomingMessage, route: RouteConfig<TReq>): Promise<ApiKeyAuthResult>;
}

/**
 * Per-IP brute-force lockout backed by GatewayStore.
 *
 * - `gw:bf:fail:{ip}`  — failure counter, expires after windowSec
 * - `gw:bf:lock:{ip}`  — lock marker, expires after lockDurationSec
 *
 * Uses dedicated incr/expire when the store provides them, otherwise
 * falls back to small Lua eval scripts so any RedisLike works.
 */
declare class BruteForceGuard {
    private readonly store;
    private readonly config;
    constructor(store: GatewayStore, config: BruteForceConfig);
    private failKey;
    private lockKey;
    /** Seconds remaining on an active lock, or null when not locked. */
    lockedFor(ip: string): Promise<number | null>;
    /** Record an auth failure; returns lock seconds when this trips the lock. */
    recordFailure(ip: string): Promise<number | null>;
    /** Clear failure counters (e.g. after a successful auth). */
    recordSuccess(ip: string): Promise<void>;
    private storeGet;
    private storeSet;
    private storeDel;
    private increment;
    private expire;
}

/** True when the URL targets link-local/metadata infrastructure (SSRF). */
declare function isMetadataUpstream(url: UpstreamUrl | string): boolean;
/** Validate all configured upstreams at boot; throws on metadata targets. */
declare function assertNoMetadataUpstreams(urls: readonly (UpstreamUrl | string)[], allowMetadata: boolean): void;
/** True when the request path contains traversal/injection segments. */
declare function isPathTraversal(pathname: string): boolean;
/** Strip CR/LF from a header value (CRLF injection defense). */
declare function sanitizeHeaderValue(value: string): string;
/** Content-Type enforcement for routes with allowedContentTypes. */
declare function contentTypeAllowed(req: IncomingMessage, allowed: readonly string[]): boolean;
declare function isOriginAllowed(cors: CorsConfig, origin: string | undefined): boolean;
declare function allowedOriginValue(cors: CorsConfig, origin: string | undefined): string | undefined;
declare function buildCorsHeaders(cors: CorsConfig, origin: string | undefined): Record<string, string>;
declare function isPreflight(req: IncomingMessage): boolean;
/** Validate CORS config at boot (wildcard + credentials is invalid). */
declare function assertValidCors(cors: CorsConfig): void;

/**
 * Beginner-friendly layer: sensible defaults, plain-object routes, and an
 * automatic in-memory Redis-compatible limiter so `startGateway()` works
 * with zero infrastructure.
 *
 * Route paths and upstream URLs are validated as template-literal types
 * (`` `/${string}` ``, `` `http://${string}` ``) — plain literals work
 * without any branding helpers.
 */
interface SimpleRateLimit {
    /** Sustained requests allowed per minute. Default 60. */
    readonly requestsPerMinute?: number;
    /** Burst capacity (max tokens). Defaults to requestsPerMinute. */
    readonly burst?: number;
}
type SimpleUpstream = `http://${string}` | `https://${string}` | readonly (`http://${string}` | `https://${string}`)[];
interface SimpleRoute {
    readonly path: `/${string}`;
    readonly to: SimpleUpstream;
    readonly stripPrefix?: boolean;
    /** Per-route override (requests/minute). Falls back to global rateLimit. */
    readonly limitPerMinute?: number;
}
type SimpleRouteMap = Readonly<Record<`/${string}`, `http://${string}` | `https://${string}` | readonly (`http://${string}` | `https://${string}`)[]>>;
interface QuickGatewayOptions<TReq extends IncomingMessage = IncomingMessage> extends Omit<GatewayConfig<TReq>, 'routes' | 'limiter'> {
    /**
     * Redis client (ioredis-compatible `eval`). When omitted, an internal
     * in-memory RedisLike adapter is used automatically — no Redis or Docker
     * required. Limits are then per-process.
     */
    readonly redis?: RedisLike;
    /** Object map `{ '/api': 'http://localhost:4001' }` or `SimpleRoute[]`. */
    readonly routes: SimpleRouteMap | readonly SimpleRoute[];
    /** Global rate limit. Default: 60 requests/minute, burst 60. */
    readonly rateLimit?: SimpleRateLimit;
    /** Auto per-route circuit breaker. Default true. */
    readonly autoCircuitBreaker?: boolean;
}
/**
 * Start a gateway with zero configuration:
 *
 * ```ts
 * const gw = startGateway({
 *   port: 8080,
 *   routes: { '/api': 'http://localhost:4001' },
 *   rateLimit: { requestsPerMinute: 10 },
 * });
 * await gw.listen();
 * ```
 */
declare function startGateway<TReq extends IncomingMessage = IncomingMessage>(options: QuickGatewayOptions<TReq>): Gateway<TReq>;

/** Identity helper — validates route shape at compile time. */
declare function defineRoute<TReq extends IncomingMessage = IncomingMessage>(route: DefineRouteOptions<TReq>): RouteConfig<TReq>;
/** Identity helper — validates gateway config at compile time. */
declare function defineGatewayConfig<TReq extends IncomingMessage = IncomingMessage>(config: GatewayConfig<TReq>): GatewayConfig<TReq>;
/** Branded-type constructors for literal-safe route/URL values. */
declare const asRoutePrefix: (prefix: `/${string}`) => RoutePrefix;
declare const asUpstreamUrl: (url: `http://${string}` | `https://${string}`) => UpstreamUrl;

export { type ApiKeyAuthResult, ApiKeyGuard, ApiKeyGuardConfig, ApiKeyRecord, AuthProvider, BruteForceConfig, BruteForceGuard, type CacheEntry, type CacheInput, type CacheLookup, CircuitBreakerOptions, ClientKeyExtractor, CorsConfig, DefineRouteOptions, type DurationString, Gateway, GatewayConfig, GatewayResponse, GatewayStore, InMemoryRedis, IntrospectionProviderOptions, JwksProviderOptions, JwtAuthConfig, type JwtClaims, type JwtVerifyOptions, LocalFallback, ProxyHandler, type QuickGatewayOptions, type RateLimitInput, RateLimitResult, RateLimitRule, type RateLimitString, RedisLike, RouteCacheConfig, RouteConfig, type RouteDefinition, RoutePrefix, type RouteResult, type RouteShortcut, type SignInput, type SignResult, type SimpleRateLimit, type SimpleRoute, type SimpleRouteMap, type SimpleUpstream, type UpstreamInput, UpstreamResponseInfo, UpstreamSigningConfig, UpstreamTarget, UpstreamUrl, type VerifyOptions, allowedOriginValue, asRoutePrefix, asUpstreamUrl, assertNoMetadataUpstreams, assertValidCors, buildCorsHeaders, contentTypeAllowed, createCompositeExtractor, createIntrospectionProvider, createJwksProvider, createJwtProvider, defaultErrorBody, defineGatewayConfig, defineRoute, extractApiKeyOrIp, extractClientIp, getHeaderString, group, hashApiKey, isMetadataUpstream, isOriginAllowed, isPathTraversal, isPreflight, loadRoutesDir, loadRoutesDirSync, normalizePrefix, parseDurationMs, parseRateLimit, resolveExtractor, resolveSigningConfig, route, sanitizeHeaderValue, sendGatewayResponse, sendJson, signGatewayRequest, signJwt, startGateway, verifyGatewaySignature, verifyJwt };
