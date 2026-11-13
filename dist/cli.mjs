#!/usr/bin/env node

// src/cli.ts
import { parseArgs } from "util";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import { pathToFileURL as pathToFileURL2 } from "url";

// src/core/GatewayEngine.ts
import http3 from "http";
import { randomUUID as randomUUID4 } from "crypto";
import { performance } from "perf_hooks";

// src/constants.ts
var HEADERS = {
  forwardedFor: "x-forwarded-for",
  forwardedProto: "x-forwarded-proto",
  realIp: "x-real-ip",
  rateLimitLimit: "x-ratelimit-limit",
  rateLimitRemaining: "x-ratelimit-remaining",
  rateLimitReset: "x-ratelimit-reset",
  rateLimitSource: "x-ratelimit-source",
  retryAfter: "retry-after",
  apiKey: "x-api-key",
  authorization: "authorization",
  gatewayCache: "x-gateway-cache",
  cacheControl: "cache-control",
  connection: "connection",
  requestId: "x-request-id",
  gatewaySubject: "x-gateway-subject",
  gatewayTimestamp: "x-gateway-timestamp",
  gatewaySignature: "x-gateway-signature",
  contentTypeOptions: "x-content-type-options",
  frameOptions: "x-frame-options",
  referrerPolicy: "referrer-policy",
  strictTransportSecurity: "strict-transport-security",
  origin: "origin",
  accessControlRequestMethod: "access-control-request-method",
  accessControlRequestHeaders: "access-control-request-headers",
  accessControlAllowOrigin: "access-control-allow-origin",
  accessControlAllowMethods: "access-control-allow-methods",
  accessControlAllowHeaders: "access-control-allow-headers",
  accessControlAllowCredentials: "access-control-allow-credentials",
  accessControlMaxAge: "access-control-max-age",
  apiKeyHeader: "x-api-key",
  idempotencyKey: "idempotency-key",
  idempotentReplay: "x-idempotent-replay",
  coalesced: "x-coalesced"
};
var STATUS = {
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
  unprocessableEntity: 422
};
var ERROR_CODES = {
  rateLimited: "RATE_LIMITED",
  circuitOpen: "CIRCUIT_OPEN",
  noRoute: "NO_ROUTE",
  upstreamError: "UPSTREAM_ERROR",
  draining: "DRAINING",
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  routeLoadError: "ROUTE_LOAD_ERROR",
  pathTraversalBlocked: "PATH_TRAVERSAL_BLOCKED",
  payloadTooLarge: "PAYLOAD_TOO_LARGE",
  unsupportedMediaType: "UNSUPPORTED_MEDIA_TYPE",
  policyDenied: "POLICY_DENIED",
  locked: "LOCKED",
  idempotencyMismatch: "IDEMPOTENCY_MISMATCH",
  conflict: "CONFLICT",
  overloaded: "OVERLOADED"
};
var SECURITY_EVENT_TYPES = {
  pathTraversalBlocked: "PATH_TRAVERSAL_BLOCKED",
  bruteForceLocked: "BRUTE_FORCE_LOCKED",
  authDenied: "AUTH_DENIED",
  policyDenied: "POLICY_DENIED"
};
var CACHE_STATUS = {
  hit: "HIT",
  miss: "MISS",
  stale: "STALE"
};
var FAIL_MODES = {
  open: "open",
  closed: "closed",
  fallback: "fallback"
};
var CIRCUIT_STATES = {
  closed: "CLOSED",
  open: "OPEN",
  halfOpen: "HALF_OPEN"
};
var DEFAULTS = {
  port: 8080,
  host: "0.0.0.0",
  redisPrefix: "gw:rl",
  rateLimit: {
    capacity: 100,
    refillPerSecond: 10
  },
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    openDurationMs: 3e4,
    probeTimeoutMs: 1e4
  },
  limiter: {
    localMaxKeys: 1e4
  },
  proxy: {
    upstreamTimeoutMs: 3e4,
    maxSockets: 256,
    keepAlive: true
  },
  quickstart: {
    requestsPerMinute: 60
  },
  autoCircuitBreaker: {
    /** Error ratio (0..1) that trips the circuit. */
    failureThreshold: 0.5,
    /** Minimum upstream calls observed before ratio tripping. */
    minimumRequests: 10,
    /** Cooldown before HALF_OPEN probes (ms). */
    resetTimeoutMs: 15e3,
    successThreshold: 2,
    probeTimeoutMs: 5e3
  },
  inMemoryRedis: {
    maxKeys: 1e4
  },
  shutdown: {
    drainTimeoutMs: 1e4,
    retryAfterSeconds: 5
  },
  probes: {
    readinessTimeoutMs: 500
  },
  cache: {
    maxEntries: 500
  },
  perimeter: {
    maxBodyBytes: 1048576,
    frameOptions: "DENY",
    nosniff: "nosniff",
    referrerPolicy: "no-referrer",
    signatureMaxAgeMs: 6e4,
    signatureHeader: "x-gateway-signature",
    signatureTimestampHeader: "x-gateway-timestamp",
    bruteForceKeyPrefix: "gw:bf:",
    upstreamFingerprintHeaders: ["x-powered-by", "server"]
  },
  resilience: {
    idempotencyTtlMs: 864e5,
    // 24h
    idempotencyLockTimeoutMs: 3e4,
    idempotencyMethods: ["POST", "PATCH", "DELETE"],
    idempotencyKeyPrefix: "gw:idem:",
    coalesceLeaseMs: 3e3,
    coalesceWaitMs: 2800,
    coalescePollMs: 100,
    leaseKeyPrefix: "gw:lease:",
    l2KeyPrefix: "gw:l2:",
    cbKeyPrefix: "gw:cb:",
    l2StaleRetentionFactor: 2
  },
  networking: {
    eventLoopResolutionMs: 20,
    maxEventLoopDelayMs: 150,
    shedRetryAfterSec: 1,
    upstreamMaxSockets: 256,
    upstreamMaxFreeSockets: 64,
    upstreamKeepAliveMsecs: 4e3,
    serverKeepAliveTimeoutMs: 5e3,
    serverHeadersTimeoutMs: 6e4,
    serverRequestTimeoutMs: 3e5,
    upgradeHandshakeTimeoutMs: 1e4
  }
};
var HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
];

// src/shared/httpUtils.ts
var UPSTREAM_URL_RE = /^https?:\/\/\S+$/;
function asRoutePrefix(prefix) {
  if (!prefix.startsWith("/")) {
    throw new Error(`[gateway] Route path must start with '/', got "${prefix}".`);
  }
  return prefix;
}
function asUpstreamUrl(url) {
  if (!UPSTREAM_URL_RE.test(url)) {
    throw new Error(
      `[gateway] Invalid upstream URL "${url}" \u2014 must start with http:// or https://.`
    );
  }
  return url;
}
function expandTargetUrl(value) {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0 && value <= 65535) {
      return `http://localhost:${value}`;
    }
    throw new Error(`[gateway] invalid port number ${value}.`);
  }
  if (typeof value === "string") {
    if (UPSTREAM_URL_RE.test(value)) return value;
    if (/^:?\d{1,5}$/.test(value)) {
      const port = Number(value.replace(":", ""));
      if (port > 0 && port <= 65535) return `http://localhost:${port}`;
      throw new Error(`[gateway] invalid port "${value}".`);
    }
    if (/^[^\s/:]+:\d{1,5}$/.test(value)) {
      const port = Number(value.slice(value.lastIndexOf(":") + 1));
      if (port > 0 && port <= 65535) return `http://${value}`;
      throw new Error(`[gateway] invalid port in "${value}".`);
    }
    throw new Error(
      `[gateway] Invalid upstream URL "${value}" \u2014 must start with http:// or https://.`
    );
  }
  throw new Error(
    `[gateway] invalid upstream target ${JSON.stringify(value)} \u2014 expected a URL, port, or 'host:port'.`
  );
}
function toUpstreamTargets(input) {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) {
    throw new Error("[gateway] Route requires at least one upstream.");
  }
  const targets = list.map((item) => {
    if (typeof item === "string" || typeof item === "number") {
      return { url: asUpstreamUrl(expandTargetUrl(item)) };
    }
    if (typeof item === "object" && item !== null) {
      const rec = item;
      const target = {
        url: asUpstreamUrl(expandTargetUrl(rec.url))
      };
      if (rec.weight !== void 0) {
        if (typeof rec.weight !== "number" || !Number.isFinite(rec.weight) || rec.weight <= 0) {
          throw new Error("[gateway] upstream weight must be a positive number.");
        }
        target.weight = rec.weight;
      }
      return target;
    }
    throw new Error("[gateway] invalid upstream target.");
  });
  return targets;
}
var HOP_BY_HOP_SET = new Set(HOP_BY_HOP_HEADERS);
function hopByHopSet(extra) {
  if (extra === void 0 || extra.length === 0) return HOP_BY_HOP_SET;
  return /* @__PURE__ */ new Set([...HOP_BY_HOP_HEADERS, ...extra]);
}
function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n]+/g, "");
}
function headerString(headers, name) {
  const value = headers[name.toLowerCase()];
  if (value === void 0) return void 0;
  return Array.isArray(value) ? value[0] : value;
}

// src/utils/extractors.ts
function getHeaderString(req, name) {
  return headerString(req.headers, name);
}
function firstForwardedIp(value) {
  if (!value) return void 0;
  return value.split(",")[0]?.trim() || void 0;
}
function extractClientIp(req) {
  return firstForwardedIp(getHeaderString(req, HEADERS.forwardedFor)) ?? getHeaderString(req, HEADERS.realIp) ?? req.socket.remoteAddress ?? "unknown";
}
function extractApiKeyOrIp(req) {
  const apiKey = getHeaderString(req, HEADERS.apiKey);
  if (apiKey) return `key:${apiKey}`;
  const auth = getHeaderString(req, HEADERS.authorization);
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return `key:${auth.slice(7).trim()}`;
  }
  return `ip:${extractClientIp(req)}`;
}
function resolveExtractor(route2, globalExtractor) {
  return route2.extractClientKey ?? globalExtractor ?? extractApiKeyOrIp;
}

// src/shared/BoundedMap.ts
var BoundedMap = class {
  slots = /* @__PURE__ */ new Map();
  maxEntries;
  mode;
  now;
  constructor(options) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.mode = options.mode ?? "fifo";
    this.now = options.now ?? Date.now;
  }
  get size() {
    return this.slots.size;
  }
  /** Live (non-expired) entry count — used by tests/metrics. */
  get liveSize() {
    let n = 0;
    for (const key of this.slots.keys()) {
      if (this.live(key)) n += 1;
    }
    return n;
  }
  live(key) {
    const slot = this.slots.get(key);
    if (slot === void 0) return false;
    if (slot.expiresAt !== void 0 && slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return false;
    }
    return true;
  }
  /** Returns the value, or undefined when missing/expired. LRU refreshes. */
  get(key) {
    const slot = this.slots.get(key);
    if (slot === void 0) return void 0;
    if (slot.expiresAt !== void 0 && slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return void 0;
    }
    if (this.mode === "lru") {
      this.slots.delete(key);
      this.slots.set(key, slot);
    }
    return slot.value;
  }
  /** Raw slot access for callers needing expiry metadata (e.g. incr TTL). */
  entry(key) {
    const slot = this.slots.get(key);
    if (slot === void 0) return void 0;
    if (slot.expiresAt !== void 0 && slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return void 0;
    }
    if (this.mode === "lru") {
      this.slots.delete(key);
      this.slots.set(key, slot);
    }
    return { value: slot.value, expiresAt: slot.expiresAt };
  }
  /**
   * Insert/overwrite. `ttlMs` > 0 arms lazy expiry; evicts the oldest
   * entry (or least-recently-used in 'lru' mode) when at capacity.
   */
  set(key, value, ttlMs) {
    const expiresAt = ttlMs !== void 0 && ttlMs > 0 ? this.now() + ttlMs : void 0;
    const existing = this.slots.get(key);
    if (existing !== void 0) {
      this.slots.delete(key);
    } else if (this.slots.size >= this.maxEntries) {
      const oldest = this.slots.keys().next();
      if (!oldest.done) this.slots.delete(oldest.value);
    }
    this.slots.set(key, { value, expiresAt });
  }
  /** Set only when absent (SET NX semantics for locks/leases). */
  setIfAbsent(key, value, ttlMs) {
    if (this.get(key) !== void 0) return false;
    this.set(key, value, ttlMs);
    return true;
  }
  delete(key) {
    return this.slots.delete(key);
  }
  has(key) {
    return this.get(key) !== void 0;
  }
  /** Arm/replace the TTL on a live entry. Returns false when missing/expired. */
  expire(key, ttlMs) {
    const slot = this.slots.get(key);
    if (slot === void 0 || !this.live(key)) return false;
    slot.expiresAt = this.now() + ttlMs;
    return true;
  }
  /** Milliseconds until expiry, or undefined when no TTL / missing. */
  ttlRemainingMs(key) {
    const slot = this.slots.get(key);
    if (slot === void 0 || slot.expiresAt === void 0) return void 0;
    if (slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return void 0;
    }
    return slot.expiresAt - this.now();
  }
  keys() {
    return this.slots.keys();
  }
  *values() {
    for (const key of this.slots.keys()) {
      const v = this.get(key);
      if (v !== void 0) yield v;
    }
  }
  *entries() {
    for (const key of this.slots.keys()) {
      const v = this.get(key);
      if (v !== void 0) yield [key, v];
    }
  }
  clear() {
    this.slots.clear();
  }
};

// src/utils/http.ts
function sendJson(res, statusCode, payload, extraHeaders) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}
var ERROR_BODY_CACHE_MAX = 256;
var errorBodyCache = new BoundedMap({
  maxEntries: ERROR_BODY_CACHE_MAX
});
function sendErrorJson(res, statusCode, code, message, extraHeaders) {
  if (res.headersSent || res.writableEnded) return;
  const key = JSON.stringify([statusCode, code, message]);
  let cached = errorBodyCache.get(key);
  if (cached === void 0) {
    const body = JSON.stringify(defaultErrorBody(code, message));
    cached = { body, length: Buffer.byteLength(body) };
    errorBodyCache.set(key, cached);
  }
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": cached.length,
    ...extraHeaders
  });
  res.end(cached.body);
}
function sendGatewayResponse(res, response) {
  if (res.headersSent || res.writableEnded) return;
  const body = response.body;
  const headers = {};
  for (const [k, v] of Object.entries(response.headers ?? {})) {
    if (v === void 0) continue;
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  if (body !== void 0 && headers["content-length"] === void 0) {
    headers["content-length"] = String(
      typeof body === "string" ? Buffer.byteLength(body) : body.byteLength ?? body.length
    );
  }
  res.writeHead(response.statusCode, headers);
  res.end(body);
}
var defaultErrorBody = (code, message) => ({
  error: { code, message }
});
function secondsUntil(epochSeconds, nowMs) {
  return Math.max(0, Math.ceil(epochSeconds - nowMs / 1e3));
}

// src/limiter/LocalFallback.ts
var LocalFallback = class {
  buckets;
  constructor(maxKeys = DEFAULTS.limiter.localMaxKeys) {
    this.buckets = new BoundedMap({
      maxEntries: maxKeys,
      mode: "lru"
    });
  }
  consume(key, rule, now = Date.now()) {
    let bucket = this.buckets.get(key);
    if (bucket === void 0) {
      bucket = { tokens: rule.capacity, ts: now };
      this.buckets.set(key, bucket);
    }
    const elapsedSec = Math.max(0, (now - bucket.ts) / 1e3);
    bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsedSec * rule.refillPerSecond);
    bucket.ts = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: rule.capacity,
        resetAt: Math.ceil(now / 1e3) + Math.ceil((rule.capacity - bucket.tokens) / rule.refillPerSecond),
        retryAfterMs: 0
      };
    }
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / rule.refillPerSecond * 1e3);
    return {
      allowed: false,
      remaining: 0,
      limit: rule.capacity,
      resetAt: Math.ceil(now / 1e3) + Math.ceil(retryAfterMs / 1e3),
      retryAfterMs
    };
  }
  get size() {
    return this.buckets.size;
  }
};

