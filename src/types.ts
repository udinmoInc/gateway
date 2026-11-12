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

/** `true` = any valid credential; array = required roles (RBAC). */
export type RouteAuth = boolean | readonly string[];

export interface JwtAuthConfig {
  /** HS256 signing/verification secret (required for Bearer tokens). */
  secret: string;
  /** Optional `iss` claim requirement. */
  issuer?: string;
  /** Optional `aud` claim requirement (string or list). */
  audience?: string | readonly string[];
  /** Clock-skew tolerance in seconds for exp/nbf. Default DEFAULTS.auth.jwtLeewaySec. */
  clockToleranceSec?: number;
}

export interface AuthConfig<TReq extends IncomingMessage = IncomingMessage> {
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
export type AuthOutcome =
  | { readonly authenticated: true; readonly identity: VerifiedIdentity }
  | { readonly authenticated: false; readonly reason?: string }
  | { readonly skip: true };

/**
 * Pluggable authentication strategy — JWT, JWKS, introspection,
 * cookie sessions, mTLS, or any custom logic.
 */
export interface AuthProvider<TReq extends IncomingMessage = IncomingMessage> {
  readonly name: string;
  authenticate(req: TReq): Promise<AuthOutcome>;
}

export interface JwksProviderOptions {
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

export interface IntrospectionProviderOptions {
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
export interface VerifiedIdentity {
  userId: string;
  roles: readonly string[];
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

export interface ApiKeyRecord {
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
export interface ApiKeyProvider {
  resolveByHash(keyHash: string): Promise<ApiKeyRecord | null>;
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

export interface UpstreamSigningConfig {
  secret: string;
  /** Signature header name. Default 'x-gateway-signature'. */
  headerName?: string;
  /** Timestamp header name. Default 'x-gateway-timestamp'. */
  timestampHeader?: string;
}

export interface ApiKeyGuardConfig {
  provider: ApiKeyProvider;
  /** Header carrying the raw key. Default 'x-api-key'. */
  headerName?: string;
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
}

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
   * Centralized auth: `false`/undefined = public, `true` = any valid
   * session or JWT, `string[]` = required roles (RBAC).
   */
  auth?: RouteAuth;
  /** Scopes a valid API key must hold (requires `apiKeys.provider`). */
  requiredScopes?: readonly string[];
  /** Allowed Content-Types for non-GET/HEAD requests (415 otherwise). */
  allowedContentTypes?: readonly string[];
}

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
  /** Verified caller identity (present only for authenticated requests). */
  identity?: VerifiedIdentity;
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
  defineCommand?(name: string, options: { numberOfKeys: number }): unknown;
  /** Optional lightweight liveness probe (ioredis exposes `ping`). */
  ping?(): Promise<unknown>;
  /** Optional key-value accessors used by the session store (ioredis-compatible). */
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del?(key: string): Promise<unknown>;
}

export interface RouteCacheConfig {
  /** How long a cached response stays fresh (ms). Required. */
  ttlMs: number;
  /** Max cached entries for this route. Default DEFAULTS.cache.maxEntries (500). */
  maxEntries?: number;
  /** Serve expired cache when the route's circuit breaker is OPEN. */
  serveStaleOnCircuitOpen?: boolean;
  /** Allow caching responses for authenticated requests. Default false. */
  allowAuthenticated?: boolean;
}

export interface GatewayProbes {
  /** Exact path answered with liveness 200, bypassing limits/routes. */
  livenessPath?: RoutePrefix;
  /** Exact path answered with readiness (checks Redis + circuits). */
  readinessPath?: RoutePrefix;
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

export interface GatewayConfig<TReq extends IncomingMessage = IncomingMessage>
  extends GatewayServerOptions<TReq> {
  /** Route table. May be omitted when `routesDir` is provided. */
  routes?: readonly RouteConfig<TReq>[];
  limiter?: RateLimiterOptions;
}

export interface DefineRouteOptions<TReq extends IncomingMessage = IncomingMessage>
  extends Omit<RouteConfig<TReq>, 'prefix'> {
  prefix: `/${string}`;
}
