import { IncomingMessage, ServerResponse, Server } from 'node:http';

declare const HEADERS: {
    readonly forwardedFor: "x-forwarded-for";
    readonly forwardedProto: "x-forwarded-proto";
    readonly realIp: "x-real-ip";
    readonly rateLimitLimit: "x-ratelimit-limit";
    readonly rateLimitRemaining: "x-ratelimit-remaining";
    readonly rateLimitReset: "x-ratelimit-reset";
    readonly rateLimitSource: "x-ratelimit-source";
    readonly retryAfter: "retry-after";
    readonly apiKey: "x-api-key";
    readonly authorization: "authorization";
    readonly gatewayCache: "x-gateway-cache";
    readonly cacheControl: "cache-control";
    readonly connection: "connection";
    readonly requestId: "x-request-id";
    readonly gatewaySubject: "x-gateway-subject";
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
    readonly idempotencyKey: "idempotency-key";
    readonly idempotentReplay: "x-idempotent-replay";
    readonly coalesced: "x-coalesced";
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
    readonly conflict: 409;
    readonly unprocessableEntity: 422;
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
    readonly locked: "LOCKED";
    readonly idempotencyMismatch: "IDEMPOTENCY_MISMATCH";
    readonly conflict: "CONFLICT";
    readonly overloaded: "OVERLOADED";
};
declare const SECURITY_EVENT_TYPES: {
    readonly pathTraversalBlocked: "PATH_TRAVERSAL_BLOCKED";
    readonly bruteForceLocked: "BRUTE_FORCE_LOCKED";
    readonly authDenied: "AUTH_DENIED";
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
        readonly bruteForceKeyPrefix: "gw:bf:";
        readonly upstreamFingerprintHeaders: readonly ["x-powered-by", "server"];
    };
    readonly resilience: {
        readonly idempotencyTtlMs: 86400000;
        readonly idempotencyLockTimeoutMs: 30000;
        readonly idempotencyMethods: readonly ["POST", "PATCH", "DELETE"];
        readonly idempotencyKeyPrefix: "gw:idem:";
        readonly coalesceLeaseMs: 3000;
        readonly coalesceWaitMs: 2800;
        readonly coalescePollMs: 100;
        readonly leaseKeyPrefix: "gw:lease:";
        readonly l2KeyPrefix: "gw:l2:";
        readonly cbKeyPrefix: "gw:cb:";
        readonly l2StaleRetentionFactor: 2;
    };
    readonly networking: {
        readonly eventLoopResolutionMs: 20;
        readonly maxEventLoopDelayMs: 150;
        readonly shedRetryAfterSec: 1;
        readonly upstreamMaxSockets: 256;
        readonly upstreamMaxFreeSockets: 64;
        readonly upstreamKeepAliveMsecs: 4000;
        readonly serverKeepAliveTimeoutMs: 5000;
        readonly serverHeadersTimeoutMs: 60000;
        readonly serverRequestTimeoutMs: 300000;
        readonly upgradeHandshakeTimeoutMs: 10000;
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
/** Read-only context handed to every EdgeGuard. */
interface EdgeRequestContext<TReq extends IncomingMessage = IncomingMessage> {
    req: TReq;
    method: string;
    /** Request path (no query). */
    path: string;
    /** Raw req.url including query. */
    url: string | undefined;
    /** Resolved route prefix, when inside a route. */
    routePrefix?: string;
    /** Rate-limit client key. */
    clientKey: string;
    clientIp?: string;
    /**
     * Generic domain tags emitted by previously-allowed guards in this
     * pipeline (immutable bag — guards read, never write). Keys/values
     * are whatever the developer's guards produce: plan, tenant,
     * region, feature flags, etc.
     */
    tags: Readonly<Record<string, string>>;
    /**
     * Headers emitted by previously-allowed guards in this pipeline
     * (lowercased) — trusted values injected upstream.
     */
    headers: Record<string, string>;
}
type EdgeGuardDecision = {
    action: 'allow';
    /** Trusted headers to inject upstream. */
    headers?: Record<string, string>;
    /** Domain tags attached to the request context (merged). */
    tags?: Readonly<Record<string, string>>;
} | {
    action: 'deny';
    status: number;
    code: string;
    message: string;
    headers?: Record<string, string>;
};
/**
 * Stateless edge guard — the ONLY extension point for request
 * interception in core. Implementations live in userland; the engine
 * never imports domain logic.
 */
interface EdgeGuard<TReq extends IncomingMessage = IncomingMessage> {
    readonly name?: string;
    evaluate(ctx: EdgeRequestContext<TReq>): Promise<EdgeGuardDecision> | EdgeGuardDecision;
}
/**
 * Developer-friendly protection contract — implement `verify()` with
 * any domain logic (sessions, tenants, feature flags, quotas, mTLS)
 * and attach it via `asProtection()`.
 */
interface ProtectionProvider<TReq extends IncomingMessage = IncomingMessage> {
    readonly name?: string;
    verify(ctx: EdgeRequestContext<TReq>): Promise<{
        readonly allow: true;
        /** Arbitrary domain tags attached to request context. */
        readonly tags?: Readonly<Record<string, string>>;
        /** Trusted headers injected into the upstream request. */
        readonly headers?: Readonly<Record<string, string>>;
    } | {
        readonly allow: false;
        readonly status?: number;
        readonly code?: string;
        readonly message?: string;
        readonly headers?: Readonly<Record<string, string>>;
    }>;
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
    /**
     * Tag key whose value is signed as the request "subject" (e.g.
     * 'tenant', 'subject'). Default: no subject is signed.
     */
    subjectTag?: string;
    /**
     * Header carrying the subject upstream so verifiers can rebuild
     * the signed payload. Default 'x-gateway-subject'.
     */
    subjectHeader?: string;
    /** Signature header name. Default 'x-gateway-signature'. */
    headerName?: string;
    /** Timestamp header name. Default 'x-gateway-timestamp'. */
    timestampHeader?: string;
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
    /**
     * Lease up to N tokens per Redis round-trip; intermediate requests
     * are served from a bounded local credit window. Clamped to
     * `capacity`. Default 1 (one token per call).
     */
    batchSize?: number;
}
/** Which backend produced a rate-limit decision. */
type RateLimitSource = 'redis' | 'local' | 'local-fallback' | 'fail-open' | 'fail-closed' | 'batch';
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
    /** Backend that produced this decision (X-RateLimit-Source). */
    source?: RateLimitSource;
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
     * Per-route edge guards evaluated after global `config.guards`.
     * First deny wins; allow-headers are merged and injected upstream.
     */
    guards?: readonly EdgeGuard<TReq>[];
    /** Additional client headers stripped before proxying (merged with global stripHeaders). */
    stripHeaders?: readonly string[];
    /** Allowed Content-Types for non-GET/HEAD requests (415 otherwise). */
    allowedContentTypes?: readonly string[];
    /** Distributed idempotency for mutating methods carrying Idempotency-Key. */
    idempotency?: IdempotencyConfig;
    /** Upstream selection strategy. Default 'p2c' when multiple upstreams. */
    upstreamStrategy?: 'weighted-rr' | 'p2c';
    /** Speculative hedged requests for idempotent GET/HEAD traffic. */
    hedging?: HedgingConfig;
}
type DurationString = `${number}ms` | `${number}s` | `${number}m` | `${number}h` | `${number}d`;
type RateLimitString = `${number}/sec` | `${number}/min` | `${number}/hour`;
type RateLimitInput = RateLimitRule | RateLimitString;
type CacheInput = number | DurationString | RouteCacheConfig;
/** A single upstream: URL string, port number, ':port', 'host:port', or { url, weight }. */
type UpstreamTargetInput = string | number | {
    readonly url: string | number;
    readonly weight?: number;
};
/** One upstream or a list of them (weighted canaries supported). */
type UpstreamInput = UpstreamTargetInput | readonly UpstreamTargetInput[];
/** Circuit-breaker override accepting duration shorthands. */
interface CircuitBreakerInput extends Omit<Partial<CircuitBreakerOptions>, 'openDurationMs'> {
    openDurationMs?: number | DurationString;
}
/** RouteConfig fields shared by every shorthand form. */
interface RouteShorthandFields<TReq extends IncomingMessage = IncomingMessage> extends Omit<RouteConfig<TReq>, 'prefix' | 'upstreams' | 'rateLimit' | 'circuitBreaker' | 'cache'> {
    rateLimit?: RateLimitInput;
    circuitBreaker?: CircuitBreakerInput;
    cache?: CacheInput;
}
/** `{ prefix, upstreams|to, ... }` form — plain strings allowed. */
interface MappedRouteConfig<TReq extends IncomingMessage = IncomingMessage> extends RouteShorthandFields<TReq> {
    prefix: `/${string}`;
    upstreams?: UpstreamInput;
    /** Alias for `upstreams`. */
    to?: UpstreamInput;
}
/** `{ path, to, ... }` DSL-definition form (route()/group() output shape). */
interface PathRouteConfig<TReq extends IncomingMessage = IncomingMessage> extends RouteShorthandFields<TReq> {
    path: `/${string}` | `${string}/*`;
    to: UpstreamInput;
}
type RouteInput<TReq extends IncomingMessage = IncomingMessage> = RouteConfig<TReq> | MappedRouteConfig<TReq> | PathRouteConfig<TReq>;
/** Plain object map `{ '/api': 'http://host' }`. */
type RouteMapInput = Readonly<Record<`/${string}`, UpstreamInput>>;
/** Everything `routes` accepts: built configs, shorthands, or a route map. */
type RoutesInput<TReq extends IncomingMessage = IncomingMessage> = readonly RouteInput<TReq>[] | RouteMapInput;
/** Env-var auto-discovery for routes (`GATEWAY_USERS=4001` → `/users`). */
interface AutoRoutesConfig {
    /** Env var prefix to scan. Default 'GATEWAY_'. */
    envPrefix?: string;
    /** Env source — defaults to `process.env` (injectable for tests). */
    env?: Readonly<Record<string, string | undefined>>;
}
/**
 * Options accepted by `gateway.reloadRoutes()` — same shape as the
 * route-related subset of GatewayConfig, so target/basePrefix/autoRoutes
 * and global defaults behave identically on hot reload.
 */