// src/limiter/scripts.ts
import { createHash } from "crypto";
var TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local requested = tonumber(ARGV[3]) or 1

local t = redis.call('TIME')
local now = tonumber(t[1]) + (tonumber(t[2]) / 1000000)

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + (elapsed * refill))

local allowed = 0
local retryAfter = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  retryAfter = (requested - tokens) / refill
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
local ttlMs = math.ceil(((capacity / refill) * 2) * 1000) + 1000
redis.call('PEXPIRE', key, ttlMs)

return { allowed, tokens, capacity, now, retryAfter }
`;
var TOKEN_BUCKET_SHA1 = createHash("sha1").update(TOKEN_BUCKET_SCRIPT).digest("hex");

// src/shared/timers.ts
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function deadlineTimer(ms, onTimeout) {
  let fired = false;
  let cleared = false;
  const timer = setTimeout(() => {
    fired = true;
    cleared = true;
    onTimeout();
  }, ms);
  timer.unref?.();
  return {
    clear() {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
    },
    get fired() {
      return fired;
    }
  };
}
function destroySafely(...targets) {
  for (const t of targets) {
    if (t === void 0 || t === null) continue;
    try {
      t.destroy();
    } catch {
    }
  }
}

// src/limiter/RedisRateLimiter.ts
var DEFAULT_TIMEOUT_MS = 500;
function withTimeout(promise, ms) {
  return new Promise((resolve2, reject) => {
    const timer = deadlineTimer(
      ms,
      () => reject(new Error("redis timeout"))
    );
    promise.then(
      (v) => {
        timer.clear();
        resolve2(v);
      },
      (e) => {
        timer.clear();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}
function isNoScriptError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("NOSCRIPT");
}
var RedisRateLimiter = class {
  redis;
  failMode;
  keyPrefix;
  timeoutMs;
  local;
  /**
   * Locally-banked batch tokens per Redis key (batchSize > 1 leasing).
   * Bounded FIFO — high-cardinality keys can't grow it unboundedly.
   */
  batchCredits;
  warnedNoRedis = false;
  constructor(options = {}) {
    this.redis = options.redis;
    this.failMode = options.failMode ?? FAIL_MODES.fallback;
    this.keyPrefix = options.keyPrefix ?? DEFAULTS.redisPrefix;
    this.timeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.local = new LocalFallback(options.localMaxKeys);
    this.batchCredits = new BoundedMap({
      maxEntries: options.localMaxKeys ?? DEFAULTS.limiter.localMaxKeys
    });
    if (!this.redis && !this.warnedNoRedis) {
      this.warnedNoRedis = true;
      console.warn(
        "[gateway] No Redis client configured \u2014 using in-memory rate limiting. Limits are per-process, not distributed."
      );
    }
  }
  async consume(key, rule) {
    if (!this.redis) {
      return { ...this.local.consume(key, rule), source: "local" };
    }
    const redisKey = `${this.keyPrefix}:${key}`;
    const batch = this.batchFor(rule);
    if (batch > 1) {
      const credit = this.batchCredits.get(redisKey) ?? 0;
      if (credit > 0) {
        this.batchCredits.set(redisKey, credit - 1);
        return {
          allowed: true,
          remaining: credit - 1,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1e3) + 1,
          retryAfterMs: 0,
          source: "batch"
        };
      }
    }
    try {
      const raw = await this.runScript(redisKey, rule, batch);
      const result = this.parseResult(raw, rule);
      if (result.allowed && batch > 1) {
        this.setBatchCredit(redisKey, batch - 1);
      }
      return { ...result, source: "redis" };
    } catch {
      return this.handleFailure(key, rule);
    }
  }
  /** Tokens leased per Redis round-trip (clamped to burst capacity). */
  batchFor(rule) {
    const batch = rule.batchSize;
    if (batch === void 0 || batch <= 1) return 1;
    return Math.min(Math.floor(batch), Math.floor(rule.capacity), 1e3);
  }
  /** EVALSHA first (pre-loaded script), EVAL fallback on NOSCRIPT. */
  async runScript(redisKey, rule, requested) {
    const args = [
      redisKey,
      rule.capacity,
      rule.refillPerSecond,
      requested
    ];
    if (this.redis?.evalSha) {
      try {
        return await withTimeout(
          this.redis.evalSha(TOKEN_BUCKET_SHA1, 1, ...args),
          this.timeoutMs
        );
      } catch (err) {
        if (!isNoScriptError(err)) throw err;
      }
    }
    return withTimeout(
      this.redis.eval(TOKEN_BUCKET_SCRIPT, 1, ...args),
      this.timeoutMs
    );
  }
  setBatchCredit(redisKey, credits) {
    this.batchCredits.set(redisKey, credits);
  }
  /** Bulk pre-check used by adapters that want headers before deciding. */
  async check(key, rule) {
    return this.consume(key, rule);
  }
  /**
   * Liveness probe for readiness checks. In-memory mode is always ready;
   * a configured Redis must answer PING within the command timeout.
   */
  async ping(timeoutMs = this.timeoutMs) {
    if (!this.redis) return true;
    try {
      if (this.redis.ping) {
        await withTimeout(this.redis.ping(), timeoutMs);
      } else {
        await withTimeout(
          this.redis.eval('return redis.call("ping")', 0),
          timeoutMs
        );
      }
      return true;
    } catch {
      return false;
    }
  }
  handleFailure(key, rule) {
    switch (this.failMode) {
      case FAIL_MODES.open:
        return {
          allowed: true,
          remaining: rule.capacity,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1e3) + 1,
          retryAfterMs: 0,
          source: "fail-open"
        };
      case FAIL_MODES.closed:
        return {
          allowed: false,
          remaining: 0,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1e3) + 1,
          retryAfterMs: this.timeoutMs,
          source: "fail-closed"
        };
      case FAIL_MODES.fallback:
      default:
        return { ...this.local.consume(key, rule), source: "local-fallback" };
    }
  }
  parseResult(raw, rule) {
    if (!Array.isArray(raw) || raw.length < 5) {
      throw new Error("unexpected redis script result");
    }
    const [allowedRaw, tokensRaw, , nowRaw, retryRaw] = raw;
    const allowed = Number(allowedRaw) === 1;
    const tokens = Number(tokensRaw);
    const now = Number(nowRaw);
    const retrySec = Number(retryRaw);
    return {
      allowed,
      remaining: Math.max(0, Math.floor(tokens)),
      limit: rule.capacity,
      resetAt: Math.ceil(now + (rule.capacity - tokens) / rule.refillPerSecond),
      retryAfterMs: allowed ? 0 : Math.max(1, Math.ceil(retrySec * 1e3))
    };
  }
};

// src/limiter/InMemoryRedis.ts
var InMemoryRedis = class {
  buckets = new BoundedMap({
    maxEntries: DEFAULTS.inMemoryRedis.maxKeys
  });
  kv = new BoundedMap({
    maxEntries: DEFAULTS.inMemoryRedis.maxKeys
  });
  async eval(_script, _numKeys, ...args) {
    const key = String(args[0]);
    const capacity = Number(args[1]);
    const refill = Number(args[2]);
    const requested = Number(args[3] ?? 1);
    const now = Date.now() / 1e3;
    let bucket = this.buckets.get(key);
    if (bucket === void 0) {
      bucket = { tokens: capacity, ts: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = Math.max(0, now - bucket.ts);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refill);
    bucket.ts = now;
    let allowed = 0;
    let retry = 0;
    if (bucket.tokens >= requested) {
      bucket.tokens -= requested;
      allowed = 1;
    } else {
      retry = (requested - bucket.tokens) / refill;
    }
    return [allowed, bucket.tokens, capacity, now, retry];
  }
  /** In-memory EVALSHA — script text is irrelevant; semantics match eval. */
  async evalSha(_sha1, numKeys, ...args) {
    return this.eval("", numKeys, ...args);
  }
  async ping() {
    return "PONG";
  }
  async get(key) {
    return this.kv.get(key) ?? null;
  }
  async set(key, value, ...args) {
    let pxMs;
    let nx = false;
    for (let i = 0; i < args.length; i += 1) {
      const flag = String(args[i]).toUpperCase();
      if (flag === "PX") {
        const ms = Number(args[i + 1]);
        if (Number.isFinite(ms)) pxMs = ms;
        i += 1;
      } else if (flag === "NX") {
        nx = true;
      }
    }
    if (nx && this.kv.get(key) !== void 0) return null;
    this.kv.set(key, value, pxMs);
    return "OK";
  }
  async del(key) {
    return this.kv.delete(key) ? 1 : 0;
  }
  async incr(key) {
    const current = Number(this.kv.get(key) ?? "0");
    const next = current + 1;
    const ttl = this.kv.ttlRemainingMs(key);
    this.kv.set(key, String(next), ttl);
    return next;
  }
  async expire(key, seconds) {
    return this.kv.expire(key, seconds * 1e3) ? 1 : 0;
  }
};

// src/utils/store.ts
async function storeGet(store, key) {
  if (store.get) return store.get(key);
  const raw = await store.eval('return redis.call("GET", KEYS[1])', 1, key);
  return typeof raw === "string" ? raw : null;
}
async function storeSet(store, key, value, pxMs) {
  if (store.set) {
    return pxMs === void 0 ? store.set(key, value) : store.set(key, value, "PX", pxMs);
  }
  if (pxMs === void 0) {
    return store.eval('redis.call("SET", KEYS[1], ARGV[1]); return 1', 1, key, value);
  }
  return store.eval(
    'redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2]); return 1',
    1,
    key,
    value,
    pxMs
  );
}
async function storeSetNX(store, key, value, pxMs) {
  if (store.set) {
    const res = await store.set(key, value, "PX", pxMs, "NX");
    return res === "OK";
  }
  const raw = await store.eval(
    'local r = redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX"); return r and 1 or 0',
    1,
    key,
    value,
    pxMs
  );
  return Number(raw) === 1;
}
async function storeDel(store, key) {
  if (store.del) {
    await store.del(key);
    return;
  }
  await store.eval('return redis.call("DEL", KEYS[1])', 1, key);
}

// src/cache/ResponseCache.ts
var ResponseCache = class {
  map;
  ttlMs;
  now;
  store;
  l2Prefix;
  constructor(ttlMs, maxEntries = DEFAULTS.cache.maxEntries, now = Date.now, store, l2Prefix = DEFAULTS.resilience.l2KeyPrefix) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new BoundedMap({
      maxEntries,
      mode: "lru",
      now
    });
    this.store = store;
    this.l2Prefix = l2Prefix;
  }
  /** Synchronous L1-only lookup (hot path). */
  lookup(key) {
    const entry = this.map.get(key);
    if (entry === void 0) return {};
    return this.freshness(entry);
  }
  /**
   * L1 → L2 lookup. On L2 hit the entry is hydrated into L1.
   * Falls back to L1-only behavior when no store is configured.
   */
  async lookupShared(key) {
    const local = this.lookup(key);
    if (local.fresh || local.stale) return local;
    if (!this.store) return local;
    const raw = await storeGet(this.store, this.l2Key(key));
    if (!raw) return local;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return local;
    }
    if (typeof payload.storedAt !== "number" || typeof payload.body !== "string") {
      return local;
    }
    const entry = {
      statusCode: payload.statusCode,
      headers: payload.headers ?? {},
      body: Buffer.from(payload.body, "base64"),
      storedAt: payload.storedAt
    };
    this.setLocal(key, entry);
    return this.freshness(entry);
  }
  /** L2-only read — used by cross-node coalescing followers. */
  async lookupL2(key) {
    if (!this.store) return {};
    const raw = await storeGet(this.store, this.l2Key(key));
    if (!raw) return {};
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return {};
    }
    if (typeof payload.storedAt !== "number" || typeof payload.body !== "string") {
      return {};
    }
    const entry = {
      statusCode: payload.statusCode,
      headers: payload.headers ?? {},
      body: Buffer.from(payload.body, "base64"),
      storedAt: payload.storedAt
    };
    return this.freshness(entry);
  }
  set(key, entry) {
    this.setLocal(key, { ...entry, storedAt: this.now() });
  }
  /** L1 + L2 populate. L2 retention covers the stale window. */
  async setShared(key, entry) {
    const full = { ...entry, storedAt: this.now() };
    this.setLocal(key, full);
    if (!this.store) return;
    const payload = {
      statusCode: full.statusCode,
      headers: full.headers,
      body: full.body.toString("base64"),
      storedAt: full.storedAt
    };
    const retention = this.ttlMs * DEFAULTS.resilience.l2StaleRetentionFactor;
    await storeSet(this.store, this.l2Key(key), JSON.stringify(payload), retention).catch(
      () => void 0
    );
  }
  freshness(entry) {
    return this.now() - entry.storedAt <= this.ttlMs ? { fresh: entry, stale: entry } : { stale: entry };
  }
  setLocal(key, entry) {
    this.map.set(key, entry);
  }
  l2Key(key) {
    return `${this.l2Prefix}${key}`;
  }
  get size() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
};

// src/cache/RequestCoalescer.ts
import { randomUUID } from "crypto";
var RequestCoalescer = class {
  inflight;
  store;
  leaseMs;
  waitMs;
  pollMs;
  nodeId;
  constructor(store, options = {}) {
    this.store = store;
    this.inflight = new BoundedMap({
      maxEntries: options.maxInflight ?? DEFAULTS.cache.maxEntries
    });
    this.leaseMs = options.leaseMs ?? DEFAULTS.resilience.coalesceLeaseMs;
    this.waitMs = options.waitMs ?? DEFAULTS.resilience.coalesceWaitMs;
    this.pollMs = options.pollMs ?? DEFAULTS.resilience.coalescePollMs;
    this.nodeId = options.nodeId ?? randomUUID();
  }
  /** Existing in-flight upstream fetch for this key, if any. */
  get(key) {
    return this.inflight.get(key);
  }
  set(key, promise) {
    this.inflight.set(key, promise);
  }
  delete(key) {
    this.inflight.delete(key);
  }
  leaseKey(key) {
    return `${DEFAULTS.resilience.leaseKeyPrefix}${key}`;
  }
  /**
   * Try to become the cross-node leader for this cache key.
   * Returns false when another node holds the lease.
   */
  async acquireLease(key) {
    if (!this.store) return true;
    return storeSetNX(
      this.store,
      this.leaseKey(key),
      this.nodeId,
      this.leaseMs
    );
  }
  async releaseLease(key) {
    if (!this.store) return;
    await storeDel(this.store, this.leaseKey(key)).catch(() => void 0);
  }
  /**
   * Follower path: poll the shared L2 cache until an entry appears or
   * the wait budget expires. Returns the fresh entry or null.
   */
  async waitForShared(key, readL2) {
    if (!this.store) return null;
    const deadline = Date.now() + this.waitMs;
    while (Date.now() < deadline) {
      await sleep(this.pollMs);
      const { fresh, stale } = await readL2();
      const entry = fresh ?? stale;
      if (entry) return entry;
    }
    return null;
  }
};

// src/resilience/IdempotencyManager.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "crypto";
var HOP = HOP_BY_HOP_SET;
var REPLAY_EXCLUDED = /* @__PURE__ */ new Set(["x-idempotent-replay"]);
function jittered(ms) {
  return ms + Math.floor(Math.random() * ms);
}
var IdempotencyManager = class {
  store;
  nodeId;
  constructor(store, nodeId = randomUUID2()) {
    this.store = store;
    this.nodeId = nodeId;
  }
  keyFor(scope, idempotencyKey) {
    return `${DEFAULTS.resilience.idempotencyKeyPrefix}${scope}|${idempotencyKey}`;
  }
  fingerprint(method, url, rawBody) {
    return createHash2("sha256").update(method.toUpperCase()).update(" ").update(url).update("\n").update(rawBody).digest("hex");
  }
  /**
   * Attempt to begin an idempotent operation.
   * Returns 'proceed' with complete/abort callbacks when the lock is
   * acquired, a replay/conflict/mismatch decision otherwise.
   */
  async begin(scope, idempotencyKey, fingerprint, options) {
    const key = this.keyFor(scope, idempotencyKey);
    const deadline = Date.now() + options.lockTimeoutMs;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const locked = await storeSetNX(
        this.store,
        key,
        JSON.stringify({ state: "IN_PROGRESS", fingerprint, node: this.nodeId }),
        options.lockTimeoutMs
      );
      if (locked) {
        return {
          action: "proceed",
          complete: (result) => this.complete(key, fingerprint, result, options.ttlMs),
          abort: () => storeDel(this.store, key).then(() => void 0)
        };
      }
      const raw = await storeGet(this.store, key);
      if (raw === null) continue;
      let state;
      try {
        state = JSON.parse(raw);
      } catch {
        await storeDel(this.store, key);
        continue;
      }
      if (state.state === "COMPLETED") {
        if (state.fingerprint !== fingerprint) {
          return { action: "fingerprint-mismatch" };
        }
        return {
          action: "replay",
          statusCode: state.statusCode ?? STATUS.ok,
          headers: state.headers ?? {},
          body: Buffer.from(state.body ?? "", "base64")
        };
      }
      return this.pollForCompletion(key, fingerprint, deadline);
    }
    return { action: "conflict" };
  }
  async pollForCompletion(key, fingerprint, deadline) {
    while (Date.now() < deadline) {
      await sleep(jittered(50));
      const raw = await storeGet(this.store, key);
      if (raw === null) {
        return { action: "conflict" };
      }
      let state;
      try {
        state = JSON.parse(raw);
      } catch {
        return { action: "conflict" };
      }
      if (state.state === "COMPLETED") {
        if (state.fingerprint !== fingerprint) {
          return { action: "fingerprint-mismatch" };
        }
        return {
          action: "replay",
          statusCode: state.statusCode ?? STATUS.ok,
          headers: state.headers ?? {},
          body: Buffer.from(state.body ?? "", "base64")
        };
      }
    }
    return { action: "conflict" };
  }
  async complete(key, fingerprint, result, ttlMs) {
    const headers = {};
    for (const [name, value] of Object.entries(result.headers)) {
      const lower = name.toLowerCase();
      if (HOP.has(lower) || REPLAY_EXCLUDED.has(lower) || value === void 0) continue;
      headers[lower] = Array.isArray(value) ? value.join(", ") : value;
    }
    const stored = {
      state: "COMPLETED",
      fingerprint,
      statusCode: result.statusCode,
      headers,
      body: result.body.toString("base64")
    };
    await storeSet(this.store, key, JSON.stringify(stored), ttlMs);
  }
};

// src/routing/RouteLoader.ts
import { readdirSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";

// src/routing/dsl.ts
var RATE_LIMIT_RE = /^(\d+(?:\.\d+)?)\/(sec|min|hour)$/;
var UNIT_SECONDS = { sec: 1, min: 60, hour: 3600 };
var DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
var DURATION_UNIT_MS = {
  ms: 1,
  s: 1e3,
  m: 6e4,
  h: 36e5,
  d: 864e5
};
function parseRateLimit(input) {
  if (typeof input !== "string") return input;
  const match = RATE_LIMIT_RE.exec(input);
  if (!match) {
    throw new Error(
      `[gateway] Invalid rate limit "${input}". Expected '<n>/sec' | '<n>/min' | '<n>/hour'.`
    );
  }
  const amount = Number(match[1]);
  const unitSec = UNIT_SECONDS[match[2]];
  if (!Number.isFinite(amount) || amount <= 0 || unitSec === void 0) {
    throw new Error(`[gateway] Invalid rate limit "${input}".`);
  }
  return {
    capacity: Math.ceil(amount),
    refillPerSecond: amount / unitSec
  };
}
function parseDurationMs(input) {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`[gateway] Invalid duration ${input}ms.`);
    }
    return input;
  }
  const match = DURATION_RE.exec(input);
  if (!match) {
    throw new Error(
      `[gateway] Invalid duration "${input}". Expected '<n>ms' | '<n>s' | '<n>m' | '<n>h' | '<n>d'.`
    );
  }
  const value = Number(match[1]);
  const unitMs = DURATION_UNIT_MS[match[2]];
  if (!Number.isFinite(value) || value < 0 || unitMs === void 0) {
    throw new Error(`[gateway] Invalid duration "${input}".`);
  }
  return Math.round(value * unitMs);
}
function parseCacheInput(input) {
  if (typeof input === "object") return input;
  return { ttlMs: parseDurationMs(input) };
}
function normalizePrefix(path2) {
  if (!path2.startsWith("/")) {
    throw new Error(`[gateway] Route path must start with '/', got "${path2}".`);
  }
  if (path2.length > 2 && path2.endsWith("/*")) return path2.slice(0, -2);
  if (path2.endsWith("/") && path2.length > 1) return path2.slice(0, -1);
  return path2 === "" ? "/" : path2;
}
function toTargets(to) {
  return toUpstreamTargets(to);
}
function buildRoute(def) {
  const route2 = {
    prefix: normalizePrefix(def.path),
    upstreams: toTargets(def.to)
  };
  if (def.guards !== void 0) route2.guards = def.guards;
  if (def.stripHeaders !== void 0) route2.stripHeaders = def.stripHeaders;
  if (def.rateLimit !== void 0) route2.rateLimit = parseRateLimit(def.rateLimit);
  if (def.cache !== void 0) route2.cache = parseCacheInput(def.cache);
  if (def.stripPrefix !== void 0) route2.stripPrefix = def.stripPrefix;
  if (def.circuitBreaker !== void 0) {
    const { openDurationMs, ...rest } = def.circuitBreaker;
    const cb = { ...rest };
    if (openDurationMs !== void 0) {
      cb.openDurationMs = parseDurationMs(openDurationMs);
    }
    route2.circuitBreaker = cb;
  }
  if (def.extractClientKey !== void 0) route2.extractClientKey = def.extractClientKey;
  return route2;
}
function route(path2, to, options = {}) {
  const def = { path: path2, to, ...options };
  const built = buildRoute(def);
  return { ...built, path: def.path, to: def.to };
}

// src/routing/RouteLoader.ts
var SYNC_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".cjs"]);
var UPSTREAM_RE = /^https?:\/\/\S+$/;
function fail(file, message) {
  throw new Error(`[gateway] Route load error in ${file}: ${message}`);
}
function isObject(v) {
  return typeof v === "object" && v !== null;
}
function looksLikeRoute(v) {
  return isObject(v) && ("path" in v || "prefix" in v || "to" in v || "upstreams" in v);
}
function collectExports(mod, file) {
  const out = [];
  const push = (v) => {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (looksLikeRoute(item) || isObject(item)) out.push(item);
        else fail(file, "route array contains a non-object entry");
      }
    } else if (isObject(v)) {
      out.push(v);
    } else {
      fail(file, "module must export route objects or arrays of routes");
    }
  };
  if (Array.isArray(mod)) {
    push(mod);
    return out;
  }
  if (!isObject(mod)) fail(file, "module must export route definitions");
  const hasDefault = "default" in mod;
  const isSingleRoute = looksLikeRoute(mod) && !hasDefault;
  if (isSingleRoute) {
    push(mod);
    return out;
  }
  for (const [key, value] of Object.entries(mod)) {
    if (key === "__esModule") continue;
    if (key === "default") push(value);
    else if (looksLikeRoute(value) || Array.isArray(value)) push(value);
  }
  if (out.length === 0) fail(file, "module exports no route definitions");
  return out;
}
function normalizeRaw(raw, file) {
  if (!isObject(raw)) fail(file, "route entry must be an object");
  const r = raw;
  const pathValue = typeof r.path === "string" ? r.path : typeof r.prefix === "string" ? r.prefix : void 0;
  if (!pathValue) fail(file, 'route is missing "path" (or "prefix")');
  let to;
  if (typeof r.to === "string" || Array.isArray(r.to)) {
    to = r.to;
  } else if (Array.isArray(r.upstreams) && r.upstreams.every(
    (u) => isObject(u) && typeof u.url === "string"
  )) {
    to = r.upstreams.map((u) => u.url);
  } else {
    fail(file, `route "${pathValue}" is missing "to" upstream(s)`);
  }
  const list = Array.isArray(to) ? to : [to];
  for (const url of list) {
    if (typeof url !== "string" || !UPSTREAM_RE.test(url)) {
      fail(file, `route "${pathValue}" has invalid upstream "${String(url)}"`);
    }
  }
  const def = { path: pathValue, to };
  const opts = {};
  if (r.guards !== void 0) opts.guards = r.guards;
  if (r.stripHeaders !== void 0) {
    opts.stripHeaders = r.stripHeaders;
  }
  if (r.rateLimit !== void 0) {
    opts.rateLimit = r.rateLimit;
  }
  if (r.cache !== void 0) opts.cache = r.cache;
  if (r.stripPrefix !== void 0) opts.stripPrefix = r.stripPrefix;
  if (r.circuitBreaker !== void 0) {
    opts.circuitBreaker = r.circuitBreaker;
  }
  return { ...def, ...opts };
}
function validateUnique(defs, dir) {
  const seen = /* @__PURE__ */ new Set();
  for (const d of defs) {
    const prefix = normalizePrefix(d.path);
    if (seen.has(prefix)) {
      fail(dir, `duplicate/conflicting route prefix "${prefix}"`);
    }
    seen.add(prefix);
  }
}
function defsFromFiles(files, load) {
  const defs = [];
  for (const file of files) {
    for (const entry of collectExports(load(file), file)) {
      defs.push(normalizeRaw(entry, file));
    }
  }
  return defs;
}
function loadRoutesDirSync(dir) {
  const require2 = createRequire(pathToFileURL(process.cwd() + path.sep).href);
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const unsupported = entries.map((e) => e.name).filter((name) => !SYNC_EXTENSIONS.has(path.extname(name)));
  if (unsupported.length > 0) {
    throw new Error(
      `[gateway] routesDir contains files unsupported by sync loading: ${unsupported.join(", ")}. Use \`await loadRoutesDir(dir)\` for .ts/.mjs route modules.`
    );
  }
  const files = entries.map((e) => path.join(dir, e.name)).sort();
  const loaded = defsFromFiles(files, (file) => require2(file));
  validateUnique(loaded, dir);
  return loaded.map(
    (d) => route(d.path, d.to, d)
  );
}

