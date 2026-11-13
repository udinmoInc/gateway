import { IncomingMessage, ServerResponse, IncomingHttpHeaders } from 'node:http';
import { d as RateLimitRule, e as RateLimitResult, U as UpstreamPoolMetrics, f as UpstreamTarget, g as UpstreamResponseInfo, C as ClientKeyExtractor, R as RouteConfig, h as GatewayResponse, i as GatewayStore, j as RedisLike, E as EdgeGuard, P as ProtectionProvider, k as RateLimitInput, l as CacheInput, m as CircuitBreakerInput, n as UpstreamInput, D as DurationString, o as UpstreamSigningConfig, B as BruteForceConfig, p as RoutePrefix, q as UpstreamUrl, r as CorsConfig, a as GatewayConfig, s as RouteInput, G as Gateway } from './GatewayEngine-DmwnEblF.cjs';
export { t as Brand, u as CACHE_STATUS, v as CIRCUIT_STATES, w as CircuitBreaker, x as CircuitBreakerLike, y as CircuitBreakerOptions, z as CircuitState, A as ClusterGateway, F as ClusterOptions, H as DEFAULTS, I as DefineRouteOptions, J as ERROR_CODES, K as EdgeGuardDecision, L as EdgeRequestContext, M as ErrorCode, N as FAIL_MODES, O as FailMode, Q as GatewayHooks, S as GatewayPlugin, T as GatewayProbes, V as HEADERS, W as HedgingConfig, X as IdempotencyConfig, Y as LoadSheddingConfig, Z as MappedRouteConfig, _ as MetricOutcome, $ as MetricsCollector, a0 as PathRouteConfig, a1 as PluginContext, a2 as PolicyDecision, a3 as RateLimitSource, a4 as RateLimitString, a5 as RateLimiterOptions, a6 as RedisRateLimiter, a7 as RequestContext, a8 as RouteCacheConfig, a9 as RouteMapInput, aa as RouteReloadConfig, ab as Router, b as RoutesInput, ac as SECURITY_EVENT_TYPES, ad as STATUS, ae as SecurityAuditEvent, af as SecurityEventType, ag as SecurityHeadersConfig, ah as ShutdownOptions, ai as UpstreamTargetInput, c as createGateway, aj as listenCluster } from './GatewayEngine-DmwnEblF.cjs';
import net from 'node:net';

/**
 * Bounded in-memory token bucket used when Redis is unavailable
 * (fail-open fallback) or when no Redis client is configured.
 * LRU eviction keeps memory bounded under key-cardinality attacks.
 */
declare class LocalFallback {
    private readonly buckets;
    constructor(maxKeys?: number);
    consume(key: string, rule: RateLimitRule, now?: number): RateLimitResult;
    get size(): number;
}

