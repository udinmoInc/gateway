import { IncomingMessage, ServerResponse, Server } from 'node:http';

declare const HEADERS: {
    readonly forwardedFor: "x-forwarded-for";
    readonly forwardedProto: "x-forwarded-proto";
    readonly realIp: "x-real-ip";
    readonly rateLimitLimit: "x-ratelimit-limit";
    readonly rateLimitRemaining: "x-ratelimit-remaining";
    readonly rateLimitReset: "x-ratelimit-reset";
    readonly retryAfter: "retry-after";
    readonly apiKey: "x-api-key";
    readonly authorization: "authorization";
    readonly gatewayCache: "x-gateway-cache";
    readonly cacheControl: "cache-control";
    readonly connection: "connection";
    readonly userId: "x-user-id";
    readonly userRole: "x-user-role";
    readonly requestId: "x-request-id";
    readonly wwwAuthenticate: "www-authenticate";
    readonly gatewayTimestamp: "x-gateway-timestamp";
    readonly gatewaySignature: "x-gateway-signature";
    readonly contentTypeOptions: "x-content-type-options";
    readonly frameOptions: "x-frame-options";
    readonly referrerPolicy: "referrer-policy";
    readonly strictTransportSecurity: "strict-transport-security";
    readonly origin: "origin";
    readonly accessControlRequestMethod: "access-control-request-method";
    readonly accessControlRequestHeaders: "access-control-request-headers";
    readonly accessControlAllowOrigin: "access-control-allow-origin";
    readonly accessControlAllowMethods: "access-control-allow-methods";
    readonly accessControlAllowHeaders: "access-control-allow-headers";
    readonly accessControlAllowCredentials: "access-control-allow-credentials";
    readonly accessControlMaxAge: "access-control-max-age";
    readonly apiKeyHeader: "x-api-key";
};
declare const STATUS: {
    readonly ok: 200;
    readonly created: 201;
    readonly noContent: 204;
    readonly badGateway: 502;
    readonly serviceUnavailable: 503;
    readonly gatewayTimeout: 504;
    readonly tooManyRequests: 429;
    readonly unauthorized: 401;
    readonly forbidden: 403;
    readonly payloadTooLarge: 413;
    readonly unsupportedMediaType: 415;
    readonly locked: 423;
};
declare const ERROR_CODES: {
    readonly rateLimited: "RATE_LIMITED";
    readonly circuitOpen: "CIRCUIT_OPEN";
    readonly noRoute: "NO_ROUTE";
    readonly upstreamError: "UPSTREAM_ERROR";
    readonly draining: "DRAINING";
    readonly unauthorized: "UNAUTHORIZED";
    readonly forbidden: "FORBIDDEN";
    readonly routeLoadError: "ROUTE_LOAD_ERROR";
    readonly pathTraversalBlocked: "PATH_TRAVERSAL_BLOCKED";
    readonly payloadTooLarge: "PAYLOAD_TOO_LARGE";
    readonly unsupportedMediaType: "UNSUPPORTED_MEDIA_TYPE";
    readonly policyDenied: "POLICY_DENIED";
    readonly apiKeyInvalid: "API_KEY_INVALID";
    readonly locked: "LOCKED";
};
declare const SECURITY_EVENT_TYPES: {
    readonly pathTraversalBlocked: "PATH_TRAVERSAL_BLOCKED";
    readonly bruteForceLocked: "BRUTE_FORCE_LOCKED";
    readonly authDenied: "AUTH_DENIED";
    readonly apiKeyDenied: "API_KEY_DENIED";
    readonly policyDenied: "POLICY_DENIED";
};
declare const CACHE_STATUS: {
    readonly hit: "HIT";
    readonly miss: "MISS";
    readonly stale: "STALE";
};
declare const FAIL_MODES: {
    readonly open: "open";
    readonly closed: "closed";
    readonly fallback: "fallback";
};
declare const CIRCUIT_STATES: {
    readonly closed: "CLOSED";
    readonly open: "OPEN";
    readonly halfOpen: "HALF_OPEN";
};
declare const DEFAULTS: {
    readonly port: 8080;
    readonly host: "0.0.0.0";
    readonly redisPrefix: "gw:rl";
    readonly rateLimit: {
        readonly capacity: 100;
        readonly refillPerSecond: 10;
    };
    readonly circuitBreaker: {
        readonly failureThreshold: 5;
        readonly successThreshold: 2;
        readonly openDurationMs: 30000;
        readonly probeTimeoutMs: 10000;
    };
    readonly limiter: {
        readonly localMaxKeys: 10000;
    };
    readonly proxy: {
        readonly upstreamTimeoutMs: 30000;
        readonly maxSockets: 256;
        readonly keepAlive: true;
    };
    readonly quickstart: {
        readonly requestsPerMinute: 60;
    };
    readonly autoCircuitBreaker: {
        /** Error ratio (0..1) that trips the circuit. */
        readonly failureThreshold: 0.5;
        /** Minimum upstream calls observed before ratio tripping. */
        readonly minimumRequests: 10;
        /** Cooldown before HALF_OPEN probes (ms). */
        readonly resetTimeoutMs: 15000;
        readonly successThreshold: 2;
        readonly probeTimeoutMs: 5000;
    };
    readonly inMemoryRedis: {
        readonly maxKeys: 10000;
    };
    readonly shutdown: {
        readonly drainTimeoutMs: 10000;
        readonly retryAfterSeconds: 5;
    };
    readonly probes: {
        readonly readinessTimeoutMs: 500;
    };
    readonly cache: {
        readonly maxEntries: 500;
    };
    readonly perimeter: {
        readonly maxBodyBytes: 1048576;
        readonly frameOptions: "DENY";
        readonly nosniff: "nosniff";
        readonly referrerPolicy: "no-referrer";
        readonly signatureMaxAgeMs: 60000;
        readonly signatureHeader: "x-gateway-signature";
        readonly signatureTimestampHeader: "x-gateway-timestamp";
        readonly apiKeyHashPrefix: "sha256:";
        readonly bruteForceKeyPrefix: "gw:bf:";
        readonly upstreamFingerprintHeaders: readonly ["x-powered-by", "server"];
    };
    readonly auth: {
        readonly jwtLeewaySec: 30;
        readonly jwksCacheTtlMs: 300000;
        readonly authCacheKeyPrefix: "gw:auth:";
    };
};

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & {
    readonly [__brand]: B;
};
type RoutePrefix = Brand<`/${string}`, 'RoutePrefix'>;
type UpstreamUrl = Brand<`http://${string}` | `https://${string}`, 'UpstreamUrl'>;
type CircuitState = (typeof CIRCUIT_STATES)[keyof typeof CIRCUIT_STATES];
type FailMode = (typeof FAIL_MODES)[keyof typeof FAIL_MODES];
type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
/** `true` = any valid credential; array = required roles (RBAC). */
type RouteAuth = boolean | readonly string[];
interface JwtAuthConfig {
    /** HS256 signing/verification secret (required for Bearer tokens). */
    secret: string;
    /** Optional `iss` claim requirement. */
    issuer?: string;
    /** Optional `aud` claim requirement (string or list). */
    audience?: string | readonly string[];
    /** Clock-skew tolerance in seconds for exp/nbf. Default DEFAULTS.auth.jwtLeewaySec. */
    clockToleranceSec?: number;
}
interface AuthConfig<TReq extends IncomingMessage = IncomingMessage> {
    /** Stateless Bearer JWT (HS256) verification at the edge. */
    jwt?: JwtAuthConfig;
    /**
     * Pluggable auth providers evaluated in order after `jwt`.
     * First `{ authenticated: true }` wins; `{ authenticated: false }`
     * rejects immediately; `{ skip: true }` falls through.
     */
    providers?: readonly AuthProvider<TReq>[];
    /** Value for the WWW-Authenticate realm on 401 responses. */
    realm?: string;
    /** Additional client headers always stripped before proxying. */
    stripHeaders?: readonly string[];
}
/** Result of an AuthProvider.authenticate call. */
type AuthOutcome = {
    readonly authenticated: true;
    readonly identity: VerifiedIdentity;
} | {
    readonly authenticated: false;
    readonly reason?: string;
} | {
    readonly skip: true;
};
/**
 * Pluggable authentication strategy — JWT, JWKS, introspection,
 * cookie sessions, mTLS, or any custom logic.
 */