// src/routing/normalize.ts
function normalizeRateLimit(input) {
  if (typeof input === "string") {
    return parseRateLimit(input);
  }
  if (typeof input === "object" && input !== null) {
    const rule = input;
    if (typeof rule.capacity === "number" && Number.isFinite(rule.capacity) && rule.capacity > 0 && typeof rule.refillPerSecond === "number" && Number.isFinite(rule.refillPerSecond) && rule.refillPerSecond > 0) {
      return rule;
    }
  }
  throw new Error(
    "[gateway] invalid rateLimit \u2014 expected a RateLimitRule or a string like '600/min'."
  );
}
function normalizeCache(input) {
  if (typeof input === "number") return parseCacheInput(input);
  if (typeof input === "string") {
    return parseCacheInput(input);
  }
  if (typeof input === "object" && input !== null) {
    return parseCacheInput(input);
  }
  throw new Error("[gateway] invalid cache \u2014 expected ttl ms, '30s', or RouteCacheConfig.");
}
function normalizeCircuitBreaker(input) {
  if (input === void 0) return void 0;
  if (typeof input !== "object" || input === null) {
    throw new Error("[gateway] invalid circuitBreaker \u2014 expected an options object.");
  }
  const { openDurationMs, ...rest } = input;
  const cb = { ...rest };
  if (openDurationMs !== void 0) {
    cb.openDurationMs = parseDurationMs(openDurationMs);
  }
  return cb;
}
function normalizeRoute(item) {
  const raw = item;
  const pathValue = raw.path ?? raw.prefix;
  if (typeof pathValue !== "string" || pathValue.length === 0) {
    throw new Error("[gateway] route requires a 'prefix' or 'path' starting with '/'.");
  }
  const upstreamInput = raw.upstreams ?? raw.to;
  if (upstreamInput === void 0) {
    throw new Error("[gateway] route requires 'upstreams' or 'to'.");
  }
  const {
    prefix: _p,
    path: _pa,
    upstreams: _u,
    to: _t,
    rateLimit: _r,
    circuitBreaker: _c,
    cache: _ca,
    ...rest
  } = raw;
  const route2 = {
    prefix: asRoutePrefix(normalizePrefix(pathValue)),
    upstreams: toUpstreamTargets(upstreamInput),
    ...rest
  };
  if (raw.rateLimit !== void 0) route2.rateLimit = normalizeRateLimit(raw.rateLimit);
  const cb = normalizeCircuitBreaker(raw.circuitBreaker);
  if (cb !== void 0) route2.circuitBreaker = cb;
  if (raw.cache !== void 0) route2.cache = normalizeCache(raw.cache);
  return route2;
}
function normalizeRoutes(input) {
  if (input === void 0) return void 0;
  if (typeof input !== "object" || input === null) {
    throw new Error("[gateway] routes must be an array or an object map.");
  }
  if (Array.isArray(input)) {
    return input.map((item) => normalizeRoute(item));
  }
  const map = input;
  return Object.entries(map).map(
    ([prefix, to]) => normalizeRoute({ prefix, upstreams: to })
  );
}
function applyBasePrefix(routes, basePrefix) {
  if (basePrefix === void 0) return [...routes];
  const base = normalizePrefix(basePrefix);
  if (base === "/") return [...routes];
  return routes.map((r) => {
    const prefix = String(r.prefix);
    const joined = prefix === "/" ? base : `${base}${prefix}`;
    return { ...r, prefix: asRoutePrefix(joined) };
  });
}
var DEFAULT_ENV_PREFIX = "GATEWAY_";
function autoRoutesFromEnv(config) {
  if (config === void 0) return [];
  const env = config.env ?? process.env;
  const envPrefix = config.envPrefix ?? DEFAULT_ENV_PREFIX;
  const out = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === void 0 || value === "") continue;
    if (!key.startsWith(envPrefix)) continue;
    const suffix = key.slice(envPrefix.length).toLowerCase().replace(/_+/g, "-").replace(/^-+|-+$/g, "");
    if (suffix === "") continue;
    out.push(
      normalizeRoute({ prefix: `/${suffix}`, upstreams: value })
    );
  }
  return out;
}
function assembleRoutes(input) {
  const explicit = normalizeRoutes(input.routes) ?? [...input.dirRoutes ?? []];
  const routes = [...explicit, ...autoRoutesFromEnv(input.autoRoutes)];
  if (routes.length === 0 && input.target !== void 0) {
    const def = {
      prefix: "/",
      upstreams: input.target
    };
    if (input.rateLimit !== void 0) def.rateLimit = input.rateLimit;
    if (input.circuitBreaker !== void 0) {
      def.circuitBreaker = input.circuitBreaker;
    }
    if (input.cache !== void 0) def.cache = input.cache;
    routes.push(normalizeRoute(def));
  }
  return applyBasePrefix(routes, input.basePrefix);
}
var RELOAD_OPTION_KEYS = /* @__PURE__ */ new Set([
  "routes",
  "target",
  "rateLimit",
  "circuitBreaker",
  "cache",
  "autoRoutes"
]);
function isRouteReloadConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).some((k) => RELOAD_OPTION_KEYS.has(k));
}

