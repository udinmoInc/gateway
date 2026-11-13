import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECURITY_EVENT_TYPES } from './constants.js';
import type {
  CACHE_STATUS,
  CIRCUIT_STATES,
  DEFAULTS,
  ERROR_CODES,
  FAIL_MODES,
} from './constants.js';

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type RoutePrefix = Brand<`/${string}`, 'RoutePrefix'>;
export type UpstreamUrl = Brand<
  `http://${string}` | `https://${string}`,
  'UpstreamUrl'
>;

export type CircuitState = (typeof CIRCUIT_STATES)[keyof typeof CIRCUIT_STATES];
export type FailMode = (typeof FAIL_MODES)[keyof typeof FAIL_MODES];
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export type CacheStatus = (typeof CACHE_STATUS)[keyof typeof CACHE_STATUS];

// ---------- edge guard contract (auth-agnostic core) ----------

/** Read-only context handed to every EdgeGuard. */
export interface EdgeRequestContext<TReq extends IncomingMessage = IncomingMessage> {
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

export type EdgeGuardDecision =
  | {
      action: 'allow';
      /** Trusted headers to inject upstream. */
      headers?: Record<string, string>;
      /** Domain tags attached to the request context (merged). */
      tags?: Readonly<Record<string, string>>;
    }
  | {
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
export interface EdgeGuard<TReq extends IncomingMessage = IncomingMessage> {
  readonly name?: string;
  evaluate(ctx: EdgeRequestContext<TReq>): Promise<EdgeGuardDecision> | EdgeGuardDecision;
}

/**
 * Developer-friendly protection contract — implement `verify()` with
 * any domain logic (sessions, tenants, feature flags, quotas, mTLS)
 * and attach it via `asProtection()`.
 */
export interface ProtectionProvider<TReq extends IncomingMessage = IncomingMessage> {
  readonly name?: string;
  verify(
    ctx: EdgeRequestContext<TReq>,
  ): Promise<
    | {
        readonly allow: true;
        /** Arbitrary domain tags attached to request context. */
        readonly tags?: Readonly<Record<string, string>>;
        /** Trusted headers injected into the upstream request. */
        readonly headers?: Readonly<Record<string, string>>;
      }
    | {
        readonly allow: false;
        readonly status?: number;
        readonly code?: string;
        readonly message?: string;
        readonly headers?: Readonly<Record<string, string>>;
      }
  >;
}

// ---------- pluggable interfaces ----------

/**
 * Structural storage contract unifying ioredis, node-redis, and
 * InMemoryRedis. Only `eval` is required; KV/incr/expire/ping are
 * optional and used when present (eval Lua fallbacks otherwise).
 */
export interface GatewayStore extends RedisLike {
  incr?(key: string): Promise<number>;
  expire?(key: string, seconds: number): Promise<unknown>;
}

/** Result of a plugin's onRequest policy check. */
export type PolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; statusCode?: number; code?: string; message?: string };

export interface PluginContext<TReq extends IncomingMessage = IncomingMessage>
  extends RequestContext<TReq> {
  /** Elapsed time since the gateway began handling this request (ms). */
  durationMs?: number;
}

/** Lifecycle interceptor for cross-cutting gateway policy. */
export interface GatewayPlugin<TReq extends IncomingMessage = IncomingMessage> {
  name: string;
  /** Return a deny decision or void/allow to continue the pipeline. */
  onRequest?(ctx: PluginContext<TReq>): PolicyDecision | void | Promise<PolicyDecision | void>;
  /** Called after the upstream responds or the request fails. */
  onResponse?(
    ctx: PluginContext<TReq>,
    statusCode: number,
    durationMs: number,
  ): void | Promise<void>;
}

export type SecurityEventType =
  (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES];

/** Structured audit event for SIEM/logging sinks. */
export interface SecurityAuditEvent {
  type: SecurityEventType;
  timestampMs: number;
  clientIp?: string;
  path?: string;
  detail?: string;
}

/**
 * HMAC-SHA256 request signing injected on every proxied upstream call.
 * Downstreams verify with `verifyGatewaySignature()`.
 */
export interface UpstreamSigningConfig {
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

export interface BruteForceConfig {
  /** Auth failures within windowSec before lockout. */
  maxFailures: number;
  /** Failure counting window (seconds). */
  windowSec: number;
  /** How long a locked client is rejected (seconds). */
  lockDurationSec: number;
}

export interface CorsConfig {
  origins: readonly string[] | '*';
  methods?: readonly string[];
  headers?: readonly string[];
  credentials?: boolean;
  maxAgeSec?: number;
}

export interface SecurityHeadersConfig {
  /** X-Frame-Options value. Default 'DENY'. */
  frameOptions?: string;
  /** Emit Strict-Transport-Security when set. */
  hsts?: { maxAgeSec: number; includeSubDomains?: boolean };
}

export interface RateLimitRule {
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
export type RateLimitSource =
  | 'redis'
  | 'local'
  | 'local-fallback'
  | 'fail-open'
  | 'fail-closed'
  | 'batch';

export interface RateLimitResult {
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

export type ClientKeyExtractor<TReq extends IncomingMessage = IncomingMessage> = (
  req: TReq,
) => string | Promise<string>;

export interface CircuitBreakerOptions {
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

export interface UpstreamTarget {
  url: UpstreamUrl;
  /** Weight for weighted round-robin (default 1). */
  weight?: number;
}

/**
 * A normalized, validated route — the internal form produced from every
 * accepted `RoutesInput` shorthand. `prefix` is branded and guaranteed to
 * start with `/`; `upstreams` is non-empty.
 */
export interface RouteConfig<TReq extends IncomingMessage = IncomingMessage> {
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

// ---------- ergonomic route inputs (plain strings & shorthands) ----------
// These widen the strict RouteConfig shape so users never need branded-type
// casts: prefixes/URLs may be plain strings (validated at boot), `to` is an
// alias for `upstreams`, rateLimit accepts '600/min', and circuitBreaker
// openDurationMs accepts '30s'.

export type DurationString =
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}h`
  | `${number}d`;
export type RateLimitString = `${number}/sec` | `${number}/min` | `${number}/hour`;
export type RateLimitInput = RateLimitRule | RateLimitString;
export type CacheInput = number | DurationString | RouteCacheConfig;

/** A single upstream: URL string, port number, ':port', 'host:port', or { url, weight }. */
export type UpstreamTargetInput =
  | string
  | number
  | { readonly url: string | number; readonly weight?: number };
/** One upstream or a list of them (weighted canaries supported). */
export type UpstreamInput =
  | UpstreamTargetInput
  | readonly UpstreamTargetInput[];

/** Circuit-breaker override accepting duration shorthands. */
export interface CircuitBreakerInput
  extends Omit<Partial<CircuitBreakerOptions>, 'openDurationMs'> {
  openDurationMs?: number | DurationString;
}

/** RouteConfig fields shared by every shorthand form. */
export interface RouteShorthandFields<
  TReq extends IncomingMessage = IncomingMessage,
> extends Omit<
    RouteConfig<TReq>,
    'prefix' | 'upstreams' | 'rateLimit' | 'circuitBreaker' | 'cache'
  > {
  rateLimit?: RateLimitInput;
  circuitBreaker?: CircuitBreakerInput;
  cache?: CacheInput;
}

/** `{ prefix, upstreams|to, ... }` form — plain strings allowed. */
export interface MappedRouteConfig<
  TReq extends IncomingMessage = IncomingMessage,
> extends RouteShorthandFields<TReq> {
  prefix: `/${string}`;
  upstreams?: UpstreamInput;
  /** Alias for `upstreams`. */
  to?: UpstreamInput;
}

/** `{ path, to, ... }` DSL-definition form (route()/group() output shape). */
export interface PathRouteConfig<
  TReq extends IncomingMessage = IncomingMessage,
> extends RouteShorthandFields<TReq> {
  path: `/${string}` | `${string}/*`;
  to: UpstreamInput;
}

export type RouteInput<TReq extends IncomingMessage = IncomingMessage> =
  | RouteConfig<TReq>
  | MappedRouteConfig<TReq>
  | PathRouteConfig<TReq>;

/** Plain object map `{ '/api': 'http://host' }`. */
export type RouteMapInput = Readonly<Record<`/${string}`, UpstreamInput>>;

/** Everything `routes` accepts: built configs, shorthands, or a route map. */
export type RoutesInput<TReq extends IncomingMessage = IncomingMessage> =
  | readonly RouteInput<TReq>[]
  | RouteMapInput;

/** Env-var auto-discovery for routes (`GATEWAY_USERS=4001` → `/users`). */
export interface AutoRoutesConfig {
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
export interface RouteReloadConfig<
  TReq extends IncomingMessage = IncomingMessage,
> {
  routes?: RoutesInput<TReq>;
  target?: UpstreamInput;
  rateLimit?: RateLimitInput;
  circuitBreaker?: CircuitBreakerInput;
  cache?: CacheInput;
  autoRoutes?: AutoRoutesConfig;
}

/**
 * Lifecycle callbacks fired at fixed points in the request pipeline.
 * Hooks observe and may short-circuit (return a `GatewayResponse`);
 * they never mutate routing or upstream selection.
 */
export interface GatewayHooks<TReq extends IncomingMessage = IncomingMessage> {
  /** Runs before rate limiting. Return a response object to short-circuit. */
  onRequest?(ctx: RequestContext<TReq>): void | Promise<void> | GatewayResponse;
  /** Runs after a successful rate-limit check, before proxying. */
  onAuthorized?(ctx: RequestContext<TReq>): void | Promise<void> | GatewayResponse;
  /** Called when the upstream responds (status + headers captured). */
  onUpstreamResponse?(
    ctx: RequestContext<TReq>,
    info: UpstreamResponseInfo,
  ): void | Promise<void>;
  /** Called on upstream errors/timeouts. */
  onUpstreamError?(
    ctx: RequestContext<TReq>,
    error: Error,
  ): void | Promise<void>;
  /** Called when a request is rejected with 429 (rate limited). */
  onRateLimited?(
    ctx: RequestContext<TReq>,
    result: RateLimitResult,
  ): void | Promise<void>;
  /** Called when a request is rejected because the upstream circuit is OPEN. */
  onCircuitOpen?(ctx: RequestContext<TReq>): void | Promise<void>;
  /** Called on proxy-level errors (alias alongside onUpstreamError). */
  onProxyError?(
    ctx: RequestContext<TReq>,
    error: Error,
  ): void | Promise<void>;
}

export interface RequestContext<TReq extends IncomingMessage = IncomingMessage> {
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

export interface UpstreamResponseInfo {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  /** Present only when the proxy was asked to capture the body (cacheable GET/HEAD). */
  body?: Buffer;
}

export interface GatewayResponse {
  statusCode: number;
  headers?: Record<string, string | string[] | undefined>;
  body?: string | Buffer | Uint8Array;
}

export interface RedisLike {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  /**
   * Optional EVALSHA fast path — the limiter prefers this when present
   * and falls back to `eval` on NOSCRIPT.
   */
  evalSha?(
    sha1: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  defineCommand?(name: string, options: { numberOfKeys: number }): unknown;
  /** Optional lightweight liveness probe (ioredis exposes `ping`). */
  ping?(): Promise<unknown>;
  /** Optional key-value accessors used by the session store (ioredis-compatible). */
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del?(key: string): Promise<unknown>;
}

/** Speculative request hedging for idempotent GET/HEAD routes. */
export interface HedgingConfig {
  enabled: boolean;
  /** Delay before firing a hedge request (ms). */
  delayMs: number;
  /** Max additional upstream attempts. Default 1. */
  maxHedges?: number;
}

/** Event-loop / concurrency load shedding configuration. */
export interface LoadSheddingConfig {
  enabled: boolean;
  /** p99 event-loop delay threshold (ms). Default 150. */
  maxEventLoopDelayMs?: number;
  /** In-flight request ceiling. Default unlimited. */
  maxConcurrentRequests?: number;
}

/** Live per-upstream connection pool metrics. */
export interface UpstreamPoolMetrics {
  activeSockets: number;
  freeSockets: number;
  queuedRequests: number;
  inFlight: number;
}

/** Per-route distributed idempotency configuration. */
export interface IdempotencyConfig {
  enabled: boolean;
  /** How long COMPLETED responses are replayed. Default 24h. */
  ttlMs?: number;
  /** Max time a request may hold the IN_PROGRESS lock / followers wait. Default 30s. */
  lockTimeoutMs?: number;
  /** Methods subject to idempotency. Default POST/PATCH/DELETE. */
  methods?: readonly string[];
}

export interface RouteCacheConfig {
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

export interface GatewayProbes {
  /** Exact path answered with liveness 200, bypassing limits/routes. */
  livenessPath?: `/${string}`;
  /** Exact path answered with readiness (checks Redis + circuits). */
  readinessPath?: `/${string}`;
  /** Redis PING timeout for readiness. Default DEFAULTS.probes.readinessTimeoutMs (500). */
  readinessTimeoutMs?: number;
}

export interface RateLimiterOptions {
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

export interface GatewayServerOptions<TReq extends IncomingMessage = IncomingMessage> {
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

/**
 * Top-level gateway configuration. At least one route source is required:
 * `routes`, `target`, `routesDir`, or `autoRoutes` (a lone `healthPath` /
 * `metricsPath` / `probes` path also satisfies boot validation).
 * All fields are optional beyond that; unknown keys are ignored.
 */
export interface GatewayConfig<TReq extends IncomingMessage = IncomingMessage>
  extends GatewayServerOptions<TReq> {
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

export interface DefineRouteOptions<TReq extends IncomingMessage = IncomingMessage>
  extends Omit<RouteConfig<TReq>, 'prefix'> {
  prefix: `/${string}`;
}