interface AuthProvider<TReq extends IncomingMessage = IncomingMessage> {
    readonly name: string;
    authenticate(req: TReq): Promise<AuthOutcome>;
}
interface JwksProviderOptions {
    /** JWKS endpoint URL (e.g. Supabase /auth/v1/.well-known/jwks.json). */
    jwksUri: string;
    issuer?: string;
    audience?: string | readonly string[];
    /** In-memory key cache TTL. Default 300_000 (5 min). */
    cacheTtlMs?: number;
    clockToleranceSec?: number;
    /** Claim path for roles — dot-notation supported ('app_metadata.role'). */
    roleClaim?: string;
    /** Claim path for user id. Default 'sub'. */
    userIdClaim?: string;
}
interface IntrospectionProviderOptions {
    /** External auth/introspection endpoint (e.g. Supabase /auth/v1/user). */
    endpoint: string;
    method?: 'GET' | 'POST';
    /** Extra headers forwarded to the endpoint. */
    headers?: Readonly<Record<string, string>>;
    /**
     * Extract the credential to forward. Default returns the full
     * `Bearer <token>` Authorization header value.
     */
    extractCredential?: (req: IncomingMessage) => string | null;
    /** Map the endpoint's JSON response to a VerifiedIdentity (null = reject). */
    mapResponse: (body: unknown) => VerifiedIdentity | null;
    /** Positive-result cache TTL in ms. */
    cacheTtlMs?: number;
    /** Optional GatewayStore for distributed outcome caching. */
    store?: GatewayStore;
}
/** Verified caller identity attached to the request context. */
interface VerifiedIdentity {
    userId: string;
    roles: readonly string[];
}
/**
 * Structural storage contract unifying ioredis, node-redis, and
 * InMemoryRedis. Only `eval` is required; KV/incr/expire/ping are
 * optional and used when present (eval Lua fallbacks otherwise).
 */