// src/security/BruteForceGuard.ts
var FAIL_PREFIX = DEFAULTS.perimeter.bruteForceKeyPrefix;
var BruteForceGuard = class {
  store;
  config;
  constructor(store, config) {
    this.store = store;
    this.config = config;
  }
  failKey(ip) {
    return `${FAIL_PREFIX}fail:${ip}`;
  }
  lockKey(ip) {
    return `${FAIL_PREFIX}lock:${ip}`;
  }
  /** Seconds remaining on an active lock, or null when not locked. */
  async lockedFor(ip) {
    const raw = await this.storeGet(this.lockKey(ip));
    if (raw === null) return null;
    const lockedUntil = Number(raw);
    if (!Number.isFinite(lockedUntil)) return null;
    const remainingMs = lockedUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1e3) : null;
  }
  /** Record an auth failure; returns lock seconds when this trips the lock. */
  async recordFailure(ip) {
    const failures = await this.increment(this.failKey(ip));
    await this.expire(this.failKey(ip), this.config.windowSec);
    if (failures >= this.config.maxFailures) {
      const lockUntil = Date.now() + this.config.lockDurationSec * 1e3;
      await this.storeSet(this.lockKey(ip), String(lockUntil));
      await this.expire(this.lockKey(ip), this.config.lockDurationSec);
      await this.storeDel(this.failKey(ip));
      return this.config.lockDurationSec;
    }
    return null;
  }
  /** Clear failure counters (e.g. after a successful auth). */
  async recordSuccess(ip) {
    await this.storeDel(this.failKey(ip));
  }
  // ---- store abstraction ----
  async storeGet(key) {
    if (this.store.get) return this.store.get(key);
    const raw = await this.store.eval('return redis.call("GET", KEYS[1])', 1, key);
    return typeof raw === "string" ? raw : null;
  }
  async storeSet(key, value) {
    if (this.store.set) {
      await this.store.set(key, value);
      return;
    }
    await this.store.eval(
      'redis.call("SET", KEYS[1], ARGV[1]); return 1',
      1,
      key,
      value
    );
  }
  async storeDel(key) {
    if (this.store.del) {
      await this.store.del(key);
      return;
    }
    await this.store.eval('return redis.call("DEL", KEYS[1])', 1, key);
  }
  async increment(key) {
    if (this.store.incr) return this.store.incr(key);
    const raw = await this.store.eval(
      'local v = redis.call("INCR", KEYS[1]); return v',
      1,
      key
    );
    return Number(raw) || 0;
  }
  async expire(key, seconds) {
    if (this.store.expire) {
      await this.store.expire(key, seconds);
      return;
    }
    await this.store.eval('return redis.call("EXPIRE", KEYS[1], ARGV[1])', 1, key, seconds);
  }
};

// src/security/PerimeterGuard.ts
var TRAVERSAL_RE = /(?:^|\/)\.\.(?:\/|$)|%2e%2e|%2e\.|\.%2e|\0|%00/i;
var METADATA_HOSTNAMES = /* @__PURE__ */ new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data"
]);
function isLinkLocalIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  return octets[0] === 169 && octets[1] === 254;
}
function isBlockedIpv6(host) {
  const h = host.toLowerCase();
  return h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd00:ec2");
}
function isMetadataUpstream(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (METADATA_HOSTNAMES.has(hostname)) return true;
  if (isLinkLocalIpv4(hostname)) return true;
  if (hostname.includes(":") && isBlockedIpv6(hostname)) return true;
  return false;
}
function assertNoMetadataUpstreams(urls, allowMetadata) {
  if (allowMetadata) return;
  for (const url of urls) {
    if (isMetadataUpstream(url)) {
      throw new Error(
        `[gateway] Upstream "${url}" targets a link-local/metadata address. Set allowMetadataUpstreams: true to override the SSRF guard.`
      );
    }
  }
}
var MAX_DECODE_PASSES = 3;
function isPathTraversal(pathname) {
  if (TRAVERSAL_RE.test(pathname)) return true;
  let current = pathname;
  for (let i = 0; i < MAX_DECODE_PASSES; i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return true;
    }
    if (decoded === current) return false;
    if (TRAVERSAL_RE.test(decoded)) return true;
    current = decoded;
  }
  return TRAVERSAL_RE.test(current);
}
function contentTypeAllowed(req, allowed) {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const contentType = getHeaderString(req, "content-type");
  if (!contentType) return false;
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowed.has(mime);
}
function isOriginAllowed(cors, origin) {
  if (cors.origins === "*") return true;
  if (!origin) return false;
  return cors.origins.includes(origin);
}
function allowedOriginValue(cors, origin) {
  if (cors.origins === "*") return cors.credentials ? origin : "*";
  if (origin && cors.origins.includes(origin)) return origin;
  return void 0;
}
function buildCorsHeaders(cors, origin) {
  const headers = {};
  const allowOrigin = allowedOriginValue(cors, origin);
  if (allowOrigin === void 0) return headers;
  headers[HEADERS.accessControlAllowOrigin] = allowOrigin;
  if (cors.credentials) headers[HEADERS.accessControlAllowCredentials] = "true";
  if (cors.methods && cors.methods.length > 0) {
    headers[HEADERS.accessControlAllowMethods] = cors.methods.join(", ");
  }
  if (cors.headers && cors.headers.length > 0) {
    headers[HEADERS.accessControlAllowHeaders] = cors.headers.join(", ");
  }
  if (cors.maxAgeSec !== void 0) {
    headers[HEADERS.accessControlMaxAge] = String(cors.maxAgeSec);
  }
  return headers;
}
function isPreflight(req) {
  return (req.method ?? "") === "OPTIONS" && getHeaderString(req, HEADERS.origin) !== void 0 && getHeaderString(req, HEADERS.accessControlRequestMethod) !== void 0;
}
function assertValidCors(cors) {
  if (cors.origins === "*" && cors.credentials === true) {
    throw new Error(
      '[gateway] CORS misconfiguration: origins: "*" cannot be combined with credentials: true.'
    );
  }
}

// src/core/CircuitBreaker.ts
var CircuitBreaker = class {
  states = /* @__PURE__ */ new Map();
  defaults;
  overrides = /* @__PURE__ */ new Map();
  now;
  store;
  nodeId = "local";
  constructor(defaults = {}, now = Date.now) {
    this.defaults = { ...DEFAULTS.circuitBreaker, ...defaults };
    this.now = now;
  }
  /** Attach a shared store for cross-node OPEN propagation + probe leases. */
  setDistributedStore(store, nodeId) {
    this.store = store;
    this.nodeId = nodeId;
  }
  /** Register per-key option overrides (e.g. per route). */
  configure(key, options) {
    this.overrides.set(key, { ...this.overrides.get(key), ...options });
  }
  canExecute(key) {
    const state = this.getOrCreate(key);
    const opts = this.optionsFor(key);
    const now = this.now();
    switch (state.state) {
      case CIRCUIT_STATES.closed:
        state.windowRequests += 1;
        return true;
      case CIRCUIT_STATES.open:
        if (now - state.openedAt >= opts.openDurationMs) {
          state.state = CIRCUIT_STATES.halfOpen;
          state.consecutiveSuccesses = 0;
          state.halfOpenInFlight = 0;
          return this.canExecute(key);
        }
        return false;
      case CIRCUIT_STATES.halfOpen:
        if (state.halfOpenInFlight >= opts.successThreshold) return false;
        state.halfOpenInFlight += 1;
        return true;
    }
  }
  /**
   * Distributed-aware canExecute: honors OPEN markers published by peer
   * nodes and serializes HALF_OPEN probes across the fleet via an
   * atomic NX lease. Falls back to local behavior without a store.
   */
  async canExecuteShared(key) {
    if (this.store) {
      const marker = await storeGet(this.store, this.openKey(key));
      if (marker !== null) {
        let openedAt = this.now();
        try {
          openedAt = JSON.parse(marker).openedAt ?? openedAt;
        } catch {
        }
        const state = this.getOrCreate(key);
        if (state.state !== CIRCUIT_STATES.open) {
          state.state = CIRCUIT_STATES.open;
          state.openedAt = openedAt;
          state.windowRequests = 0;
          state.windowFailures = 0;
        }
        return false;
      }
      const local = this.states.get(key);
      const opts = this.optionsFor(key);
      const probeCandidate = local !== void 0 && (local.state === CIRCUIT_STATES.halfOpen || local.state === CIRCUIT_STATES.open && this.now() - local.openedAt >= opts.openDurationMs);
      if (probeCandidate) {
        const leased = await storeSetNX(
          this.store,
          this.probeKey(key),
          this.nodeId,
          Math.min(opts.openDurationMs, 3e4)
        );
        if (!leased) return false;
      }
    }
    return this.canExecute(key);
  }
  /** State including peer-published OPEN markers. */
  async stateOfShared(key) {
    const local = this.stateOf(key);
    if (local === CIRCUIT_STATES.open || !this.store) return local;
    const marker = await storeGet(this.store, this.openKey(key));
    return marker !== null ? CIRCUIT_STATES.open : local;
  }
  recordSuccess(key) {
    const state = this.getOrCreate(key);
    const opts = this.optionsFor(key);
    state.consecutiveFailures = 0;
    if (state.state === CIRCUIT_STATES.halfOpen) {
      state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
      state.consecutiveSuccesses += 1;
      if (state.consecutiveSuccesses >= opts.successThreshold) {
        state.state = CIRCUIT_STATES.closed;
        state.consecutiveSuccesses = 0;
        state.windowRequests = 0;
        state.windowFailures = 0;
        this.releaseDistributed(key);
      }
      return;
    }
    state.consecutiveSuccesses = 0;
  }
  recordFailure(key) {
    const state = this.getOrCreate(key);
    const opts = this.optionsFor(key);
    state.consecutiveSuccesses = 0;
    if (state.state === CIRCUIT_STATES.halfOpen) {
      state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
      state.consecutiveFailures = opts.failureThreshold;
      this.open(key, state, opts.openDurationMs);
      return;
    }
    state.consecutiveFailures += 1;
    state.windowFailures += 1;
    const ratio = opts.failureRatioThreshold;
    const minReq = opts.minimumRequests ?? 0;
    const ratioTripped = ratio !== void 0 && state.windowRequests >= minReq && state.windowFailures / Math.max(1, state.windowRequests) >= ratio;
    if (ratio !== void 0) {
      if (ratioTripped) this.open(key, state, opts.openDurationMs);
      return;
    }
    if (state.consecutiveFailures >= opts.failureThreshold) {
      this.open(key, state, opts.openDurationMs);
    }
  }
  open(key, state, openDurationMs) {
    state.state = CIRCUIT_STATES.open;
    state.openedAt = this.now();
    state.windowRequests = 0;
    state.windowFailures = 0;
    if (this.store) {
      const marker = { openedAt: state.openedAt };
      void storeSet(
        this.store,
        this.openKey(key),
        JSON.stringify(marker),
        openDurationMs
      ).catch(() => void 0);
    }
  }
  /** Best-effort release of open marker + probe lease after recovery. */
  releaseDistributed(key) {
    if (!this.store) return;
    void storeDel(this.store, this.openKey(key)).catch(() => void 0);
    void storeDel(this.store, this.probeKey(key)).catch(() => void 0);
  }
  openKey(key) {
    return `${DEFAULTS.resilience.cbKeyPrefix}open:${key}`;
  }
  probeKey(key) {
    return `${DEFAULTS.resilience.cbKeyPrefix}probe:${key}`;
  }
  stateOf(key) {
    return this.states.get(key)?.state ?? CIRCUIT_STATES.closed;
  }
  reset() {
    this.states.clear();
  }
  getOrCreate(key) {
    let state = this.states.get(key);
    if (!state) {
      state = {
        state: CIRCUIT_STATES.closed,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        openedAt: 0,
        halfOpenInFlight: 0,
        windowRequests: 0,
        windowFailures: 0
      };
      this.states.set(key, state);
    }
    return state;
  }
  optionsFor(key) {
    return { ...this.defaults, ...this.overrides.get(key) };
  }
};

// src/core/Router.ts
function pathnameOf(url) {
  if (!url) return "/";
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}
function matchesPrefix(pathname, prefix) {
  if (prefix === "/") return true;
  if (pathname === prefix) return true;
  return pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}
var Router = class {
  routes;
  /** O(1) exact-path hits (pathname === prefix) checked before prefix scan. */
  exact = /* @__PURE__ */ new Map();
  counters = /* @__PURE__ */ new Map();
  constructor(routes) {
    this.routes = [...routes].sort(
      (a, b) => b.prefix.length - a.prefix.length
    );
    for (const route2 of this.routes) {
      const key = String(route2.prefix);
      if (!this.exact.has(key)) this.exact.set(key, route2);
    }
  }
  resolve(req) {
    const pathname = pathnameOf(req.url);
    const exactHit = this.exact.get(pathname);
    if (exactHit !== void 0) {
      return { route: exactHit, strippedPath: "/" };
    }
    for (const route2 of this.routes) {
      const prefix = route2.prefix;
      if (matchesPrefix(pathname, prefix)) {
        const stripped = prefix === "/" ? pathname : pathname.slice(prefix.length) || "/";
        return { route: route2, strippedPath: stripped.startsWith("/") ? stripped : `/${stripped}` };
      }
    }
    return void 0;
  }
  /** Weighted round-robin upstream selection. Key should be route prefix. */
  nextUpstream(key, upstreams) {
    const totalWeight = upstreams.reduce((sum, u) => sum + (u.weight ?? 1), 0);
    let counter = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, counter);
    let acc = 0;
    for (const upstream of upstreams) {
      acc += upstream.weight ?? 1;
      if (counter % totalWeight < acc) {
        if (counter > totalWeight * 1e3) this.counters.set(key, counter % totalWeight);
        return upstream;
      }
    }
    return upstreams[0];
  }
};

// src/core/ProxyHandler.ts
import http from "http";
import https from "https";
import { randomUUID as randomUUID3 } from "crypto";