interface RouteReloadConfig<TReq extends IncomingMessage = IncomingMessage> {
    routes?: RoutesInput<TReq>;
    target?: UpstreamInput;
    rateLimit?: RateLimitInput;
    circuitBreaker?: CircuitBreakerInput;
    cache?: CacheInput;
    autoRoutes?: AutoRoutesConfig;
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
    /** Called when a request is rejected with 429 (rate limited). */
    onRateLimited?(ctx: RequestContext<TReq>, result: RateLimitResult): void | Promise<void>;
    /** Called when a request is rejected because the upstream circuit is OPEN. */
    onCircuitOpen?(ctx: RequestContext<TReq>): void | Promise<void>;
    /** Called on proxy-level errors (alias alongside onUpstreamError). */
    onProxyError?(ctx: RequestContext<TReq>, error: Error): void | Promise<void>;
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
    /**
     * Generic domain tags emitted by edge guards (plan, tenant, region…).
     * Read-only for plugins/hooks.
     */
    tags: Readonly<Record<string, string>>;
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
    /**
     * Optional EVALSHA fast path — the limiter prefers this when present
     * and falls back to `eval` on NOSCRIPT.
     */
    evalSha?(sha1: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
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
/** Speculative request hedging for idempotent GET/HEAD routes. */
interface HedgingConfig {
    enabled: boolean;
    /** Delay before firing a hedge request (ms). */
    delayMs: number;
    /** Max additional upstream attempts. Default 1. */
    maxHedges?: number;
}
/** Event-loop / concurrency load shedding configuration. */
interface LoadSheddingConfig {
    enabled: boolean;
    /** p99 event-loop delay threshold (ms). Default 150. */
    maxEventLoopDelayMs?: number;
    /** In-flight request ceiling. Default unlimited. */
    maxConcurrentRequests?: number;
}
/** Live per-upstream connection pool metrics. */
interface UpstreamPoolMetrics {
    activeSockets: number;
    freeSockets: number;
    queuedRequests: number;
    inFlight: number;
}
/** Per-route distributed idempotency configuration. */
interface IdempotencyConfig {
    enabled: boolean;
    /** How long COMPLETED responses are replayed. Default 24h. */
    ttlMs?: number;
    /** Max time a request may hold the IN_PROGRESS lock / followers wait. Default 30s. */
    lockTimeoutMs?: number;
    /** Methods subject to idempotency. Default POST/PATCH/DELETE. */
    methods?: readonly string[];
}
interface RouteCacheConfig {
    /** How long a cached response stays fresh (ms). Required. */
    ttlMs: number;
    /** Max cached entries for this route. Default DEFAULTS.cache.maxEntries (500). */
    maxEntries?: number;
    /** Serve expired cache when the route's circuit breaker is OPEN. */
    serveStaleOnCircuitOpen?: boolean;
    /**
     * Allow caching responses for requests carrying guard-emitted
     * tags/headers. Default false — contextual responses are never
     * cached unless the route opts in.
     */
    allowContextual?: boolean;
    /**
     * Cache-key variation on guard-emitted tags (e.g. ['tenant','plan']).
     * Values are read from `ctx.tags`; missing keys contribute nothing.
     */
    varyTags?: readonly string[];
    /**
     * Cache-key variation on inbound request headers (e.g.
     * ['accept-language','x-tenant-id']). Values are read from
     * `req.headers`.
     */
    varyHeaders?: readonly string[];
    /**
     * Collapse concurrent identical cache-miss GET/HEAD requests onto one
     * upstream fetch (in-process singleflight + cross-node lease).
     * Default true when caching is enabled.
     */
    coalesce?: boolean;
}
interface GatewayProbes {
    /** Exact path answered with liveness 200, bypassing limits/routes. */
    livenessPath?: `/${string}`;
    /** Exact path answered with readiness (checks Redis + circuits). */
    readinessPath?: `/${string}`;
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
    /** Upgrade/WebSocket handshake timeout (ms). Default DEFAULTS.networking.upgradeHandshakeTimeoutMs. */
    upgradeHandshakeTimeoutMs?: number;
    /**
     * Serve gateway metrics (Prometheus text or JSON via Accept header)
     * when the request path equals this value. The endpoint flows through
     * the normal route pipeline — define a matching route (optionally
     * wrapped in asProtection) to guard/rate-limit it.
     */
    metricsPath?: `/${string}`;
    /** Max sockets per upstream agent (alias of maxSocketsPerUpstream). */
    maxSockets?: number;
    /** Max sockets per upstream origin agent. Default DEFAULTS.proxy.maxSockets (256). */
    maxSocketsPerUpstream?: number;
    /** Global hooks applied to every route. */
    hooks?: GatewayHooks<TReq>;
    /** Optional /healthz-style liveness and /readyz-style readiness probes. */
    probes?: GatewayProbes;
    /**
     * Global edge guards — the request-interception extension point.
     * Guards are stateless, composable, and supplied by the developer
     * (or `asProtection` wrappers). First deny wins; allow-headers and
     * allow-tags merge into the request context.
     */
    guards?: readonly EdgeGuard<TReq>[];
    /** Client headers always stripped before proxying (anti-spoofing). */
    stripHeaders?: readonly string[];
    /**
     * Directory containing route definition modules (*.js/*.cjs loaded
     * synchronously; use `loadRoutesDir` for *.ts/*.mjs).
     */
    routesDir?: string;
    /** HMAC-sign every proxied request for downstream verification. */
    upstreamSigning?: UpstreamSigningConfig;
    /** Per-IP brute-force lockout on guard denials. */
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
    healthPath?: `/${string}`;
    /** Lifecycle plugins (policy interceptors, metrics). */
    plugins?: readonly GatewayPlugin<TReq>[];
    /** Max request body bytes. Default DEFAULTS.perimeter.maxBodyBytes (1 MiB). */
    maxBodyBytes?: number;
    /** Structured security audit sink (SIEM/logging). */
    onSecurityEvent?: (event: SecurityAuditEvent) => void;
}
interface GatewayConfig<TReq extends IncomingMessage = IncomingMessage> extends GatewayServerOptions<TReq> {
    /**
     * Route table. Accepts built `route()`/`group()`/`defineRoute()` configs,
     * plain-string shorthands, or an object map `{ '/api': 'http://host' }`.
     * May be omitted when `routesDir` or `target` is provided.
     */
    routes?: RoutesInput<TReq>;
    /**
     * Zero-route shorthand: when `routes` is omitted, compiles a catch-all
     * `'/'` route to this target with the top-level defaults below.
     */
    target?: UpstreamInput;
    /** Rate limit applied to the `target` catch-all route. */
    rateLimit?: RateLimitInput;
    /** Circuit-breaker override applied to the `target` catch-all route. */
    circuitBreaker?: CircuitBreakerInput;
    /** Cache config applied to the `target` catch-all route. */
    cache?: CacheInput;
    /** Prepended to every route prefix (e.g. '/api' → '/api/users'). */
    basePrefix?: string;
    /** Auto-register routes from env vars (`GATEWAY_USERS=4001` → `/users`). */
    autoRoutes?: AutoRoutesConfig;
    limiter?: RateLimiterOptions;
    /** Event-loop / concurrency load shedding (503 OVERLOADED). */
    loadShedding?: LoadSheddingConfig;
}
interface DefineRouteOptions<TReq extends IncomingMessage = IncomingMessage> extends Omit<RouteConfig<TReq>, 'prefix'> {
    prefix: `/${string}`;
}

declare class RedisRateLimiter {
    private readonly redis;
    private readonly failMode;
    private readonly keyPrefix;
    private readonly timeoutMs;
    private readonly local;
    /**
     * Locally-banked batch tokens per Redis key (batchSize > 1 leasing).
     * Bounded FIFO — high-cardinality keys can't grow it unboundedly.
     */
    private readonly batchCredits;
    private warnedNoRedis;
    constructor(options?: RateLimiterOptions);
    consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
    /** Tokens leased per Redis round-trip (clamped to burst capacity). */
    private batchFor;
    /** EVALSHA first (pre-loaded script), EVAL fallback on NOSCRIPT. */
    private runScript;
    private setBatchCredit;
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
 *
 * When a GatewayStore is attached, OPEN transitions are published as
 * markers so peer nodes respect them immediately, and HALF_OPEN probes
 * are gated by an atomic NX lease so only one node probes at a time.
 */
declare class CircuitBreaker implements CircuitBreakerLike {
    private readonly states;
    private readonly defaults;
    private readonly overrides;
    private readonly now;
    private store;
    private nodeId;
    constructor(defaults?: Partial<CircuitBreakerOptions>, now?: () => number);
    /** Attach a shared store for cross-node OPEN propagation + probe leases. */
    setDistributedStore(store: GatewayStore, nodeId: string): void;
    /** Register per-key option overrides (e.g. per route). */
    configure(key: string, options: Partial<CircuitBreakerOptions>): void;
    canExecute(key: string): boolean;
    /**
     * Distributed-aware canExecute: honors OPEN markers published by peer
     * nodes and serializes HALF_OPEN probes across the fleet via an
     * atomic NX lease. Falls back to local behavior without a store.
     */
    canExecuteShared(key: string): Promise<boolean>;
    /** State including peer-published OPEN markers. */
    stateOfShared(key: string): Promise<CircuitState>;
    recordSuccess(key: string): void;
    recordFailure(key: string): void;
    private open;
    /** Best-effort release of open marker + probe lease after recovery. */
    private releaseDistributed;
    private openKey;
    private probeKey;
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
    /** O(1) exact-path hits (pathname === prefix) checked before prefix scan. */
    private readonly exact;
    private readonly counters;
    constructor(routes: readonly RouteConfig<TReq>[]);
    resolve(req: TReq): ResolvedRoute<TReq> | undefined;
    /** Weighted round-robin upstream selection. Key should be route prefix. */
    nextUpstream(key: string, upstreams: readonly UpstreamTarget[]): UpstreamTarget;
}

type MetricOutcome = 'request' | 'rate_limited' | 'circuit_open' | 'cache_hit' | 'upstream_error';
/**
 * Lock-free (single-threaded) per-route counters + rolling latency
 * quantiles. Always cheap to record; only rendered when metricsPath
 * (or gateway.metrics) is consumed.
 */
declare class MetricsCollector {
    private readonly stats;
    private statFor;
    /** Count one completed request + observe its latency. */
    recordRequest(route: RoutePrefix | string, latencyMs: number): void;
    /** Increment a specific outcome counter for a route. */
    recordOutcome(route: RoutePrefix | string, outcome: Exclude<MetricOutcome, 'request'>): void;
    /** JSON snapshot for `Accept: application/json`. */
    snapshot(): Record<string, unknown>;
    /** Prometheus exposition format (text/plain; version=0.0.4). */
    prometheus(): string;
}

/** Minimal gateway surface the supervisor needs. */
interface ClusterGateway {
    listen(port?: number, host?: string): Promise<void>;
    shutdown(options?: {
        drainTimeoutMs?: number;
    }): Promise<void>;
    close(): Promise<void>;
}
interface ClusterOptions {
    /** Worker count. Default os.availableParallelism(). */
    workers?: number;
    /** Delay before respawning a crashed worker (ms). Default 1000. */
    respawnDelayMs?: number;
}
/**
 * Multi-core supervisor built on node:cluster.
 *
 * Usage: call `gateway.listenCluster()` from the primary process — it
 * forks `workers` copies of the current process. Each worker re-runs
 * the entrypoint, calls `listenCluster()` again, sees `cluster.isWorker`
 * and falls through to a normal `listen()` with graceful SIGTERM
 * handling, so `gateway.listen()` / adapters stay untouched.
 *
 * - Worker crash  → respawned after `respawnDelayMs`.
 * - SIGTERM       → workers drain via shutdown message, then exit.
 * - SIGUSR2       → rolling restart: spawn replacement, then retire old.
 */
declare function listenCluster(gateway: ClusterGateway, options?: ClusterOptions): Promise<void>;

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
    /**
     * Multi-core mode: forks `workers` copies of this process (default:
     * all cores). In a worker it behaves like listen() with graceful
     * signal handling; in the primary it supervises respawns, SIGTERM
     * draining, and SIGUSR2 rolling restarts.
     */
    listenCluster(options?: ClusterOptions): Promise<void>;
    /** Live per-upstream connection pool + load metrics. */
    poolMetrics(): Record<string, UpstreamPoolMetrics>;
    /** Per-route counters + rolling latency quantiles. */
    readonly metrics: MetricsCollector;
    /**
     * Atomically swap the route table in memory — no restart, in-flight
     * requests and upgrade tunnels are untouched.
     */
    reloadRoutes(routes: RoutesInput<TReq> | RouteReloadConfig<TReq>): void;
}
declare function createGateway<TReq extends IncomingMessage = IncomingMessage>(config: GatewayConfig<TReq>): Gateway<TReq>;

export { MetricsCollector as $, type ClusterGateway as A, type BruteForceConfig as B, type ClientKeyExtractor as C, type DurationString as D, type EdgeGuard as E, type ClusterOptions as F, type Gateway as G, DEFAULTS as H, type DefineRouteOptions as I, ERROR_CODES as J, type EdgeGuardDecision as K, type EdgeRequestContext as L, type ErrorCode as M, FAIL_MODES as N, type FailMode as O, type ProtectionProvider as P, type GatewayHooks as Q, type RouteConfig as R, type GatewayPlugin as S, type GatewayProbes as T, type UpstreamPoolMetrics as U, HEADERS as V, type HedgingConfig as W, type IdempotencyConfig as X, type LoadSheddingConfig as Y, type MappedRouteConfig as Z, type MetricOutcome as _, type GatewayConfig as a, type PathRouteConfig as a0, type PluginContext as a1, type PolicyDecision as a2, type RateLimitSource as a3, type RateLimitString as a4, type RateLimiterOptions as a5, RedisRateLimiter as a6, type RequestContext as a7, type RouteCacheConfig as a8, type RouteMapInput as a9, type RouteReloadConfig as aa, Router as ab, SECURITY_EVENT_TYPES as ac, STATUS as ad, type SecurityAuditEvent as ae, type SecurityEventType as af, type SecurityHeadersConfig as ag, type ShutdownOptions as ah, type UpstreamTargetInput as ai, listenCluster as aj, type RoutesInput as b, createGateway as c, type RateLimitRule as d, type RateLimitResult as e, type UpstreamTarget as f, type UpstreamResponseInfo as g, type GatewayResponse as h, type GatewayStore as i, type RedisLike as j, type RateLimitInput as k, type CacheInput as l, type CircuitBreakerInput as m, type UpstreamInput as n, type UpstreamSigningConfig as o, type RoutePrefix as p, type UpstreamUrl as q, type CorsConfig as r, type RouteInput as s, type Brand as t, CACHE_STATUS as u, CIRCUIT_STATES as v, CircuitBreaker as w, type CircuitBreakerLike as x, type CircuitBreakerOptions as y, type CircuitState as z };
