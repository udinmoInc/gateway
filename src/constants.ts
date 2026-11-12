export const HEADERS = {
  forwardedFor: 'x-forwarded-for',
  forwardedProto: 'x-forwarded-proto',
  realIp: 'x-real-ip',
  rateLimitLimit: 'x-ratelimit-limit',
  rateLimitRemaining: 'x-ratelimit-remaining',
  rateLimitReset: 'x-ratelimit-reset',
  retryAfter: 'retry-after',
  apiKey: 'x-api-key',
  authorization: 'authorization',
  gatewayCache: 'x-gateway-cache',
  cacheControl: 'cache-control',
  connection: 'connection',
  userId: 'x-user-id',
  userRole: 'x-user-role',
  requestId: 'x-request-id',
  wwwAuthenticate: 'www-authenticate',
  gatewayTimestamp: 'x-gateway-timestamp',
  gatewaySignature: 'x-gateway-signature',
  contentTypeOptions: 'x-content-type-options',
  frameOptions: 'x-frame-options',
  referrerPolicy: 'referrer-policy',
  strictTransportSecurity: 'strict-transport-security',
  origin: 'origin',
  accessControlRequestMethod: 'access-control-request-method',
  accessControlRequestHeaders: 'access-control-request-headers',
  accessControlAllowOrigin: 'access-control-allow-origin',
  accessControlAllowMethods: 'access-control-allow-methods',
  accessControlAllowHeaders: 'access-control-allow-headers',
  accessControlAllowCredentials: 'access-control-allow-credentials',
  accessControlMaxAge: 'access-control-max-age',
  apiKeyHeader: 'x-api-key',
  idempotencyKey: 'idempotency-key',
  idempotentReplay: 'x-idempotent-replay',
  coalesced: 'x-coalesced',
} as const;

/** Identity headers always stripped from clients and re-injected when verified. */
export const IDENTITY_HEADERS = [
  'x-user-id',
  'x-user-role',
  'x-session-id',
] as const;

export const STATUS = {
  ok: 200,
  created: 201,
  noContent: 204,
  badGateway: 502,
  serviceUnavailable: 503,
  gatewayTimeout: 504,
  tooManyRequests: 429,
  unauthorized: 401,
  forbidden: 403,
  payloadTooLarge: 413,
  unsupportedMediaType: 415,
  locked: 423,
  conflict: 409,
  unprocessableEntity: 422,
} as const;

export const ERROR_CODES = {
  rateLimited: 'RATE_LIMITED',
  circuitOpen: 'CIRCUIT_OPEN',
  noRoute: 'NO_ROUTE',
  upstreamError: 'UPSTREAM_ERROR',
  draining: 'DRAINING',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  routeLoadError: 'ROUTE_LOAD_ERROR',
  pathTraversalBlocked: 'PATH_TRAVERSAL_BLOCKED',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  policyDenied: 'POLICY_DENIED',
  apiKeyInvalid: 'API_KEY_INVALID',
  locked: 'LOCKED',
  idempotencyMismatch: 'IDEMPOTENCY_MISMATCH',
  conflict: 'CONFLICT',
} as const;

export const SECURITY_EVENT_TYPES = {
  pathTraversalBlocked: 'PATH_TRAVERSAL_BLOCKED',
  bruteForceLocked: 'BRUTE_FORCE_LOCKED',
  authDenied: 'AUTH_DENIED',
  apiKeyDenied: 'API_KEY_DENIED',
  policyDenied: 'POLICY_DENIED',
} as const;

export const CACHE_STATUS = {
  hit: 'HIT',
  miss: 'MISS',
  stale: 'STALE',
} as const;

export const FAIL_MODES = {
  open: 'open',
  closed: 'closed',
  fallback: 'fallback',
} as const;

export const CIRCUIT_STATES = {
  closed: 'CLOSED',
  open: 'OPEN',
  halfOpen: 'HALF_OPEN',
} as const;

export const DEFAULTS = {
  port: 8080,
  host: '0.0.0.0',
  redisPrefix: 'gw:rl',
  rateLimit: {
    capacity: 100,
    refillPerSecond: 10,
  },
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    openDurationMs: 30_000,
    probeTimeoutMs: 10_000,
  },
  limiter: {
    localMaxKeys: 10_000,
  },
  proxy: {
    upstreamTimeoutMs: 30_000,
    maxSockets: 256,
    keepAlive: true,
  },
  quickstart: {
    requestsPerMinute: 60,
  },
  autoCircuitBreaker: {
    /** Error ratio (0..1) that trips the circuit. */
    failureThreshold: 0.5,
    /** Minimum upstream calls observed before ratio tripping. */
    minimumRequests: 10,
    /** Cooldown before HALF_OPEN probes (ms). */
    resetTimeoutMs: 15_000,
    successThreshold: 2,
    probeTimeoutMs: 5_000,
  },
  inMemoryRedis: {
    maxKeys: 10_000,
  },
  shutdown: {
    drainTimeoutMs: 10_000,
    retryAfterSeconds: 5,
  },
  probes: {
    readinessTimeoutMs: 500,
  },
  cache: {
    maxEntries: 500,
  },
  perimeter: {
    maxBodyBytes: 1_048_576,
    frameOptions: 'DENY',
    nosniff: 'nosniff',
    referrerPolicy: 'no-referrer',
    signatureMaxAgeMs: 60_000,
    signatureHeader: 'x-gateway-signature',
    signatureTimestampHeader: 'x-gateway-timestamp',
    apiKeyHashPrefix: 'sha256:',
    bruteForceKeyPrefix: 'gw:bf:',
    upstreamFingerprintHeaders: ['x-powered-by', 'server'] as const,
  },
  auth: {
    jwtLeewaySec: 30,
    jwksCacheTtlMs: 300_000,
    authCacheKeyPrefix: 'gw:auth:',
  },
  resilience: {
    idempotencyTtlMs: 86_400_000, // 24h
    idempotencyLockTimeoutMs: 30_000,
    idempotencyMethods: ['POST', 'PATCH', 'DELETE'] as const,
    idempotencyKeyPrefix: 'gw:idem:',
    coalesceLeaseMs: 3_000,
    coalesceWaitMs: 2_800,
    coalescePollMs: 100,
    leaseKeyPrefix: 'gw:lease:',
    l2KeyPrefix: 'gw:l2:',
    cbKeyPrefix: 'gw:cb:',
    l2StaleRetentionFactor: 2,
  },
} as const;

export const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

export const DEFAULT_STRIP_PREFIX = true;