// src/security/UpstreamSigner.ts
import { createHmac, timingSafeEqual } from "crypto";
function signaturePayload(timestampMs, method, path2, subject, requestId) {
  return `${timestampMs}.${method.toUpperCase()}.${path2}.${subject}.${requestId}`;
}
function hmac(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
function signGatewayRequest(input) {
  const timestampMs = input.timestampMs ?? Date.now();
  const headerName = input.headerName ?? DEFAULTS.perimeter.signatureHeader;
  const timestampHeader = input.timestampHeader ?? DEFAULTS.perimeter.signatureTimestampHeader;
  const signature = hmac(
    signaturePayload(timestampMs, input.method, input.path, input.subject, input.requestId),
    input.secret
  );
  return {
    headers: {
      [headerName]: signature,
      [timestampHeader]: String(timestampMs)
    },
    timestampMs
  };
}

// src/core/ProxyHandler.ts
var UpstreamTimeoutError = class extends Error {
  constructor(ms) {
    super(`upstream timeout after ${ms}ms`);
    this.name = "UpstreamTimeoutError";
  }
};
var PayloadTooLargeError = class extends Error {
  constructor(limit) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "PayloadTooLargeError";
  }
};
var HOP_BY_HOP = HOP_BY_HOP_SET;
var ProxyHandler = class {
  agents = /* @__PURE__ */ new Map();
  timeoutMs;
  maxSockets;
  maxFreeSockets;
  keepAliveMsecs;
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.maxSockets = options.maxSockets ?? DEFAULTS.networking.upstreamMaxSockets;
    this.maxFreeSockets = options.maxFreeSockets ?? DEFAULTS.networking.upstreamMaxFreeSockets;
    this.keepAliveMsecs = options.keepAliveMsecs ?? DEFAULTS.networking.upstreamKeepAliveMsecs;
  }
  /** Live per-upstream-origin connection pool metrics. */
  poolMetrics() {
    const out = {};
    for (const [origin, agent] of this.agents) {
      let activeSockets = 0;
      let freeSockets = 0;
      for (const list of Object.values(agent.sockets)) {
        if (list) activeSockets += list.length;
      }
      for (const list of Object.values(agent.freeSockets)) {
        if (list) freeSockets += list.length;
      }
      const pending = agent.requests;
      out[origin] = {
        activeSockets,
        freeSockets,
        queuedRequests: Array.isArray(pending) ? pending.length : 0
      };
    }
    return out;
  }
  /**
   * Forward `req` to the upstream and stream the response into `res`.
   * Resolves with response metadata once upstream headers arrive.
   * Rejects on connect/timeout errors (response may be partially written —
   * callers should treat rejection as fatal for the request).
   */
  forward(req, res, target, options) {
    return new Promise((resolve2, reject) => {
      const maxBodyBytes = options?.maxBodyBytes;
      const contentLength = Number(req.headers["content-length"]);
      if (maxBodyBytes !== void 0 && Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        reject(new PayloadTooLargeError(maxBodyBytes));
        return;
      }
      const url = new URL(target.upstream.url);
      const isHttps = url.protocol === "https:";
      const transport = isHttps ? https : http;
      const requestId = this.resolveRequestId(req, target);
      const headers = this.buildHeaders(req, url, target, requestId);
      const agent = this.agentFor(url);
      const upstreamReq = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: target.path,
          method: req.method,
          headers,
          agent
        },
        (upstreamRes) => {
          timer.clear();
          const statusCode = upstreamRes.statusCode ?? STATUS.badGateway;
          if (options?.maskErrors === true && statusCode >= 500) {
            this.maskedResponse(upstreamRes, res, target.responseHeaders, statusCode, resolve2);
            return;
          }
          if (options?.captureBody) {
            const chunks = [];
            upstreamRes.on("data", (chunk) => chunks.push(chunk));
            upstreamRes.on("end", () => {
              const body = Buffer.concat(chunks);
              this.writeResponse(upstreamRes, res, target.responseHeaders, body);
              resolve2({
                statusCode,
                headers: upstreamRes.headers,
                body
              });
            });
            upstreamRes.on("error", (err) => {
              res.destroy();
              reject(err);
            });
            return;
          }
          this.pipeResponse(upstreamRes, res, target.responseHeaders);
          resolve2({
            statusCode,
            headers: upstreamRes.headers
          });
        }
      );
      const timer = deadlineTimer(this.timeoutMs, () => {
        upstreamReq.destroy(new UpstreamTimeoutError(this.timeoutMs));
      });
      upstreamReq.on("close", () => timer.clear());
      res.on("close", () => {
        if (!res.writableEnded) upstreamReq.destroy();
      });
      req.on("aborted", () => upstreamReq.destroy());
      upstreamReq.on("error", (err) => {
        timer.clear();
        reject(err instanceof UpstreamTimeoutError ? err : err);
      });
      req.on("error", (err) => {
        timer.clear();
        upstreamReq.destroy();
        reject(err);
      });
      const onAbort = () => {
        timer.clear();
        upstreamReq.destroy(new Error("upstream attempt aborted"));
      };
      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
        upstreamReq.on(
          "close",
          () => options.signal?.removeEventListener("abort", onAbort)
        );
      }
      if (target.bodyOverride !== void 0) {
        upstreamReq.end(target.bodyOverride);
        return;
      }
      if (maxBodyBytes !== void 0) {
        let received = 0;
        req.on("data", (chunk) => {
          received += chunk.length;
          if (received > maxBodyBytes) {
            upstreamReq.destroy(new PayloadTooLargeError(maxBodyBytes));
            req.unpipe(upstreamReq);
          }
        });
      }
      req.pipe(upstreamReq);
    });
  }
  resolveRequestId(req, target) {
    if (target.requestId) return target.requestId;
    const incoming = getHeaderString(req, HEADERS.requestId);
    if (incoming && /^[\w.:-]{1,128}$/.test(incoming)) return incoming;
    return randomUUID3();
  }
  buildHeaders(req, url, target, requestId) {
    const headers = {};
    const strip = target.stripHeaders;
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === void 0 || HOP_BY_HOP.has(name)) continue;
      if (strip !== void 0 && strip.has(name)) continue;
      headers[name] = Array.isArray(value) ? value.map(sanitizeHeaderValue) : sanitizeHeaderValue(value);
    }
    headers[HEADERS.requestId] = requestId;
    const clientIp = getHeaderString(req, HEADERS.forwardedFor) ? `${getHeaderString(req, HEADERS.forwardedFor)}, ${req.socket.remoteAddress ?? ""}` : req.socket.remoteAddress ?? "";
    if (clientIp) headers[HEADERS.forwardedFor] = clientIp;
    const proto = getHeaderString(req, HEADERS.forwardedProto) ?? url.protocol.replace(":", "");
    headers[HEADERS.forwardedProto] = proto;
    if (target.guardHeaders) {
      for (const [name, value] of Object.entries(target.guardHeaders)) {
        headers[name.toLowerCase()] = value;
      }
    }
    if (target.signing) {
      if (target.signing.subject !== "" && target.signing.subjectHeader) {
        headers[target.signing.subjectHeader.toLowerCase()] = target.signing.subject;
      }
      const signed = signGatewayRequest({
        secret: target.signing.secret,
        method: req.method ?? "GET",
        path: target.path,
        subject: target.signing.subject,
        requestId,
        ...target.signing.headerName !== void 0 ? { headerName: target.signing.headerName } : {},
        ...target.signing.timestampHeader !== void 0 ? { timestampHeader: target.signing.timestampHeader } : {}
      });
      for (const [name, value] of Object.entries(signed.headers)) {
        headers[name] = value;
      }
    }
    return headers;
  }
  responseHeadersFor(upstreamRes, extraHeaders) {
    const headers = {};
    const fingerprint = new Set(DEFAULTS.perimeter.upstreamFingerprintHeaders);
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (value === void 0 || HOP_BY_HOP.has(name) || fingerprint.has(name)) continue;
      headers[name] = value;
    }
    if (extraHeaders) {
      for (const [name, value] of Object.entries(extraHeaders)) {
        headers[name.toLowerCase()] = value;
      }
    }
    headers["x-gateway"] = "udinmoinc";
    return headers;
  }
  writeResponse(upstreamRes, res, extraHeaders, body) {
    res.writeHead(upstreamRes.statusCode ?? STATUS.badGateway, this.responseHeadersFor(upstreamRes, extraHeaders));
    res.end(body);
  }
  pipeResponse(upstreamRes, res, extraHeaders) {
    res.writeHead(upstreamRes.statusCode ?? STATUS.badGateway, this.responseHeadersFor(upstreamRes, extraHeaders));
    upstreamRes.pipe(res);
    upstreamRes.on("error", () => res.destroy());
  }
  /**
   * maskUpstreamErrors: consume and discard a 5xx upstream body, then
   * answer with a sanitized JSON error so internals never leak.
   */
  maskedResponse(upstreamRes, res, extraHeaders, statusCode, resolve2) {
    const chunks = [];
    upstreamRes.on("data", (chunk) => chunks.push(chunk));
    upstreamRes.on("end", () => {
      void chunks;
      const headers = this.responseHeadersFor(upstreamRes, extraHeaders);
      delete headers["content-length"];
      delete headers["content-encoding"];
      headers["content-type"] = "application/json; charset=utf-8";
      const body = Buffer.from(
        JSON.stringify({ error: { code: "UPSTREAM_ERROR", message: "upstream error" } })
      );
      headers["content-length"] = String(body.length);
      res.writeHead(statusCode, headers);
      res.end(body);
      resolve2({ statusCode, headers: upstreamRes.headers });
    });
    upstreamRes.on("error", () => {
      res.destroy();
      resolve2({ statusCode: STATUS.badGateway, headers: {} });
    });
  }
  /**
   * One keep-alive agent per upstream origin — tuned for high
   * concurrency: LIFO scheduling, no-delay sockets, bounded free pool.
   */
  agentFor(url) {
    const key = url.origin;
    let agent = this.agents.get(key);
    if (!agent) {
      const isHttps = url.protocol === "https:";
      const opts = {
        keepAlive: true,
        maxSockets: this.maxSockets,
        maxFreeSockets: this.maxFreeSockets,
        keepAliveMsecs: this.keepAliveMsecs,
        scheduling: "lifo",
        socketNoDelay: true
      };
      agent = isHttps ? new https.Agent(opts) : new http.Agent(opts);
      this.agents.set(key, agent);
    }
    return agent;
  }
  async close() {
    await Promise.all(
      [...this.agents.values()].map(
        (agent) => new Promise((resolve2) => {
          agent.destroy();
          resolve2();
        })
      )
    );
    this.agents.clear();
  }
};

// src/routing/LoadBalancer.ts
var EWMA_ALPHA = 0.2;
var LoadBalancer = class {
  stats = /* @__PURE__ */ new Map();
  statsFor(url) {
    let s = this.stats.get(url);
    if (!s) {
      s = { inFlight: 0, ewmaMs: 0, samples: 0 };
      this.stats.set(url, s);
    }
    return s;
  }
  enter(url) {
    this.statsFor(url).inFlight += 1;
  }
  /** Record completion; latencyMs is time-to-first-byte. */
  leave(url, latencyMs) {
    const s = this.statsFor(url);
    s.inFlight = Math.max(0, s.inFlight - 1);
    s.ewmaMs = s.samples === 0 ? latencyMs : s.ewmaMs + EWMA_ALPHA * (latencyMs - s.ewmaMs);
    s.samples += 1;
  }
  statsOf(url) {
    const s = this.stats.get(url);
    return { inFlight: s?.inFlight ?? 0, ewmaMs: s?.ewmaMs ?? 0 };
  }
  /** Weighted random pick of one candidate. */
  pickWeighted(upstreams) {
    const total = upstreams.reduce((sum, u) => sum + (u.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const u of upstreams) {
      r -= u.weight ?? 1;
      if (r <= 0) return u;
    }
    return upstreams[0];
  }
  /** Lower score = less loaded (in-flight dominates, EWMA breaks ties). */
  score(url) {
    const s = this.stats.get(url);
    if (!s) return 0;
    const latencyScore = s.samples === 0 ? 5e4 : Math.round(s.ewmaMs * 1e3);
    return s.inFlight * 1e6 + latencyScore;
  }
  /**
   * Power-of-two-choices: sample two distinct weighted candidates,
   * return the one with the lower load score.
   */
  selectP2C(upstreams) {
    if (upstreams.length === 1) return upstreams[0];
    const a = this.pickWeighted(upstreams);
    let b = this.pickWeighted(upstreams);
    if (b.url === a.url && upstreams.length > 1) {
      for (let i = 0; i < 4 && b.url === a.url; i += 1) {
        b = this.pickWeighted(upstreams);
      }
      if (b.url === a.url) {
        b = upstreams.find((u) => u.url !== a.url) ?? a;
      }
    }
    return this.score(a.url) <= this.score(b.url) ? a : b;
  }
  /** P2C pick excluding a specific upstream (hedging secondary). */
  selectAlternative(upstreams, excludeUrl) {
    const candidates = upstreams.filter((u) => u.url !== excludeUrl);
    if (candidates.length === 0) return void 0;
    return this.selectP2C(candidates);
  }
};

// src/networking/LoadShedder.ts
import { monitorEventLoopDelay } from "perf_hooks";
var LoadShedder = class {
  histogram = monitorEventLoopDelay({
    resolution: DEFAULTS.networking.eventLoopResolutionMs
  });
  maxEventLoopDelayMs;
  maxConcurrentRequests;
  inFlightCount = 0;
  enabled = false;
  constructor(options = {}) {
    this.maxEventLoopDelayMs = options.maxEventLoopDelayMs ?? DEFAULTS.networking.maxEventLoopDelayMs;
    this.maxConcurrentRequests = options.maxConcurrentRequests;
  }
  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.histogram.enable();
  }
  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    this.histogram.disable();
  }
  enter() {
    this.inFlightCount += 1;
  }
  leave() {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
  }
  get inFlight() {
    return this.inFlightCount;
  }
  /** p99 event-loop delay in milliseconds. */
  eventLoopDelayP99Ms() {
    if (!this.enabled) return 0;
    return this.histogram.percentile(99) / 1e6;
  }
  shouldShed() {
    if (this.maxConcurrentRequests !== void 0 && this.inFlightCount >= this.maxConcurrentRequests) {
      return true;
    }
    return this.eventLoopDelayP99Ms() > this.maxEventLoopDelayMs;
  }
};

// src/networking/ClusterSupervisor.ts
import cluster from "cluster";
import os from "os";
var SHUTDOWN_MESSAGE = "gateway:shutdown";
async function listenCluster(gateway, options = {}) {
  if (cluster.isWorker) {
    await gateway.listen();
    const shutdown = () => {
      void gateway.shutdown().finally(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    process.on("message", (msg) => {
      if (msg === SHUTDOWN_MESSAGE) shutdown();
    });
    return;
  }
  const workerCount = options.workers ?? os.availableParallelism();
  const respawnDelayMs = options.respawnDelayMs ?? 1e3;
  const workers = /* @__PURE__ */ new Set();
  let shuttingDown = false;
  const spawn = () => {
    if (shuttingDown) return;
    const worker = cluster.fork();
    workers.add(worker);
    worker.on("exit", () => {
      workers.delete(worker);
      if (!shuttingDown) {
        setTimeout(spawn, respawnDelayMs).unref();
      }
    });
    worker.on("error", () => {
    });
  };
  for (let i = 0; i < workerCount; i += 1) spawn();
  const retire = (worker) => {
    worker.send(SHUTDOWN_MESSAGE);
    setTimeout(() => {
      if (!worker.isDead?.() && workers.has(worker)) worker.kill("SIGKILL");
    }, 15e3).unref();
    worker.on("exit", () => workers.delete(worker));
  };
  process.on("SIGTERM", () => {
    shuttingDown = true;
    for (const w of workers) retire(w);
    const wait = setInterval(() => {
      if (workers.size === 0) {
        clearInterval(wait);
        process.exit(0);
      }
    }, 100);
    wait.unref();
  });
  process.on("SIGINT", () => {
    process.emit("SIGTERM");
  });
  process.on("SIGUSR2", () => {
    const snapshot = [...workers];
    for (const w of snapshot) {
      spawn();
      retire(w);
    }
  });
  await new Promise(() => {
  });
}

// src/core/MetricsCollector.ts
var LATENCY_WINDOW = 512;
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}
var MetricsCollector = class {
  stats = /* @__PURE__ */ new Map();
  statFor(routeKey) {
    let s = this.stats.get(routeKey);
    if (!s) {
      s = {
        requestsTotal: 0,
        rateLimitedTotal: 0,
        circuitOpenTotal: 0,
        cacheHitTotal: 0,
        upstreamErrorsTotal: 0,
        latencies: new Array(LATENCY_WINDOW).fill(0),
        latencyIndex: 0,
        latencyFilled: false
      };
      this.stats.set(routeKey, s);
    }
    return s;
  }
  /** Count one completed request + observe its latency. */
  recordRequest(route2, latencyMs) {
    const s = this.statFor(String(route2));
    s.requestsTotal += 1;
    s.latencies[s.latencyIndex] = latencyMs;
    s.latencyIndex = (s.latencyIndex + 1) % LATENCY_WINDOW;
    if (s.latencyIndex === 0) s.latencyFilled = true;
  }
  /** Increment a specific outcome counter for a route. */
  recordOutcome(route2, outcome) {
    const s = this.statFor(String(route2));
    switch (outcome) {
      case "rate_limited":
        s.rateLimitedTotal += 1;
        break;
      case "circuit_open":
        s.circuitOpenTotal += 1;
        break;
      case "cache_hit":
        s.cacheHitTotal += 1;
        break;
      case "upstream_error":
        s.upstreamErrorsTotal += 1;
        break;
    }
  }
  /** JSON snapshot for `Accept: application/json`. */
  snapshot() {
    const out = {};
    for (const [route2, s] of this.stats) {
      const window = s.latencyFilled ? s.latencies : s.latencies.slice(0, s.latencyIndex);
      const sorted = [...window].sort((a, b) => a - b);
      out[route2] = {
        requestsTotal: s.requestsTotal,
        rateLimitedTotal: s.rateLimitedTotal,
        circuitOpenTotal: s.circuitOpenTotal,
        cacheHitTotal: s.cacheHitTotal,
        upstreamErrorsTotal: s.upstreamErrorsTotal,
        latencyMs: {
          count: sorted.length,
          p50: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          p99: quantile(sorted, 0.99)
        }
      };
    }
    return out;
  }
  /** Prometheus exposition format (text/plain; version=0.0.4). */
  prometheus() {
    const lines = [];
    for (const [route2, s] of this.stats) {
      const label = `route="${route2.replace(/"/g, '\\"')}"`;
      lines.push(
        `gateway_requests_total{${label}} ${s.requestsTotal}`,
        `gateway_rate_limited_total{${label}} ${s.rateLimitedTotal}`,
        `gateway_circuit_open_total{${label}} ${s.circuitOpenTotal}`,
        `gateway_cache_hit_total{${label}} ${s.cacheHitTotal}`,
        `gateway_upstream_errors_total{${label}} ${s.upstreamErrorsTotal}`
      );
      const window = s.latencyFilled ? s.latencies : s.latencies.slice(0, s.latencyIndex);
      const sorted = [...window].sort((a, b) => a - b);
      for (const [q, name] of [
        [0.5, "0.5"],
        [0.95, "0.95"],
        [0.99, "0.99"]
      ]) {
        lines.push(
          `gateway_request_duration_ms{${label},quantile="${name}"} ${quantile(sorted, q).toFixed(3)}`
        );
      }
    }
    return `${lines.join("\n")}
`;
  }
};

// src/networking/UpgradeProxy.ts
import "http";
import net from "net";
import tls from "tls";
var HOP_FOR_UPGRADE = hopByHopSet(["host"]);
function buildHandshake(req, target, upstream) {
  const lines = [
    `${req.method ?? "GET"} ${target.path} HTTP/1.1`
  ];
  const strip = target.stripHeaders;
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === void 0 || HOP_FOR_UPGRADE.has(name)) continue;
    if (strip !== void 0 && strip.has(name)) continue;
    const v = Array.isArray(value) ? value.map(sanitizeHeaderValue).join(", ") : sanitizeHeaderValue(value);
    lines.push(`${name}: ${v}`);
  }
  lines.push(`host: ${upstream.host}`);
  if (target.guardHeaders) {
    for (const [name, value] of Object.entries(target.guardHeaders)) {
      lines.push(`${name}: ${value}`);
    }
  }
  const fwd = req.socket.remoteAddress;
  if (fwd) lines.push(`${HEADERS.forwardedFor}: ${fwd}`);
  lines.push("", "");
  return lines.join("\r\n");
}
function proxyUpgrade(req, clientSocket, head, upstream, options) {
  const url = new URL(upstream.url);
  const isHttps = url.protocol === "https:";
  const port = Number(url.port) || (isHttps ? 443 : 80);
  const handshake = buildHandshake(req, options, url);
  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULTS.networking.upgradeHandshakeTimeoutMs;
  const upstreamSocket = isHttps ? tls.connect({ host: url.hostname, port, servername: url.hostname }) : net.connect({ host: url.hostname, port });
  upstreamSocket.setNoDelay(true);
  clientSocket.setNoDelay(true);
  let settled = false;
  const timer = deadlineTimer(timeoutMs, teardown);
  function teardown() {
    if (settled) return;
    settled = true;
    timer.clear();
    destroySafely(upstreamSocket, clientSocket);
  }
  upstreamSocket.on("error", teardown);
  clientSocket.on("error", teardown);
  upstreamSocket.on("close", () => destroySafely(clientSocket));
  clientSocket.on("close", () => destroySafely(upstreamSocket));
  upstreamSocket.once(isHttps ? "secureConnect" : "connect", () => {
    timer.clear();
    upstreamSocket.write(handshake);
    if (head.length > 0) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  });
}