interface ProxyTarget {
    upstream: UpstreamTarget;
    /** Path (with query) to request upstream. */
    path: string;
    /** Extra headers merged into the upstream response. */
    responseHeaders?: Record<string, string> | undefined;
    /**
     * Trusted headers emitted by edge guards, injected onto the
     * upstream request (client-sent copies are overwritten).
     */
    guardHeaders?: Record<string, string> | undefined;
    /** Pre-normalized lowercase header names to strip (boot-time Set). */
    stripHeaders?: ReadonlySet<string> | undefined;
    /** Pre-generated request id (used for signing payload consistency). */
    requestId?: string | undefined;
    /**
     * Fully-buffered request body (e.g. consumed for idempotency
     * fingerprinting). When set, the client stream is not piped.
     */
    bodyOverride?: Buffer | undefined;
    /** Zero-trust upstream HMAC signing parameters. */
    signing?: {
        secret: string;
        /** Generic subject bound into the signature ('' when none). */
        subject: string;
        /** Header carrying the subject upstream. */
        subjectHeader?: string;
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
    private readonly maxFreeSockets;
    private readonly keepAliveMsecs;
    constructor(options?: {
        timeoutMs?: number;
        maxSockets?: number;
        maxFreeSockets?: number;
        keepAliveMsecs?: number;
    });
    /** Live per-upstream-origin connection pool metrics. */
    poolMetrics(): Record<string, Omit<UpstreamPoolMetrics, 'inFlight'>>;
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
        /** AbortSignal — destroys the upstream request when fired (hedging). */
        signal?: AbortSignal;
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
    /**
     * One keep-alive agent per upstream origin — tuned for high
     * concurrency: LIFO scheduling, no-delay sockets, bounded free pool.
     */
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
 * Two-tier response cache: fast in-process L1 LRU plus an optional
 * shared L2 GatewayStore tier so horizontally-scaled nodes share
 * entries and serve STALE across the fleet.
 */
declare class ResponseCache {
    private readonly map;
    private readonly ttlMs;
    private readonly now;
    private readonly store;
    private readonly l2Prefix;
    constructor(ttlMs: number, maxEntries?: number, now?: () => number, store?: GatewayStore, l2Prefix?: string);
    /** Synchronous L1-only lookup (hot path). */
    lookup(key: string): CacheLookup;
    /**
     * L1 → L2 lookup. On L2 hit the entry is hydrated into L1.
     * Falls back to L1-only behavior when no store is configured.
     */
    lookupShared(key: string): Promise<CacheLookup>;
    /** L2-only read — used by cross-node coalescing followers. */
    lookupL2(key: string): Promise<CacheLookup>;
    set(key: string, entry: Omit<CacheEntry, 'storedAt'>): void;
    /** L1 + L2 populate. L2 retention covers the stale window. */
    setShared(key: string, entry: Omit<CacheEntry, 'storedAt'>): Promise<void>;
    private freshness;
    private setLocal;
    private l2Key;
    get size(): number;
    clear(): void;
}

/**
 * Two-layer request coalescing for cacheable GET/HEAD traffic:
 *
 * 1. In-process singleflight — concurrent identical misses on this
 *    node share one upstream fetch via the `inflight` promise map.
 * 2. Cross-node lease — `SET NX PX` on GatewayStore elects a single
 *    leader per key across the fleet; followers poll the shared L2
 *    cache and replay the populated entry (X-Coalesced: true).
 */
declare class RequestCoalescer {
    private readonly inflight;
    private readonly store;
    private readonly leaseMs;
    private readonly waitMs;
    private readonly pollMs;
    private readonly nodeId;
    constructor(store: GatewayStore | undefined, options?: {
        leaseMs?: number;
        waitMs?: number;
        pollMs?: number;
        nodeId?: string;
        /** Bound on concurrent in-flight upstream fetches. */
        maxInflight?: number;
    });
    /** Existing in-flight upstream fetch for this key, if any. */
    get<T>(key: string): Promise<T> | undefined;
    set<T>(key: string, promise: Promise<T>): void;
    delete(key: string): void;
    leaseKey(key: string): string;
    /**
     * Try to become the cross-node leader for this cache key.
     * Returns false when another node holds the lease.
     */
    acquireLease(key: string): Promise<boolean>;
    releaseLease(key: string): Promise<void>;
    /**
     * Follower path: poll the shared L2 cache until an entry appears or
     * the wait budget expires. Returns the fresh entry or null.
     */
    waitForShared(key: string, readL2: () => Promise<{
        fresh?: CacheEntry;
        stale?: CacheEntry;
    }>): Promise<CacheEntry | null>;
}

type IdempotencyBegin = {
    action: 'proceed';
    complete: (result: IdempotentResult) => Promise<void>;
    abort: () => Promise<void>;
} | {
    action: 'replay';
    statusCode: number;
    headers: Record<string, string>;
    body: Buffer;
} | {
    action: 'conflict';
} | {
    action: 'fingerprint-mismatch';
};
interface IdempotentResult {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}
/**
 * Distributed idempotency via GatewayStore atomic state machine:
 * IN_PROGRESS (NX+PX lock) → COMPLETED (fingerprint + serialized
 * response). Followers poll with jittered backoff; mismatched payload
 * fingerprints are rejected; failures release the key for safe retry.
 */
declare class IdempotencyManager {
    private readonly store;
    private readonly nodeId;
    constructor(store: GatewayStore, nodeId?: string);
    keyFor(scope: string, idempotencyKey: string): string;
    fingerprint(method: string, url: string, rawBody: Buffer): string;
    /**
     * Attempt to begin an idempotent operation.
     * Returns 'proceed' with complete/abort callbacks when the lock is
     * acquired, a replay/conflict/mismatch decision otherwise.
     */
    begin(scope: string, idempotencyKey: string, fingerprint: string, options: {
        ttlMs: number;
        lockTimeoutMs: number;
    }): Promise<IdempotencyBegin>;
    private pollForCompletion;
    private complete;
}

/**
 * Event-loop lag + in-flight concurrency load shedder.
 * Rejects new work with 503 before it can pile onto an already
 * saturated event loop (head-of-line blocking protection).
 */
declare class LoadShedder {
    private readonly histogram;
    private readonly maxEventLoopDelayMs;
    private readonly maxConcurrentRequests;
    private inFlightCount;
    private enabled;
    constructor(options?: {
        maxEventLoopDelayMs?: number;
        maxConcurrentRequests?: number;
    });
    start(): void;
    stop(): void;
    enter(): void;
    leave(): void;
    get inFlight(): number;
    /** p99 event-loop delay in milliseconds. */
    eventLoopDelayP99Ms(): number;
    shouldShed(): boolean;
}

/**
 * Power-of-two-choices load balancer with live in-flight counts and
 * EWMA latency. Picks two weighted-random candidates and routes to the
 * least-loaded healthy target — avoids herding and self-corrects away
 * from slow upstreams without active health checks.
 */
declare class LoadBalancer {
    private readonly stats;
    private statsFor;
    enter(url: string): void;
    /** Record completion; latencyMs is time-to-first-byte. */
    leave(url: string, latencyMs: number): void;
    statsOf(url: string): {
        inFlight: number;
        ewmaMs: number;
    };
    /** Weighted random pick of one candidate. */
    private pickWeighted;
    /** Lower score = less loaded (in-flight dominates, EWMA breaks ties). */
    private score;
    /**
     * Power-of-two-choices: sample two distinct weighted candidates,
     * return the one with the lower load score.
     */
    selectP2C(upstreams: readonly UpstreamTarget[]): UpstreamTarget;
    /** P2C pick excluding a specific upstream (hedging secondary). */
    selectAlternative(upstreams: readonly UpstreamTarget[], excludeUrl: string): UpstreamTarget | undefined;
}

interface UpgradeTunnelOptions {
    /** Path (with query) to request upstream — same as HTTP proxying. */
    path: string;
    /** Trusted headers emitted by edge guards, injected on the handshake. */
    guardHeaders?: Record<string, string> | undefined;
    /** Pre-normalized lowercase header names to strip (boot-time Set). */
    stripHeaders?: ReadonlySet<string> | undefined;
    /** Handshake deadline (ms); cleared once the tunnel is established. */
    handshakeTimeoutMs?: number | undefined;
}
/**
 * Zero-copy WebSocket/SSE upgrade tunnel: forwards the raw HTTP
 * handshake to the upstream over TCP/TLS, then pipes bytes both ways.
 * Sockets are noDelay'd and torn down symmetrically on error/close so
 * half-closed connections never leak.
 */
declare function proxyUpgrade(req: IncomingMessage, clientSocket: net.Socket, head: Buffer, upstream: UpstreamTarget, options: UpgradeTunnelOptions): void;

/**
 * In-memory RedisLike adapter: implements the token-bucket eval contract
 * plus get/set/del/ping KV ops, so sessions and rate limits work with
 * zero infrastructure. Per-process only — not shared across nodes.
 * All maps are bounded FIFO stores (DEFAULTS.inMemoryRedis.maxKeys).
 */
declare class InMemoryRedis implements RedisLike {
    private readonly buckets;
    private readonly kv;
    eval(_script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    /** In-memory EVALSHA — script text is irrelevant; semantics match eval. */
    evalSha(_sha1: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    ping(): Promise<string>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}

type TagMatcher = string | readonly string[] | ((value: string) => boolean);
/**
 * Sequential composition — every guard must allow. First deny wins;
 * allow-headers and allow-tags are merged and visible to subsequent
 * guards via `ctx.headers` / `ctx.tags`.
 */
declare function composeGuards<TReq extends IncomingMessage = IncomingMessage>(...guards: readonly EdgeGuard<TReq>[]): EdgeGuard<TReq>;
/** Alias of composeGuards — all guards must pass. */
declare const allOf: typeof composeGuards;
/**
 * First guard to allow wins (short-circuits). If every guard denies,
 * the first deny response is returned.
 */
declare function anyOf<TReq extends IncomingMessage = IncomingMessage>(...guards: readonly EdgeGuard<TReq>[]): EdgeGuard<TReq>;
interface RequireTagOptions {
    /** Deny status when the tag is missing/mismatched. Default 403. */
    status?: number;
    /** Deny error code. Default 'FORBIDDEN'. */
    code?: string;
    /** Deny message override. */
    message?: string;
}
/**
 * Tag guard — requires `ctx.tags[key]` to exist (and match `expected`
 * when provided: string, list, or predicate). Domain-free: works for
 * plan tiers, tenants, regions, feature flags, geo buckets, etc.
 */
declare function requireTag<TReq extends IncomingMessage = IncomingMessage>(key: string, expected?: TagMatcher, options?: RequireTagOptions): EdgeGuard<TReq>;
/**
 * Header guard — requires `headerName` on the incoming request.
 * With `expected`, the value must match (missing → 401, mismatch → 403).
 */
declare function requireHeader<TReq extends IncomingMessage = IncomingMessage>(headerName: string, expected?: string | readonly string[]): EdgeGuard<TReq>;

/** Anything `asProtection` accepts: a raw EdgeGuard or a ProtectionProvider. */
type ProtectionSource<TReq extends IncomingMessage = IncomingMessage> = EdgeGuard<TReq> | ProtectionProvider<TReq>;
/**
 * Normalize a ProtectionProvider (or pass an EdgeGuard through) into
 * an EdgeGuard. `tags`/`headers` from the provider map into trusted
 * guard outputs; client-sent copies are stripped upstream only when
 * the developer lists them in `stripHeaders`.
 */
declare function providerToGuard<TReq extends IncomingMessage = IncomingMessage>(source: ProtectionSource<TReq>): EdgeGuard<TReq>;
/** Route-wrapper returned by `asProtection(provider)`. */
interface ProtectionApplier<TReq extends IncomingMessage = IncomingMessage> {
    (route: RouteConfig<TReq>): RouteConfig<TReq>;
    (routes: readonly RouteConfig<TReq>[]): RouteConfig<TReq>[];
}
/**
 * Attach a protection provider/guard to routes — curried form:
 * `asProtection(provider)` returns a wrapper you spread over
 * `route(...)`/`group(...)` output; the two-argument form applies
 * immediately. The guard is prepended onto each route's `guards`
 * chain; the gateway config stays untouched.
 */
declare function asProtection<TReq extends IncomingMessage = IncomingMessage>(source: ProtectionSource<TReq>): ProtectionApplier<TReq>;
declare function asProtection<TReq extends IncomingMessage = IncomingMessage>(source: ProtectionSource<TReq>, routes: RouteConfig<TReq> | readonly RouteConfig<TReq>[]): RouteConfig<TReq> | RouteConfig<TReq>[];

/** Parse '60/sec' | '120/min' | '1000/hour' → token bucket rule. Throws on malformed input. */
declare function parseRateLimit(input: RateLimitInput): RateLimitRule;
/** Parse '500ms' | '30s' | '5m' | '7d' (or a number of ms) → milliseconds. */
declare function parseDurationMs(input: number | DurationString): number;
/** Normalize '/api/*' → '/api' (wildcard suffix supported in the DSL). */
declare function normalizePrefix(path: string): string;
interface RouteShortcut<TReq extends IncomingMessage = IncomingMessage> {
    guards?: readonly EdgeGuard<TReq>[];
    stripHeaders?: readonly string[];
    rateLimit?: RateLimitInput;
    cache?: CacheInput;
    stripPrefix?: boolean;
    circuitBreaker?: CircuitBreakerInput;
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
    /**
     * Header carrying the signed subject (default 'x-gateway-subject').
     * Must match the `subjectHeader` used at signing time.
     */
    subjectHeader?: string;
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

/** Runtime-validated RoutePrefix brand — throws on non-'/' prefixes. */
declare function asRoutePrefix(prefix: string): RoutePrefix;
/** Runtime-validated UpstreamUrl brand — throws on malformed URLs. */
declare function asUpstreamUrl(url: string): UpstreamUrl;
/** Strip CR/LF from a header value (CRLF injection defense). */
declare function sanitizeHeaderValue(value: string): string;

/** True when the URL targets link-local/metadata infrastructure (SSRF). */
declare function isMetadataUpstream(url: UpstreamUrl | string): boolean;
/** Validate all configured upstreams at boot; throws on metadata targets. */
declare function assertNoMetadataUpstreams(urls: readonly (UpstreamUrl | string)[], allowMetadata: boolean): void;
/**
 * True when the request path contains traversal/injection segments.
 * Applies up to MAX_DECODE_PASSES bounded decode passes so multi-encoded
 * payloads (e.g. %252e%252e) cannot bypass the check, and malformed
 * percent sequences are treated as hostile (→ 400) rather than throwing.
 */
declare function isPathTraversal(pathname: string): boolean;

/** Content-Type enforcement for routes with allowedContentTypes (pre-normalized lowercase Set). */
declare function contentTypeAllowed(req: IncomingMessage, allowed: ReadonlySet<string>): boolean;
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
interface QuickGatewayOptions<TReq extends IncomingMessage = IncomingMessage> extends Omit<GatewayConfig<TReq>, 'routes' | 'limiter' | 'rateLimit'> {
    /**
     * Redis client (ioredis-compatible `eval`). When omitted, an internal
     * in-memory RedisLike adapter is used automatically — no Redis or Docker
     * required. Limits are then per-process.
     */
    readonly redis?: RedisLike;
    /**
     * Object map `{ '/api': 'http://localhost:4001' }`, `SimpleRoute[]`,
     * or full `RouteInput[]` (`route()`/`group()`/`asProtection` output).
     * Optional when `target`, `routesDir`, or `autoRoutes` provides routes.
     */
    readonly routes?: SimpleRouteMap | readonly SimpleRoute[] | readonly RouteInput<TReq>[];
    /**
     * Global rate limit — `{ requestsPerMinute, burst? }` or any
     * `RateLimitInput` (`{ capacity, refillPerSecond }` / `'600/min'`).
     * Default: 60 requests/minute, burst 60.
     */
    readonly rateLimit?: SimpleRateLimit | RateLimitInput;
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

/**
 * Route builder — accepts every shorthand shape (plain-string prefix,
 * `to` alias, '600/min' rate limits, weighted upstream objects) and
 * returns a normalized RouteConfig. No brand casts needed.
 */
declare function defineRoute<TReq extends IncomingMessage = IncomingMessage>(route: RouteInput<TReq>): RouteConfig<TReq>;
/** Identity helper — validates gateway config at compile time. */
declare function defineGatewayConfig<TReq extends IncomingMessage = IncomingMessage>(config: GatewayConfig<TReq>): GatewayConfig<TReq>;

export { BruteForceConfig, BruteForceGuard, type CacheEntry, CacheInput, type CacheLookup, CircuitBreakerInput, ClientKeyExtractor, CorsConfig, DurationString, EdgeGuard, Gateway, GatewayConfig, GatewayResponse, GatewayStore, type IdempotencyBegin, IdempotencyManager, type IdempotentResult, InMemoryRedis, LoadBalancer, LoadShedder, LocalFallback, type ProtectionApplier, ProtectionProvider, type ProtectionSource, ProxyHandler, type QuickGatewayOptions, RateLimitInput, RateLimitResult, RateLimitRule, RedisLike, RequestCoalescer, ResponseCache, RouteConfig, type RouteDefinition, RouteInput, RoutePrefix, type RouteResult, type RouteShortcut, type SignInput, type SignResult, type SimpleRateLimit, type SimpleRoute, type SimpleRouteMap, type SimpleUpstream, UpstreamInput, UpstreamPoolMetrics, UpstreamResponseInfo, UpstreamSigningConfig, UpstreamTarget, UpstreamUrl, type VerifyOptions, allOf, allowedOriginValue, anyOf, asProtection, asRoutePrefix, asUpstreamUrl, assertNoMetadataUpstreams, assertValidCors, buildCorsHeaders, composeGuards, contentTypeAllowed, createCompositeExtractor, defaultErrorBody, defineGatewayConfig, defineRoute, extractApiKeyOrIp, extractClientIp, getHeaderString, group, isMetadataUpstream, isOriginAllowed, isPathTraversal, isPreflight, loadRoutesDir, loadRoutesDirSync, normalizePrefix, parseDurationMs, parseRateLimit, providerToGuard, proxyUpgrade, requireHeader, requireTag, resolveExtractor, resolveSigningConfig, route, sanitizeHeaderValue, sendGatewayResponse, sendJson, signGatewayRequest, startGateway, verifyGatewaySignature };