interface GatewayStore extends RedisLike {
    incr?(key: string): Promise<number>;
    expire?(key: string, seconds: number): Promise<unknown>;
}
interface ApiKeyRecord {
    id: string;
    /** SHA-256 hex digest of the raw API key (never the key itself). */
    keyHash: string;
    tenantId: string;
    scopes: readonly string[];
    /** Epoch ms after which the key is rejected. */
    expiresAtMs?: number;
    /** Per-key rate limit override applied instead of the route rule. */
    rateLimitOverride?: RateLimitRule;
}
/** Async lookup of API keys by SHA-256 hash. */
interface ApiKeyProvider {
    resolveByHash(keyHash: string): Promise<ApiKeyRecord | null>;
}
/** Result of a plugin's onRequest policy check. */
type PolicyDecision = {
    action: 'allow';
} | {
    action: 'deny';
    statusCode?: number;
    code?: string;
    message?: string;
};
interface PluginContext<TReq extends IncomingMessage = IncomingMessage> extends RequestContext<TReq> {
    /** Elapsed time since the gateway began handling this request (ms). */
    durationMs?: number;
}
/** Lifecycle interceptor for cross-cutting gateway policy. */
interface GatewayPlugin<TReq extends IncomingMessage = IncomingMessage> {
    name: string;
    /** Return a deny decision or void/allow to continue the pipeline. */
    onRequest?(ctx: PluginContext<TReq>): PolicyDecision | void | Promise<PolicyDecision | void>;
    /** Called after the upstream responds or the request fails. */
    onResponse?(ctx: PluginContext<TReq>, statusCode: number, durationMs: number): void | Promise<void>;
}
type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES];
/** Structured audit event for SIEM/logging sinks. */
interface SecurityAuditEvent {
    type: SecurityEventType;
    timestampMs: number;
    clientIp?: string;
    path?: string;
    detail?: string;
}
interface UpstreamSigningConfig {
    secret: string;
    /** Signature header name. Default 'x-gateway-signature'. */
    headerName?: string;
    /** Timestamp header name. Default 'x-gateway-timestamp'. */
    timestampHeader?: string;
}
interface ApiKeyGuardConfig {
    provider: ApiKeyProvider;
    /** Header carrying the raw key. Default 'x-api-key'. */
    headerName?: string;
}
interface BruteForceConfig {
    /** Auth failures within windowSec before lockout. */
    maxFailures: number;
    /** Failure counting window (seconds). */
    windowSec: number;
    /** How long a locked client is rejected (seconds). */
    lockDurationSec: number;
}
interface CorsConfig {
    origins: readonly string[] | '*';
    methods?: readonly string[];
    headers?: readonly string[];
    credentials?: boolean;
    maxAgeSec?: number;
}
interface SecurityHeadersConfig {
    /** X-Frame-Options value. Default 'DENY'. */
    frameOptions?: string;
    /** Emit Strict-Transport-Security when set. */
    hsts?: {
        maxAgeSec: number;
        includeSubDomains?: boolean;
    };
}
interface RateLimitRule {
    /** Maximum burst capacity (tokens). */
    capacity: number;
    /** Tokens refilled per second. */
    refillPerSecond: number;
}
interface RateLimitResult {
    allowed: boolean;
    /** Remaining tokens after this request. */
    remaining: number;
    /** Tokens capacity (for X-RateLimit-Limit header). */
    limit: number;
    /** Epoch seconds when the bucket fully refills / next token available. */
    resetAt: number;
    /** Milliseconds until the caller may retry (0 when allowed). */
    retryAfterMs: number;
}
type ClientKeyExtractor<TReq extends IncomingMessage = IncomingMessage> = (req: TReq) => string | Promise<string>;
interface CircuitBreakerOptions {
    /** Consecutive upstream failures before opening the circuit. */
    failureThreshold: number;
    /** Consecutive successes in HALF_OPEN required to close again. */
    successThreshold: number;
    /** How long the circuit stays OPEN before a HALF_OPEN probe. */
    openDurationMs: number;
    /** Per-request timeout applied while probing in HALF_OPEN. */
    probeTimeoutMs: number;
    /**
     * Optional error-ratio mode (0..1): when set, the circuit opens once at
     * least `minimumRequests` upstream calls have been observed and the
     * failure ratio meets or exceeds this value. Takes precedence over
     * `failureThreshold` while in CLOSED.
     */
    failureRatioThreshold?: number;
    /** Minimum upstream calls observed before ratio-based tripping. */
    minimumRequests?: number;
}
interface UpstreamTarget {
    url: UpstreamUrl;
    /** Weight for weighted round-robin (default 1). */
    weight?: number;
}
interface RouteConfig<TReq extends IncomingMessage = IncomingMessage> {
    /** Route prefix, matched longest-first. Must start with '/'. */
    prefix: RoutePrefix;
    /** One or more upstream targets, load-balanced round-robin. */
    upstreams: readonly [UpstreamTarget, ...UpstreamTarget[]];
    /** Rate limit rule; omit to disable limiting for this route. */
    rateLimit?: RateLimitRule;
    /** Circuit breaker settings; omit to use gateway defaults. */
    circuitBreaker?: Partial<CircuitBreakerOptions>;
    /** Strip the matched prefix before forwarding upstream. */
    stripPrefix?: boolean;
    /** Per-route key extractor override (falls back to global extractor). */
    extractClientKey?: ClientKeyExtractor<TReq>;
    /** Optional bounded in-memory GET/HEAD response cache. */
    cache?: RouteCacheConfig;
    /**
     * Centralized auth: `false`/undefined = public, `true` = any valid
     * session or JWT, `string[]` = required roles (RBAC).
     */
    auth?: RouteAuth;
    /** Scopes a valid API key must hold (requires `apiKeys.provider`). */
    requiredScopes?: readonly string[];
    /** Allowed Content-Types for non-GET/HEAD requests (415 otherwise). */
    allowedContentTypes?: readonly string[];
}
interface GatewayHooks<TReq extends IncomingMessage = IncomingMessage> {
    /** Runs before rate limiting. Return a response object to short-circuit. */
    onRequest?(ctx: RequestContext<TReq>): void | Promise<void> | GatewayResponse;
    /** Runs after a successful rate-limit check, before proxying. */
    onAuthorized?(ctx: RequestContext<TReq>): void | Promise<void> | GatewayResponse;
    /** Called when the upstream responds (status + headers captured). */
    onUpstreamResponse?(ctx: RequestContext<TReq>, info: UpstreamResponseInfo): void | Promise<void>;
    /** Called on upstream errors/timeouts. */
    onUpstreamError?(ctx: RequestContext<TReq>, error: Error): void | Promise<void>;
}
interface RequestContext<TReq extends IncomingMessage = IncomingMessage> {
    req: TReq;
    res: ServerResponse;
    /** The matched route configuration. */
    route: RouteConfig<TReq>;
    /** The upstream selected for this request. */
    upstream: UpstreamTarget;
    /** Client key used for rate limiting. */
    clientKey: string;
    /** Verified caller identity (present only for authenticated requests). */
    identity?: VerifiedIdentity;
    /** Path with the route prefix stripped (what the upstream sees). */
    upstreamPath: string;
    /** Full upstream URL for this request. */
    upstreamUrl: string;
}
interface UpstreamResponseInfo {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    /** Present only when the proxy was asked to capture the body (cacheable GET/HEAD). */
    body?: Buffer;
}
interface GatewayResponse {
    statusCode: number;
    headers?: Record<string, string | string[] | undefined>;
    body?: string | Buffer | Uint8Array;
}
interface RedisLike {
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    defineCommand?(name: string, options: {
        numberOfKeys: number;
    }): unknown;
    /** Optional lightweight liveness probe (ioredis exposes `ping`). */
    ping?(): Promise<unknown>;
    /** Optional key-value accessors used by the session store (ioredis-compatible). */
    get?(key: string): Promise<string | null>;
    set?(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
    del?(key: string): Promise<unknown>;
}
interface RouteCacheConfig {
    /** How long a cached response stays fresh (ms). Required. */
    ttlMs: number;
    /** Max cached entries for this route. Default DEFAULTS.cache.maxEntries (500). */
    maxEntries?: number;
    /** Serve expired cache when the route's circuit breaker is OPEN. */
    serveStaleOnCircuitOpen?: boolean;
    /** Allow caching responses for authenticated requests. Default false. */
    allowAuthenticated?: boolean;
}
interface GatewayProbes {
    /** Exact path answered with liveness 200, bypassing limits/routes. */
    livenessPath?: RoutePrefix;
    /** Exact path answered with readiness (checks Redis + circuits). */
    readinessPath?: RoutePrefix;
    /** Redis PING timeout for readiness. Default DEFAULTS.probes.readinessTimeoutMs (500). */
    readinessTimeoutMs?: number;
}
interface RateLimiterOptions {
    /** Redis client implementing eval (ioredis-compatible). */
    redis?: RedisLike;
    /** Fail mode when Redis is unreachable. Default 'fallback'. */
    failMode?: FailMode;
    /** Redis key prefix. Default from DEFAULTS.redisPrefix. */
    keyPrefix?: string;
    /** Max keys held by the in-memory fallback LRU. */
    localMaxKeys?: number;
    /** Redis command timeout in ms before failing over. */
    commandTimeoutMs?: number;
}
interface GatewayServerOptions<TReq extends IncomingMessage = IncomingMessage> {
    port?: number;
    host?: string;
    /** Global client key extractor used when a route doesn't define one. */
    extractClientKey?: ClientKeyExtractor;
    /** Per-request upstream timeout. */
    upstreamTimeoutMs?: number;
    /** Max sockets per upstream agent. */
    maxSockets?: number;
    /** Global hooks applied to every route. */
    hooks?: GatewayHooks<TReq>;
    /** Optional /healthz-style liveness and /readyz-style readiness probes. */
    probes?: GatewayProbes;
    /** Centralized auth/session configuration. */
    auth?: AuthConfig<TReq>;
    /**
     * Directory containing route definition modules (*.js/*.cjs loaded
     * synchronously; use `loadRoutesDir` for *.ts/*.mjs).
     */
    routesDir?: string;
    /** HMAC-sign every proxied request for downstream verification. */
    upstreamSigning?: UpstreamSigningConfig;
    /** Scoped API key authentication via SHA-256 hash lookup. */
    apiKeys?: ApiKeyGuardConfig;
    /** Per-IP brute-force lockout on auth failures. */
    bruteForce?: BruteForceConfig;
    /** CORS policy; `'*'` + credentials is rejected at boot. */
    cors?: CorsConfig;
    /** Response security headers (X-Frame-Options, optional HSTS). */
    securityHeaders?: SecurityHeadersConfig;
    /** Replace upstream 5xx bodies with a sanitized error. */
    maskUpstreamErrors?: boolean;
    /** Allow upstreams pointing at link-local/metadata IPs (SSRF guard opt-out). */
    allowMetadataUpstreams?: boolean;
    /** Exact path for a lightweight health probe (200/503). */
    healthPath?: RoutePrefix;
    /** Lifecycle plugins (policy interceptors, metrics). */
    plugins?: readonly GatewayPlugin<TReq>[];
    /** Max request body bytes. Default DEFAULTS.perimeter.maxBodyBytes (1 MiB). */
    maxBodyBytes?: number;
    /** Structured security audit sink (SIEM/logging). */
    onSecurityEvent?: (event: SecurityAuditEvent) => void;
}
interface GatewayConfig<TReq extends IncomingMessage = IncomingMessage> extends GatewayServerOptions<TReq> {
    /** Route table. May be omitted when `routesDir` is provided. */
    routes?: readonly RouteConfig<TReq>[];
    limiter?: RateLimiterOptions;
}
interface DefineRouteOptions<TReq extends IncomingMessage = IncomingMessage> extends Omit<RouteConfig<TReq>, 'prefix'> {
    prefix: `/${string}`;
}

/**
 * Distributed token-bucket rate limiter backed by Redis + Lua.
 * Falls back per configured fail mode when Redis is unreachable:
 *  - 'open'    : allow the request (availability first)
 *  - 'closed'  : deny the request (strict limiting)
 *  - 'fallback': delegate to a bounded in-memory LRU bucket
 */
declare class RedisRateLimiter {
    private readonly redis;
    private readonly failMode;
    private readonly keyPrefix;
    private readonly timeoutMs;
    private readonly local;
    private warnedNoRedis;
    constructor(options?: RateLimiterOptions);
    consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
    /** Bulk pre-check used by adapters that want headers before deciding. */
    check(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
    /**
     * Liveness probe for readiness checks. In-memory mode is always ready;
     * a configured Redis must answer PING within the command timeout.
     */
    ping(timeoutMs?: number): Promise<boolean>;
    private handleFailure;
    private parseResult;
}

interface CircuitBreakerLike {
    /** Returns true if a request may proceed for this key. */
    canExecute(key: string): boolean;
    /** Record an upstream success for this key. */
    recordSuccess(key: string): void;
    /** Record an upstream failure for this key. */
    recordFailure(key: string): void;
    /** Current state for observability. */
    stateOf(key: string): CircuitState;
    /** Drop all state (tests / config reload). */
    reset(): void;
}
/**
 * CLOSED -> OPEN -> HALF_OPEN state machine, keyed per route+upstream.
 * OPEN blocks traffic for openDurationMs, then allows a limited number of
 * probe requests. Probes need `successThreshold` consecutive successes to
 * close; any failure re-opens immediately.
 */
declare class CircuitBreaker implements CircuitBreakerLike {
    private readonly states;
    private readonly defaults;
    private readonly overrides;
    private readonly now;
    constructor(defaults?: Partial<CircuitBreakerOptions>, now?: () => number);
    /** Register per-key option overrides (e.g. per route). */
    configure(key: string, options: Partial<CircuitBreakerOptions>): void;
    canExecute(key: string): boolean;
    recordSuccess(key: string): void;
    recordFailure(key: string): void;
    private open;
    stateOf(key: string): CircuitState;
    reset(): void;
    private getOrCreate;
    private optionsFor;
}

interface ResolvedRoute<TReq extends IncomingMessage> {
    route: RouteConfig<TReq>;
    /** Path after stripping the matched prefix (always starts with '/'). */
    strippedPath: string;
}
/**
 * Longest-prefix route resolver + weighted round-robin upstream balancer.
 */
declare class Router<TReq extends IncomingMessage = IncomingMessage> {
    private readonly routes;
    private readonly counters;
    constructor(routes: readonly RouteConfig<TReq>[]);
    resolve(req: TReq): ResolvedRoute<TReq> | undefined;
    /** Weighted round-robin upstream selection. Key should be route prefix. */
    nextUpstream(key: string, upstreams: readonly UpstreamTarget[]): UpstreamTarget;
}

interface ShutdownOptions {
    /** Max time to wait for in-flight requests. Default 10s. */
    drainTimeoutMs?: number;
}
interface Gateway<TReq extends IncomingMessage = IncomingMessage> {
    /** Underlying HTTP server (standalone mode). */
    readonly server: Server;
    /** Express/Fastify-compatible request handler. */
    handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
    readonly router: Router<TReq>;
    readonly limiter: RedisRateLimiter;
    readonly circuitBreaker: CircuitBreaker;
    listen(port?: number, host?: string): Promise<void>;
    /**
     * Graceful shutdown: reject new requests with 503 + Connection: close,
     * wait for in-flight requests (capped by drainTimeoutMs), then close
     * the server and upstream agents.
     */
    shutdown(options?: ShutdownOptions): Promise<void>;
    close(): Promise<void>;
}
declare function createGateway<TReq extends IncomingMessage = IncomingMessage>(config: GatewayConfig<TReq>): Gateway<TReq>;

export { type SecurityAuditEvent as $, type AuthProvider as A, type BruteForceConfig as B, type ClientKeyExtractor as C, type DefineRouteOptions as D, DEFAULTS as E, ERROR_CODES as F, type GatewayConfig as G, type ErrorCode as H, type IntrospectionProviderOptions as I, type JwksProviderOptions as J, FAIL_MODES as K, type FailMode as L, type GatewayHooks as M, type GatewayPlugin as N, type GatewayProbes as O, HEADERS as P, type PluginContext as Q, type RouteConfig as R, type PolicyDecision as S, type RateLimiterOptions as T, type UpstreamTarget as U, RedisRateLimiter as V, type RequestContext as W, type RouteAuth as X, Router as Y, SECURITY_EVENT_TYPES as Z, STATUS as _, type Gateway as a, type SecurityEventType as a0, type SecurityHeadersConfig as a1, type ShutdownOptions as a2, type VerifiedIdentity as a3, type RateLimitRule as b, createGateway as c, type RateLimitResult as d, type UpstreamResponseInfo as e, type GatewayResponse as f, type RedisLike as g, type JwtAuthConfig as h, type RouteCacheConfig as i, type CircuitBreakerOptions as j, type UpstreamSigningConfig as k, type ApiKeyRecord as l, type ApiKeyGuardConfig as m, type GatewayStore as n, type CorsConfig as o, type UpstreamUrl as p, type RoutePrefix as q, type ApiKeyProvider as r, type AuthConfig as s, type AuthOutcome as t, type Brand as u, CACHE_STATUS as v, CIRCUIT_STATES as w, CircuitBreaker as x, type CircuitBreakerLike as y, type CircuitState as z };