// src/core/GatewayEngine.ts
var isGatewayResponse = (v) => typeof v === "object" && v !== null && "statusCode" in v;
var HOP_BY_HOP2 = HOP_BY_HOP_SET;
var CACHE_EXCLUDED_HEADERS = /* @__PURE__ */ new Set([
  HEADERS.gatewayCache,
  HEADERS.rateLimitLimit,
  HEADERS.rateLimitRemaining,
  HEADERS.rateLimitReset,
  "x-gateway"
]);
function requestForbidsCache(req) {
  const cc = getHeaderString(req, HEADERS.cacheControl)?.toLowerCase() ?? "";
  return cc.includes("no-store") || cc.includes("private");
}
async function readRequestBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk;
    size += buf.length;
    if (size > limit) throw new PayloadTooLargeError(limit);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
function responseForbidsCache(headers) {
  const value = headers[HEADERS.cacheControl];
  const cc = (Array.isArray(value) ? value.join(",") : value ?? "").toLowerCase();
  return cc.includes("no-store") || cc.includes("private");
}
function storableHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === void 0 || HOP_BY_HOP2.has(lower) || CACHE_EXCLUDED_HEADERS.has(lower)) continue;
    out[lower] = value;
  }
  return out;
}
function createGateway(config) {
  const configuredRoutes = assembleRoutes({
    routes: config.routes,
    dirRoutes: config.routesDir ? loadRoutesDirSync(config.routesDir) : void 0,
    target: config.target,
    rateLimit: config.rateLimit,
    circuitBreaker: config.circuitBreaker,
    cache: config.cache,
    basePrefix: config.basePrefix,
    autoRoutes: config.autoRoutes
  });
  if (configuredRoutes.length === 0 && config.healthPath === void 0 && config.probes?.livenessPath === void 0 && config.probes?.readinessPath === void 0 && config.metricsPath === void 0) {
    throw new Error(
      "[gateway] empty route table \u2014 provide `routes`, `target`, `routesDir`, or `autoRoutes` (or a health/metrics path)."
    );
  }
  assertNoMetadataUpstreams(
    configuredRoutes.flatMap((r) => r.upstreams.map((u) => u.url)),
    config.allowMetadataUpstreams === true
  );
  if (config.cors) assertValidCors(config.cors);
  if (config.upstreamSigning !== void 0 && config.upstreamSigning.secret.length === 0) {
    throw new Error("[gateway] upstreamSigning.secret must not be empty.");
  }
  const metrics = new MetricsCollector();
  const metricsPathKey = config.metricsPath !== void 0 ? String(config.metricsPath) : void 0;
  const metricsPathCovered = (table) => {
    if (metricsPathKey === void 0) return true;
    return table.some((r) => {
      const p = String(r.prefix);
      return p === "/" || metricsPathKey === p || metricsPathKey.startsWith(`${p}/`);
    });
  };
  const withMetricsRoute = (table) => {
    if (metricsPathKey === void 0 || metricsPathCovered(table)) {
      return [...table];
    }
    return [
      ...table,
      {
        prefix: config.metricsPath,
        // Never contacted — the pipeline serves metrics before proxying.
        upstreams: [{ url: "http://127.0.0.1:9" }]
      }
    ];
  };
  let routeTable = withMetricsRoute(configuredRoutes);
  let router = new Router(routeTable);
  const globalStripHeaders = new Set(
    (config.stripHeaders ?? []).map((h) => h.toLowerCase())
  );
  const preparedRoutes = /* @__PURE__ */ new Map();
  const buildPreparedRoutes = (table) => {
    preparedRoutes.clear();
    for (const route2 of table) {
      const stripHeaders = new Set(globalStripHeaders);
      for (const h of route2.stripHeaders ?? []) stripHeaders.add(h.toLowerCase());
      const prep = { stripHeaders };
      if (route2.allowedContentTypes !== void 0) {
        prep.contentTypes = new Set(
          route2.allowedContentTypes.map((c) => c.toLowerCase())
        );
      }
      const varyHeaders = route2.cache?.varyHeaders;
      if (varyHeaders !== void 0 && varyHeaders.length > 0) {
        prep.varyHeaders = varyHeaders.map((h) => h.toLowerCase());
      }
      preparedRoutes.set(route2, prep);
    }
  };
  buildPreparedRoutes(routeTable);
  const limiter = new RedisRateLimiter(config.limiter);
  const securityStore = config.limiter?.redis ?? new InMemoryRedis();
  const bruteForceGuard = config.bruteForce ? new BruteForceGuard(securityStore, config.bruteForce) : void 0;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULTS.perimeter.maxBodyBytes;
  const plugins = config.plugins ?? [];
  const loadBalancer = new LoadBalancer();
  const shedder = config.loadShedding?.enabled === true ? new LoadShedder({
    ...config.loadShedding.maxEventLoopDelayMs !== void 0 ? { maxEventLoopDelayMs: config.loadShedding.maxEventLoopDelayMs } : {},
    ...config.loadShedding.maxConcurrentRequests !== void 0 ? { maxConcurrentRequests: config.loadShedding.maxConcurrentRequests } : {}
  }) : void 0;
  shedder?.start();
  const emitSecurity = (type, detail, clientIp, path2) => {
    if (!config.onSecurityEvent) return;
    const event = {
      type,
      timestampMs: Date.now(),
      ...clientIp !== void 0 ? { clientIp } : {},
      ...path2 !== void 0 ? { path: path2 } : {},
      ...detail !== void 0 ? { detail } : {}
    };
    try {
      config.onSecurityEvent(event);
    } catch {
    }
  };
  const nodeId = randomUUID4();
  const distributedStore = securityStore;
  const idempotencyManager = new IdempotencyManager(distributedStore, nodeId);
  const coalescer = new RequestCoalescer(distributedStore, { nodeId });
  const circuitBreaker = new CircuitBreaker();
  circuitBreaker.setDistributedStore(distributedStore, nodeId);
  const proxy = new ProxyHandler({
    timeoutMs: config.upstreamTimeoutMs ?? DEFAULTS.proxy.upstreamTimeoutMs,
    maxSockets: config.maxSocketsPerUpstream ?? config.maxSockets ?? DEFAULTS.proxy.maxSockets
  });
  const startedAt = Date.now();
  const caches = /* @__PURE__ */ new WeakMap();
  const cacheFor = (route2, cfg) => {
    let cache = caches.get(route2);
    if (!cache) {
      cache = new ResponseCache(
        cfg.ttlMs,
        cfg.maxEntries ?? DEFAULTS.cache.maxEntries,
        Date.now,
        distributedStore
      );
      caches.set(route2, cache);
    }
    return cache;
  };
  const extractKey = config.extractClientKey ?? extractClientIp;
  let draining = false;
  let activeRequests = 0;
  let drainNotify;
  const activeResponses = /* @__PURE__ */ new Set();
  const activeTunnels = /* @__PURE__ */ new Set();
  function notifyDrained() {
    if (activeRequests === 0) drainNotify?.();
  }
  async function handleRequest(req, res) {
    if (draining) {
      sendErrorJson(
        res,
        STATUS.serviceUnavailable,
        ERROR_CODES.draining,
        "server is draining",
        {
          [HEADERS.connection]: "close",
          [HEADERS.retryAfter]: String(DEFAULTS.shutdown.retryAfterSeconds)
        }
      );
      return;
    }
    if (shedder?.shouldShed()) {
      sendErrorJson(
        res,
        STATUS.serviceUnavailable,
        ERROR_CODES.overloaded,
        "gateway overloaded",
        {
          [HEADERS.retryAfter]: String(DEFAULTS.networking.shedRetryAfterSec)
        }
      );
      return;
    }
    activeRequests += 1;
    shedder?.enter();
    activeResponses.add(res);
    res.on("close", () => activeResponses.delete(res));
    try {
      await pipeline(req, res);
    } catch (err) {
      if (!res.headersSent && !res.writableEnded) {
        sendErrorJson(
          res,
          STATUS.badGateway,
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : "internal error"
        );
      } else {
        res.destroy();
      }
    } finally {
      activeRequests -= 1;
      shedder?.leave();
      activeResponses.delete(res);
      notifyDrained();
    }
  }
  function replayCache(res, entry, status, extraHeaders) {
    res.writeHead(entry.statusCode, {
      ...entry.headers,
      [HEADERS.gatewayCache]: status,
      ...extraHeaders
    });
    res.end(entry.body);
  }
  async function handleLiveness(res) {
    sendJson(res, STATUS.ok, {
      status: "ok",
      uptimeSec: Math.floor((Date.now() - startedAt) / 1e3)
    });
  }
  async function handleReadiness(res) {
    const timeoutMs = config.probes?.readinessTimeoutMs ?? DEFAULTS.probes.readinessTimeoutMs;
    const redisOk = await limiter.ping(timeoutMs);
    let circuitsOk = true;
    for (const route2 of routeTable) {
      for (const u of route2.upstreams) {
        if (await circuitBreaker.stateOfShared(`${route2.prefix}|${u.url}`) === CIRCUIT_STATES.open) {
          circuitsOk = false;
          break;
        }
      }
      if (!circuitsOk) break;
    }
    const ready = redisOk && circuitsOk;
    sendJson(
      res,
      ready ? STATUS.ok : STATUS.serviceUnavailable,
      {
        status: ready ? "ready" : "not_ready",
        checks: {
          redis: redisOk ? "up" : "down",
          circuits: circuitsOk ? "ok" : "degraded"
        }
      }
    );
  }
  async function handleHealth(res) {
    const ok = await limiter.ping(DEFAULTS.probes.readinessTimeoutMs);
    const failClosed = config.limiter?.failMode === "closed";
    const healthy = ok || !failClosed;
    sendJson(res, healthy ? STATUS.ok : STATUS.serviceUnavailable, {
      status: healthy ? "ok" : "unhealthy"
    });
  }
  function applyPerimeterHeaders(req, res) {
    res.setHeader(HEADERS.contentTypeOptions, DEFAULTS.perimeter.nosniff);
    res.setHeader(
      HEADERS.frameOptions,
      config.securityHeaders?.frameOptions ?? DEFAULTS.perimeter.frameOptions
    );
    res.setHeader(HEADERS.referrerPolicy, DEFAULTS.perimeter.referrerPolicy);
    const hsts = config.securityHeaders?.hsts;
    if (hsts) {
      res.setHeader(
        HEADERS.strictTransportSecurity,
        `max-age=${hsts.maxAgeSec}${hsts.includeSubDomains ? "; includeSubDomains" : ""}`
      );
    }
    const cors = config.cors;
    if (cors) {
      const origin = getHeaderString(req, HEADERS.origin);
      if (isOriginAllowed(cors, origin)) {
        for (const [k, v] of Object.entries(buildCorsHeaders(cors, origin))) {
          res.setHeader(k, v);
        }
      }
    }
  }
  async function pipeline(req, res) {
    const started = performance.now();
    const ctx = await pipelineInner(req, res);
    if (ctx) {
      metrics.recordRequest(ctx.route.prefix, performance.now() - started);
    }
    if (ctx && plugins.length > 0) {
      const durationMs = performance.now() - started;
      for (const plugin of plugins) {
        try {
          await plugin.onResponse?.({ ...ctx, durationMs }, res.statusCode, durationMs);
        } catch {
        }
      }
    }
  }
  async function pipelineInner(req, res) {
    const pathname = pathnameOf(req.url);
    const clientIp = extractClientIp(req);
    if (isPathTraversal(pathname)) {
      emitSecurity(SECURITY_EVENT_TYPES.pathTraversalBlocked, pathname, clientIp, pathname);
      sendErrorJson(res, 400, ERROR_CODES.pathTraversalBlocked, "malformed request path");
      return void 0;
    }
    applyPerimeterHeaders(req, res);
    if (bruteForceGuard) {
      const lockedSecs = await bruteForceGuard.lockedFor(clientIp);
      if (lockedSecs !== null) {
        emitSecurity(
          SECURITY_EVENT_TYPES.bruteForceLocked,
          `locked for ${lockedSecs}s`,
          clientIp,
          pathname
        );
        sendErrorJson(
          res,
          STATUS.locked,
          ERROR_CODES.locked,
          "too many failed authentication attempts",
          { [HEADERS.retryAfter]: String(lockedSecs) }
        );
        return void 0;
      }
    }
    if (config.cors && isPreflight(req)) {
      res.writeHead(STATUS.noContent);
      res.end();
      return void 0;
    }
    if (config.probes?.livenessPath && pathname === String(config.probes.livenessPath)) {
      await handleLiveness(res);
      return void 0;
    }
    if (config.probes?.readinessPath && pathname === String(config.probes.readinessPath)) {
      await handleReadiness(res);
      return void 0;
    }
    if (config.healthPath && pathname === String(config.healthPath)) {
      await handleHealth(res);
      return void 0;
    }
    const resolved = router.resolve(req);
    if (!resolved) {
      sendErrorJson(res, 404, ERROR_CODES.noRoute, "no matching route");
      return void 0;
    }
    const { route: route2, strippedPath } = resolved;
    const prep = preparedRoutes.get(route2);
    if (prep?.contentTypes !== void 0 && !contentTypeAllowed(req, prep.contentTypes)) {
      sendErrorJson(
        res,
        STATUS.unsupportedMediaType,
        ERROR_CODES.unsupportedMediaType,
        "unsupported content type"
      );
      return void 0;
    }
    const denyGuard = async (statusCode, code, message, extraHeaders) => {
      if (bruteForceGuard) await bruteForceGuard.recordFailure(clientIp);
      emitSecurity(SECURITY_EVENT_TYPES.authDenied, message, clientIp, pathname);
      sendErrorJson(res, statusCode, code, message, extraHeaders);
      return void 0;
    };
    const extractor = resolveExtractor(route2, extractKey);
    const clientKey = await extractor(req);
    const guardHeaders = {};
    const guardTags = {};
    const prepStrip = prep?.stripHeaders;
    const allGuards = [...config.guards ?? [], ...route2.guards ?? []];
    if (allGuards.length > 0) {
      const edgeCtx = {
        req,
        method: req.method ?? "GET",
        path: pathname,
        url: req.url,
        routePrefix: String(route2.prefix),
        clientKey,
        clientIp,
        tags: guardTags,
        headers: guardHeaders
      };
      for (const guard of allGuards) {
        const decision = await guard.evaluate(edgeCtx);
        if (decision.action === "deny") {
          return denyGuard(
            decision.status,
            decision.code,
            decision.message,
            decision.headers
          );
        }
        if (decision.headers) Object.assign(guardHeaders, decision.headers);
        if (decision.tags) Object.assign(guardTags, decision.tags);
      }
      if (bruteForceGuard) await bruteForceGuard.recordSuccess(clientIp);
    }
    const hasGuardContext = Object.keys(guardTags).length > 0 || Object.keys(guardHeaders).length > 0;
    const strategy = route2.upstreamStrategy ?? (route2.upstreams.length > 1 ? "p2c" : "weighted-rr");
    const upstream = strategy === "p2c" ? loadBalancer.selectP2C(route2.upstreams) : router.nextUpstream(route2.prefix, route2.upstreams);
    const queryIndex = req.url?.indexOf("?") ?? -1;
    const query = queryIndex === -1 ? "" : req.url.slice(queryIndex);
    const forwardPathname = route2.stripPrefix === false ? pathname : strippedPath;
    const path2 = `${forwardPathname}${query}`;
    const ctx = {
      req,
      res,
      route: route2,
      upstream,
      clientKey,
      tags: guardTags,
      upstreamPath: forwardPathname,
      upstreamUrl: `${upstream.url}${path2}`
    };
    for (const plugin of plugins) {
      const decision = await plugin.onRequest?.(ctx);
      if (decision?.action === "deny") {
        emitSecurity(
          SECURITY_EVENT_TYPES.policyDenied,
          `${plugin.name}: ${decision.message ?? "denied"}`,
          clientIp,
          pathname
        );
        sendErrorJson(
          res,
          decision.statusCode ?? STATUS.forbidden,
          decision.code ?? ERROR_CODES.policyDenied,
          decision.message ?? "request denied by policy"
        );
        return ctx;
      }
    }
    const early = await config.hooks?.onRequest?.(ctx);
    if (isGatewayResponse(early)) {
      sendGatewayResponse(res, early);
      return ctx;
    }
    const effectiveRateLimit = route2.rateLimit;
    let rateHeaders;
    if (effectiveRateLimit) {
      const result = await limiter.consume(
        `${route2.prefix}:${clientKey}`,
        effectiveRateLimit
      );
      rateHeaders = {
        [HEADERS.rateLimitLimit]: String(result.limit),
        [HEADERS.rateLimitRemaining]: String(result.remaining),
        [HEADERS.rateLimitReset]: String(result.resetAt),
        ...result.source !== void 0 ? { [HEADERS.rateLimitSource]: result.source } : {}
      };
      if (!result.allowed) {
        metrics.recordOutcome(route2.prefix, "rate_limited");
        await config.hooks?.onRateLimited?.(ctx, result);
        sendErrorJson(
          res,
          STATUS.tooManyRequests,
          ERROR_CODES.rateLimited,
          "rate limit exceeded",
          {
            ...rateHeaders,
            [HEADERS.retryAfter]: String(secondsUntil(result.resetAt, Date.now()))
          }
        );
        return ctx;
      }
    }
    const authorized = await config.hooks?.onAuthorized?.(ctx);
    if (isGatewayResponse(authorized)) {
      sendGatewayResponse(res, { ...authorized, headers: { ...rateHeaders, ...authorized.headers } });
      return ctx;
    }
    if (metricsPathKey !== void 0 && pathname === metricsPathKey) {
      const accept = getHeaderString(req, "accept") ?? "";
      if (accept.includes("application/json")) {
        sendJson(res, STATUS.ok, metrics.snapshot());
      } else {
        const body = metrics.prometheus();
        res.writeHead(STATUS.ok, {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "content-length": String(Buffer.byteLength(body))
        });
        res.end(body);
      }
      return ctx;
    }
    const method = req.method ?? "GET";
    const idemCfg = route2.idempotency;
    const idemKey = getHeaderString(req, HEADERS.idempotencyKey);
    const idemApplies = idemCfg?.enabled === true && idemKey !== null && (idemCfg.methods ?? DEFAULTS.resilience.idempotencyMethods).includes(method);
    let idemBody;
    let idemComplete;
    let idemAbort;
    if (idemApplies && idemKey) {
      try {
        idemBody = await readRequestBody(req, maxBodyBytes);
      } catch {
        sendErrorJson(
          res,
          STATUS.payloadTooLarge,
          ERROR_CODES.payloadTooLarge,
          "request body too large",
          rateHeaders
        );
        return ctx;
      }
      const tagScope = Object.keys(guardTags).sort().map((k) => `${k}=${guardTags[k] ?? ""}`).join("&");
      const scope = `${clientKey}|${String(route2.prefix)}|${tagScope}`;
      const fingerprint = idempotencyManager.fingerprint(method, req.url ?? pathname, idemBody);
      const begin = await idempotencyManager.begin(scope, idemKey, fingerprint, {
        ttlMs: idemCfg?.ttlMs ?? DEFAULTS.resilience.idempotencyTtlMs,
        lockTimeoutMs: idemCfg?.lockTimeoutMs ?? DEFAULTS.resilience.idempotencyLockTimeoutMs
      });
      if (begin.action === "replay") {
        res.writeHead(begin.statusCode, {
          ...begin.headers,
          [HEADERS.idempotentReplay]: "true"
        });
        res.end(begin.body);
        return ctx;
      }
      if (begin.action === "conflict") {
        sendErrorJson(
          res,
          STATUS.conflict,
          ERROR_CODES.conflict,
          "request with this Idempotency-Key is still in progress",
          { ...rateHeaders, [HEADERS.retryAfter]: "1" }
        );
        return ctx;
      }
      if (begin.action === "fingerprint-mismatch") {
        sendErrorJson(
          res,
          STATUS.unprocessableEntity,
          ERROR_CODES.idempotencyMismatch,
          "Idempotency-Key was already used with a different request payload",
          rateHeaders
        );
        return ctx;
      }
      idemComplete = begin.complete;
      idemAbort = begin.abort;
    }
    const breakerKey = `${route2.prefix}|${upstream.url}`;
    if (route2.circuitBreaker) {
      circuitBreaker.configure(breakerKey, route2.circuitBreaker);
    }
    const cacheCfg = route2.cache;
    const cacheable = cacheCfg !== void 0 && (method === "GET" || method === "HEAD");
    const useCache = cacheable && !requestForbidsCache(req) && (!hasGuardContext || cacheCfg?.allowContextual === true);
    let cache;
    let cacheKey;
    if (useCache && cacheCfg) {
      cache = cacheFor(route2, cacheCfg);
      let keySuffix = "";
      for (const tagKey of cacheCfg.varyTags ?? []) {
        const v = guardTags[tagKey];
        if (v !== void 0) keySuffix += `|t:${tagKey}=${v}`;
      }
      for (const headerName of prep?.varyHeaders ?? []) {
        const raw = req.headers[headerName];
        const v = Array.isArray(raw) ? raw[0] : raw;
        if (v !== void 0) keySuffix += `|h:${headerName}=${v}`;
      }
      if (cacheCfg.allowContextual === true) {
        for (const k of Object.keys(guardTags).sort()) {
          keySuffix += `|t:${k}=${guardTags[k] ?? ""}`;
        }
        for (const k of Object.keys(guardHeaders).sort()) {
          keySuffix += `|g:${k}=${guardHeaders[k] ?? ""}`;
        }
      }
      cacheKey = `${method} ${ctx.upstreamUrl}${keySuffix}`;
      const { fresh, stale } = await cache.lookupShared(cacheKey);
      if (fresh) {
        metrics.recordOutcome(route2.prefix, "cache_hit");
        replayCache(res, fresh, CACHE_STATUS.hit);
        return ctx;
      }
      if (stale && cacheCfg.serveStaleOnCircuitOpen && await circuitBreaker.stateOfShared(breakerKey) === CIRCUIT_STATES.open) {
        metrics.recordOutcome(route2.prefix, "cache_hit");
        replayCache(res, stale, CACHE_STATUS.stale);
        return ctx;
      }
    }
    if (!await circuitBreaker.canExecuteShared(breakerKey)) {
      metrics.recordOutcome(route2.prefix, "circuit_open");
      await config.hooks?.onCircuitOpen?.(ctx);
      sendErrorJson(
        res,
        STATUS.serviceUnavailable,
        ERROR_CODES.circuitOpen,
        "upstream circuit is open",
        rateHeaders
      );
      return ctx;
    }
    const responseHeaders = {
      ...rateHeaders,
      ...cacheable ? { [HEADERS.gatewayCache]: CACHE_STATUS.miss } : {}
    };
    const hedgeCfg = route2.hedging;
    const hedgeIdempotent = method === "GET" || method === "HEAD" || method === "OPTIONS" || getHeaderString(req, HEADERS.idempotencyKey) !== null;
    const hedgeApplies = hedgeCfg?.enabled === true && hedgeIdempotent && route2.upstreams.length > 1;
    const forwardTarget = (u) => ({
      upstream: u,
      path: path2,
      responseHeaders: Object.keys(responseHeaders).length ? responseHeaders : void 0,
      guardHeaders: Object.keys(guardHeaders).length > 0 ? guardHeaders : void 0,
      stripHeaders: prepStrip !== void 0 && prepStrip.size > 0 ? prepStrip : void 0,
      ...idemBody !== void 0 ? { bodyOverride: idemBody } : {},
      ...config.upstreamSigning !== void 0 ? {
        signing: {
          secret: config.upstreamSigning.secret,
          subject: config.upstreamSigning.subjectTag !== void 0 ? guardTags[config.upstreamSigning.subjectTag] ?? "" : "",
          subjectHeader: config.upstreamSigning.subjectHeader ?? HEADERS.gatewaySubject,
          ...config.upstreamSigning.headerName !== void 0 ? { headerName: config.upstreamSigning.headerName } : {},
          ...config.upstreamSigning.timestampHeader !== void 0 ? { timestampHeader: config.upstreamSigning.timestampHeader } : {}
        }
      } : {}
    });
    const fetchOnce = async (u, signal) => {
      const t0 = performance.now();
      loadBalancer.enter(u.url);
      try {
        const info = await proxy.forward(
          req,
          res,
          forwardTarget(u),
          {
            captureBody: useCache || idemComplete !== void 0,
            maxBodyBytes,
            maskErrors: config.maskUpstreamErrors === true,
            ...signal !== void 0 ? { signal } : {}
          }
        );
        return { info, used: u };
      } finally {
        loadBalancer.leave(u.url, performance.now() - t0);
      }
    };
    const fetchUpstream = async () => {
      if (!hedgeApplies || hedgeCfg === void 0) {
        return fetchOnce(upstream);
      }
      const ac = new AbortController();
      const maxHedges = hedgeCfg.maxHedges ?? 1;
      const delayMs = hedgeCfg.delayMs;
      const hedgeTimers = /* @__PURE__ */ new Set();
      const clearHedgeTimers = () => {
        for (const t of hedgeTimers) t.clear();
        hedgeTimers.clear();
      };
      const onClientGone = () => {
        if (!res.writableEnded) {
          ac.abort();
          clearHedgeTimers();
        }
      };
      res.once("close", onClientGone);
      const attempts = [fetchOnce(upstream, ac.signal)];
      const tried = /* @__PURE__ */ new Set([upstream.url]);
      for (let i = 0; i < maxHedges; i += 1) {
        const candidates = route2.upstreams.filter((u) => !tried.has(u.url));
        if (candidates.length === 0) break;
        const alt = loadBalancer.selectP2C(candidates);
        tried.add(alt.url);
        attempts.push(
          new Promise((resolve2, reject) => {
            const t = deadlineTimer(delayMs * (i + 1), () => {
              hedgeTimers.delete(t);
              if (ac.signal.aborted) {
                reject(new Error("hedge aborted"));
                return;
              }
              fetchOnce(alt, ac.signal).then(resolve2, reject);
            });
            hedgeTimers.add(t);
          })
        );
      }
      try {
        const winner = await Promise.any(attempts);
        ac.abort();
        clearHedgeTimers();
        return winner;
      } catch (err) {
        ac.abort();
        clearHedgeTimers();
        if (err instanceof AggregateError && err.errors.length > 0) {
          throw err.errors[0];
        }
        throw err;
      } finally {
        res.off("close", onClientGone);
      }
    };
    const performUpstream = async () => {
      try {
        const { info, used } = await fetchUpstream();
        const usedBreakerKey = `${route2.prefix}|${used.url}`;
        await config.hooks?.onUpstreamResponse?.(ctx, info);
        if (idemComplete) {
          if (info.statusCode < 500) {
            await idemComplete({
              statusCode: info.statusCode,
              headers: info.headers,
              body: info.body ?? Buffer.alloc(0)
            });
          } else {
            await idemAbort?.();
          }
        }
        if (info.statusCode >= 500) {
          circuitBreaker.recordFailure(usedBreakerKey);
        } else {
          circuitBreaker.recordSuccess(usedBreakerKey);
        }
        if (cache && cacheKey && info.statusCode === STATUS.ok && info.body !== void 0 && !responseForbidsCache(info.headers)) {
          const entry = {
            statusCode: info.statusCode,
            headers: storableHeaders(info.headers),
            body: info.body,
            storedAt: Date.now()
          };
          await cache.setShared(cacheKey, entry);
          return entry;
        }
        return void 0;
      } catch (err) {
        await idemAbort?.();
        circuitBreaker.recordFailure(breakerKey);
        await config.hooks?.onUpstreamError?.(
          ctx,
          err instanceof Error ? err : new Error(String(err))
        );
        await config.hooks?.onProxyError?.(
          ctx,
          err instanceof Error ? err : new Error(String(err))
        );
        if (res.headersSent || res.writableEnded) {
          res.destroy();
          return void 0;
        }
        if (err instanceof PayloadTooLargeError) {
          sendErrorJson(
            res,
            STATUS.payloadTooLarge,
            ERROR_CODES.payloadTooLarge,
            "request body too large",
            rateHeaders
          );
          return void 0;
        }
        const isTimeout = err instanceof UpstreamTimeoutError;
        metrics.recordOutcome(route2.prefix, "upstream_error");
        sendErrorJson(
          res,
          isTimeout ? STATUS.gatewayTimeout : STATUS.badGateway,
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : "upstream error",
          rateHeaders
        );
        return void 0;
      }
    };
    const coalesceKey = useCache && cacheCfg?.coalesce !== false && cacheKey ? cacheKey : void 0;
    if (coalesceKey !== void 0 && cache !== void 0) {
      const existing = coalescer.get(coalesceKey);
      if (existing !== void 0) {
        const entry = await existing;
        if (entry) {
          metrics.recordOutcome(route2.prefix, "cache_hit");
          replayCache(res, entry, CACHE_STATUS.hit, { [HEADERS.coalesced]: "true" });
        } else {
          await performUpstream();
        }
        return ctx;
      }
      const isLeader = await coalescer.acquireLease(coalesceKey);
      if (!isLeader) {
        const shared = await coalescer.waitForShared(
          coalesceKey,
          () => cache.lookupL2(coalesceKey)
        );
        if (shared) {
          metrics.recordOutcome(route2.prefix, "cache_hit");
          replayCache(res, shared, CACHE_STATUS.hit, { [HEADERS.coalesced]: "true" });
          return ctx;
        }
      }
      const promise = performUpstream();
      coalescer.set(coalesceKey, promise);
      try {
        await promise;
      } finally {
        coalescer.delete(coalesceKey);
        await coalescer.releaseLease(coalesceKey);
      }
      return ctx;
    }
    await performUpstream();
    return ctx;
  }
  const server = http3.createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.on("connection", (socket) => {
    socket.setNoDelay(true);
  });
  server.keepAliveTimeout = DEFAULTS.networking.serverKeepAliveTimeoutMs;
  server.headersTimeout = DEFAULTS.networking.serverHeadersTimeoutMs;
  server.requestTimeout = DEFAULTS.networking.serverRequestTimeoutMs;
  const denyUpgrade = (socket, status, reason, code, message) => {
    const body = JSON.stringify(defaultErrorBody(code, message));
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r
content-type: application/json\r
content-length: ${Buffer.byteLength(body)}\r
connection: close\r
\r
` + body
    );
    socket.destroy();
  };
  async function handleUpgrade(req, socket, head) {
    try {
      if (draining) {
        denyUpgrade(socket, 503, "Service Unavailable", ERROR_CODES.draining, "server is draining");
        return;
      }
      const upgradeReq = req;
      const resolved = router.resolve(upgradeReq);
      if (!resolved) {
        denyUpgrade(socket, 404, "Not Found", ERROR_CODES.noRoute, "no matching route");
        return;
      }
      const { route: route2, strippedPath } = resolved;
      const extractor = resolveExtractor(route2, extractKey);
      const clientKey = await extractor(upgradeReq);
      const clientIp = socket.remoteAddress ?? "";
      const guardHeaders = {};
      const guardTags = {};
      const prepStrip = preparedRoutes.get(route2)?.stripHeaders;
      const allGuards = [...config.guards ?? [], ...route2.guards ?? []];
      if (allGuards.length > 0) {
        const edgeCtx = {
          req: upgradeReq,
          method: req.method ?? "GET",
          path: pathnameOf(req.url),
          url: req.url,
          routePrefix: String(route2.prefix),
          clientKey,
          clientIp,
          tags: guardTags,
          headers: guardHeaders
        };
        for (const guard of allGuards) {
          const decision = await guard.evaluate(edgeCtx);
          if (decision.action === "deny") {
            const reason = decision.status === 401 ? "Unauthorized" : decision.status === 403 ? "Forbidden" : decision.status === 429 ? "Too Many Requests" : "Denied";
            denyUpgrade(socket, decision.status, reason, decision.code, decision.message);
            return;
          }
          if (decision.headers) Object.assign(guardHeaders, decision.headers);
          if (decision.tags) Object.assign(guardTags, decision.tags);
        }
      }
      if (route2.rateLimit) {
        const result = await limiter.consume(`${route2.prefix}:${clientKey}`, route2.rateLimit);
        if (!result.allowed) {
          denyUpgrade(
            socket,
            429,
            "Too Many Requests",
            ERROR_CODES.rateLimited,
            "rate limit exceeded"
          );
          return;
        }
      }
      const queryIndex = req.url?.indexOf("?") ?? -1;
      const query = queryIndex === -1 ? "" : req.url.slice(queryIndex);
      const pathname = pathnameOf(req.url);
      const forwardPathname = route2.stripPrefix === false ? pathname : strippedPath;
      const upstream = (route2.upstreamStrategy ?? (route2.upstreams.length > 1 ? "p2c" : "weighted-rr")) === "p2c" ? loadBalancer.selectP2C(route2.upstreams) : router.nextUpstream(route2.prefix, route2.upstreams);
      loadBalancer.enter(upstream.url);
      try {
        proxyUpgrade(req, socket, head, upstream, {
          path: `${forwardPathname}${query}`,
          guardHeaders: Object.keys(guardHeaders).length > 0 ? guardHeaders : void 0,
          stripHeaders: prepStrip !== void 0 && prepStrip.size > 0 ? prepStrip : void 0,
          ...config.upgradeHandshakeTimeoutMs !== void 0 ? { handshakeTimeoutMs: config.upgradeHandshakeTimeoutMs } : {}
        });
      } finally {
        loadBalancer.leave(upstream.url, 0);
      }
    } catch {
      socket.destroy();
    }
  }
  server.on("upgrade", (req, socket, head) => {
    activeTunnels.add(socket);
    socket.once("close", () => activeTunnels.delete(socket));
    void handleUpgrade(req, socket, head);
  });
  function listen(port = config.port ?? DEFAULTS.port, host = config.host ?? DEFAULTS.host) {
    return new Promise((resolve2, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve2();
      });
    });
  }
  async function shutdown(options) {
    draining = true;
    shedder?.stop();
    for (const tunnel of activeTunnels) {
      destroySafely(tunnel);
    }
    activeTunnels.clear();
    for (const res of activeResponses) {
      res.shouldKeepAlive = false;
    }
    const timeoutMs = options?.drainTimeoutMs ?? DEFAULTS.shutdown.drainTimeoutMs;
    if (activeRequests > 0) {
      await Promise.race([
        new Promise((resolve2) => {
          drainNotify = () => {
            if (activeRequests === 0) resolve2();
          };
          if (activeRequests === 0) resolve2();
        }),
        new Promise((resolve2) => {
          const t = setTimeout(resolve2, timeoutMs);
          t.unref?.();
        })
      ]);
    }
    drainNotify = void 0;
    if (server.listening) {
      const closed = new Promise((resolve2) => {
        server.close(() => resolve2());
      });
      server.closeIdleConnections();
      await closed;
    }
    await proxy.close();
  }
  return {
    server,
    handleRequest,
    get router() {
      return router;
    },
    limiter,
    circuitBreaker,
    metrics,
    reloadRoutes(next) {
      const normalized = isRouteReloadConfig(next) ? assembleRoutes({
        routes: next.routes,
        target: next.target ?? config.target,
        rateLimit: next.rateLimit ?? config.rateLimit,
        circuitBreaker: next.circuitBreaker ?? config.circuitBreaker,
        cache: next.cache ?? config.cache,
        autoRoutes: next.autoRoutes ?? config.autoRoutes,
        basePrefix: config.basePrefix
      }) : assembleRoutes({
        // Guard returned false → `next` is RoutesInput, not options.
        routes: next,
        basePrefix: config.basePrefix
      });
      if (normalized.length === 0) {
        throw new Error(
          "[gateway] reloadRoutes produced an empty route table \u2014 refusing to drop all routes."
        );
      }
      assertNoMetadataUpstreams(
        normalized.flatMap((r) => r.upstreams.map((u) => u.url)),
        config.allowMetadataUpstreams === true
      );
      routeTable = withMetricsRoute(normalized);
      router = new Router(routeTable);
      buildPreparedRoutes(routeTable);
    },
    listen,
    listenCluster(portOrOptions, workerCount) {
      const options = {
        ...typeof portOrOptions === "object" ? portOrOptions : {},
        ...workerCount !== void 0 ? { workers: workerCount } : {}
      };
      return listenCluster(
        { listen, shutdown, close: () => shutdown() },
        options
      );
    },
    poolMetrics() {
      const sockets = proxy.poolMetrics();
      const out = {};
      const seen = /* @__PURE__ */ new Set();
      for (const route2 of routeTable) {
        for (const u of route2.upstreams) {
          if (seen.has(u.url)) continue;
          seen.add(u.url);
          try {
            const origin = new URL(u.url).origin;
            const s = sockets[origin] ?? {
              activeSockets: 0,
              freeSockets: 0,
              queuedRequests: 0
            };
            out[u.url] = {
              ...s,
              inFlight: loadBalancer.statsOf(u.url).inFlight
            };
          } catch {
            out[u.url] = {
              activeSockets: 0,
              freeSockets: 0,
              queuedRequests: 0,
              inFlight: loadBalancer.statsOf(u.url).inFlight
            };
          }
        }
      }
      return out;
    },
    shutdown,
    close() {
      return shutdown();
    }
  };
}

// src/cli.ts
var USAGE = `udinmo-gateway \xE2\u20AC\u201D zero-code gateway CLI

Commands:
  start --port <port> --target <upstreamUrl> [--limit <rate>]
      Launch a live gateway immediately (no config file).
      --limit accepts '60/sec' | '120/min' | '1000/hour'.
  init
      Write a commented gateway.config.mjs starter to the cwd.
  doctor --config <path>
      Validate route configs, check SSRF safety, ping upstreams.
`;
var CONFIG_TEMPLATE = `// udinmo-gateway configuration
// Docs: https://github.com/udinmoInc/gateway
import { createGateway, route, group, asProtection } from '@udinmoinc/gateway';

export const routes = [
  // Public API \xE2\u20AC\u201D 120 requests/minute per client IP, 30s response cache.
  route('/api/*', 'http://localhost:3000', {
    rateLimit: '120/min',
    cache: '30s',
  }),

  // Admin API \xE2\u20AC\u201D guarded by your own EdgeGuard/provider.
  // group('/admin', { guards: [asProtection(yourAuthProvider)] }, [
  //   route('/users', 'http://localhost:4001'),
  // ]),
];

export async function main() {
  const gateway = createGateway({
    routes,
    // stripHeaders: ['x-internal-debug'],
    // cors: { origins: ['https://app.example.com'] },
    // metricsPath: '/gateway/metrics',
    // upstreamSigning: { secret: process.env.GW_SIGNING_SECRET },
  });

  const port = Number(process.env.PORT ?? 8080);
  await gateway.listen(port);
  console.log(\`[gateway] listening on :\${port}\`);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void gateway.shutdown().then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('[gateway] fatal:', err);
  process.exit(1);
});
`;
function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const spec = command === "start" ? {
    options: {
      port: { type: "string" },
      target: { type: "string" },
      limit: { type: "string" },
      host: { type: "string" }
    }
  } : command === "doctor" ? {
    options: {
      config: { type: "string" }
    }
  } : { options: {} };
  const { values, positionals } = parseArgs({
    args: rest,
    options: spec.options,
    allowPositionals: true,
    strict: true
  });
  return { values, positionals };
}
function str(values, key) {
  const v = values[key];
  return typeof v === "string" ? v : void 0;
}
async function cmdStart(values) {
  const portRaw = str(values, "port");
  const target = str(values, "target");
  if (!portRaw || !target) {
    console.error("start requires --port <port> and --target <upstreamUrl>");
    process.exitCode = 1;
    return;
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[gateway] invalid --port "${portRaw}"`);
    process.exitCode = 1;
    return;
  }
  if (!/^https?:\/\/\S+$/.test(target)) {
    console.error(`[gateway] invalid --target "${target}" \xE2\u20AC\u201D must be http(s):// URL`);
    process.exitCode = 1;
    return;
  }
  const limitRaw = str(values, "limit");
  const rateLimit = limitRaw !== void 0 ? parseRateLimit(limitRaw) : void 0;
  const host = str(values, "host") ?? "0.0.0.0";
  const gateway = createGateway({
    target,
    ...rateLimit !== void 0 ? { rateLimit } : {}
  });
  await gateway.listen(port, host);
  console.log(`[gateway] listening on http://${host}:${port} \xE2\u2020\u2019 ${target}`);
  if (rateLimit) {
    console.log(`[gateway] rate limit: ${rateLimit.capacity} burst, ${rateLimit.refillPerSecond}/s refill`);
  }
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      void gateway.shutdown().then(() => process.exit(0));
    });
  }
}
async function cmdInit(dir = process.cwd()) {
  const target = resolve(dir, "gateway.config.mjs");
  await writeFile(target, CONFIG_TEMPLATE, "utf8");
  console.log(`[gateway] wrote ${target}`);
  console.log("[gateway] run it with: node gateway.config.mjs");
}
async function cmdDoctor(configPath) {
  if (!configPath) {
    console.error("doctor requires --config <path>");
    process.exitCode = 1;
    return;
  }
  const abs = resolve(process.cwd(), configPath);
  let mod;
  try {
    mod = await import(pathToFileURL2(abs).href);
  } catch (err) {
    console.error(`[gateway] cannot load ${abs}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }
  let routes;
  try {
    const rawRoutes = mod.routes ?? mod.default?.routes;
    const normalized = normalizeRoutes(rawRoutes);
    if (normalized === void 0 || normalized.length === 0) {
      throw new Error("empty");
    }
    routes = normalized;
  } catch {
    console.error("[gateway] config must export a non-empty `routes` array or map");
    process.exitCode = 1;
    return;
  }
  let failures = 0;
  const upstreams = /* @__PURE__ */ new Set();
  for (const [i, route2] of routes.entries()) {
    const label = `route[${i}] prefix=${String(route2?.prefix)}`;
    if (typeof route2?.prefix !== "string" || !route2.prefix.startsWith("/")) {
      console.error(`  FAIL ${label}: prefix must start with '/'`);
      failures += 1;
      continue;
    }
    const ups = route2.upstreams;
    if (!Array.isArray(ups) || ups.length === 0) {
      console.error(`  FAIL ${label}: at least one upstream required`);
      failures += 1;
      continue;
    }
    for (const u of ups) {
      if (typeof u?.url !== "string" || !/^https?:\/\/\S+$/.test(u.url)) {
        console.error(`  FAIL ${label}: invalid upstream "${String(u?.url)}"`);
        failures += 1;
        continue;
      }
      upstreams.add(u.url);
      try {
        new URL(u.url);
      } catch {
        console.error(`  FAIL ${label}: unparseable upstream "${u.url}"`);
        failures += 1;
      }
    }
    console.log(`  ok   ${label} \xE2\u2020\u2019 ${ups.map((u) => u.url).join(", ")}`);
  }
  try {
    assertNoMetadataUpstreams(
      routes.flatMap((r) => (r.upstreams ?? []).map((u) => u.url)),
      false
    );
    console.log("  ok   SSRF metadata-upstream check passed");
  } catch (err) {
    console.error(`  FAIL SSRF check: ${err instanceof Error ? err.message : err}`);
    failures += 1;
  }
  for (const url of upstreams) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(2e3)
      });
      console.log(`  ok   upstream ${url} \xE2\u2020\u2019 HTTP ${res.status} (${Date.now() - t0}ms)`);
      await res.arrayBuffer().catch(() => void 0);
    } catch (err) {
      console.error(`  FAIL upstream ${url} unreachable: ${err instanceof Error ? err.message : err}`);
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`[gateway] doctor found ${failures} problem(s)`);
    process.exitCode = 1;
  } else {
    console.log("[gateway] doctor: all checks passed");
  }
}
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  const { values } = parseCliArgs([command, ...rest]);
  switch (command) {
    case "start":
      await cmdStart(values);
      return;
    case "init":
      await cmdInit();
      return;
    case "doctor":
      await cmdDoctor(str(values, "config"));
      return;
    default:
      console.error(`[gateway] unknown command "${command}"
`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
var invokedAs = process.argv[1];
var isMain = invokedAs !== void 0 && import.meta.url === pathToFileURL2(resolve(invokedAs)).href;
if (isMain) {
  main().catch((err) => {
    console.error("[gateway] fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
export {
  cmdDoctor,
  cmdInit,
  cmdStart,
  main,
  parseCliArgs
};
//# sourceMappingURL=cli.mjs.map