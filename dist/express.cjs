"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/adapters/express.ts
var express_exports = {};
__export(express_exports, {
  createGateway: () => createGateway,
  gatewayMiddleware: () => gatewayMiddleware
});
module.exports = __toCommonJS(express_exports);

// src/core/GatewayEngine.ts
var import_node_http2 = __toESM(require("http"), 1);
var import_node_perf_hooks = require("perf_hooks");

// src/constants.ts
var HEADERS = {
  forwardedFor: "x-forwarded-for",
  forwardedProto: "x-forwarded-proto",
  realIp: "x-real-ip",
  rateLimitLimit: "x-ratelimit-limit",
  rateLimitRemaining: "x-ratelimit-remaining",
  rateLimitReset: "x-ratelimit-reset",
  retryAfter: "retry-after",
  apiKey: "x-api-key",
  authorization: "authorization",
  gatewayCache: "x-gateway-cache",
  cacheControl: "cache-control",
  connection: "connection",
  userId: "x-user-id",
  userRole: "x-user-role",
  requestId: "x-request-id",
  wwwAuthenticate: "www-authenticate",
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
  apiKeyHeader: "x-api-key"
};
var IDENTITY_HEADERS = [
  "x-user-id",
  "x-user-role",
  "x-session-id"
];
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
  locked: 423
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
  apiKeyInvalid: "API_KEY_INVALID",
  locked: "LOCKED"
};
var SECURITY_EVENT_TYPES = {
  pathTraversalBlocked: "PATH_TRAVERSAL_BLOCKED",
  bruteForceLocked: "BRUTE_FORCE_LOCKED",
  authDenied: "AUTH_DENIED",
  apiKeyDenied: "API_KEY_DENIED",
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
    apiKeyHashPrefix: "sha256:",
    bruteForceKeyPrefix: "gw:bf:",
    upstreamFingerprintHeaders: ["x-powered-by", "server"]
  },
  auth: {
    jwtLeewaySec: 30,
    jwksCacheTtlMs: 3e5,
    authCacheKeyPrefix: "gw:auth:"
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

// src/utils/extractors.ts
function getHeaderString(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (value === void 0) return void 0;
  return Array.isArray(value) ? value[0] : value;
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
  buckets = /* @__PURE__ */ new Map();
  maxKeys;
  constructor(maxKeys = DEFAULTS.limiter.localMaxKeys) {
    this.maxKeys = maxKeys;
  }
  consume(key, rule, now = Date.now()) {
    let bucket = this.buckets.get(key);
    if (bucket === void 0) {
      this.evictIfNeeded();
      bucket = { tokens: rule.capacity, ts: now };
      this.buckets.set(key, bucket);
    } else {
      this.buckets.delete(key);
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
  evictIfNeeded() {
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }
  }
};

// src/limiter/scripts.ts
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

// src/limiter/RedisRateLimiter.ts
var DEFAULT_TIMEOUT_MS = 500;
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("redis timeout")), ms);
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}
var RedisRateLimiter = class {
  redis;
  failMode;
  keyPrefix;
  timeoutMs;
  local;
  warnedNoRedis = false;
  constructor(options = {}) {
    this.redis = options.redis;
    this.failMode = options.failMode ?? FAIL_MODES.fallback;
    this.keyPrefix = options.keyPrefix ?? DEFAULTS.redisPrefix;
    this.timeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.local = new LocalFallback(options.localMaxKeys);
    if (!this.redis && !this.warnedNoRedis) {
      this.warnedNoRedis = true;
      console.warn(
        "[gateway] No Redis client configured \u2014 using in-memory rate limiting. Limits are per-process, not distributed."
      );
    }
  }
  async consume(key, rule) {
    if (!this.redis) {
      return this.local.consume(key, rule);
    }
    const redisKey = `${this.keyPrefix}:${key}`;
    try {
      const raw = await withTimeout(
        this.redis.eval(
          TOKEN_BUCKET_SCRIPT,
          1,
          redisKey,
          rule.capacity,
          rule.refillPerSecond,
          1
        ),
        this.timeoutMs
      );
      return this.parseResult(raw, rule);
    } catch {
      return this.handleFailure(key, rule);
    }
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
          retryAfterMs: 0
        };
      case FAIL_MODES.closed:
        return {
          allowed: false,
          remaining: 0,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1e3) + 1,
          retryAfterMs: this.timeoutMs
        };
      case FAIL_MODES.fallback:
      default:
        return this.local.consume(key, rule);
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
  buckets = /* @__PURE__ */ new Map();
  kv = /* @__PURE__ */ new Map();
  maxKeys = DEFAULTS.inMemoryRedis.maxKeys;
  async eval(_script, _numKeys, ...args) {
    const key = String(args[0]);
    const capacity = Number(args[1]);
    const refill = Number(args[2]);
    const requested = Number(args[3] ?? 1);
    const now = Date.now() / 1e3;
    let bucket = this.buckets.get(key);
    if (bucket === void 0) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
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
  async ping() {
    return "PONG";
  }
  async get(key) {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== void 0 && entry.expiresAt <= Date.now()) {
      this.kv.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key, value, ...args) {
    let expiresAt;
    for (let i = 0; i < args.length; i += 1) {
      if (String(args[i]).toUpperCase() === "PX") {
        const ms = Number(args[i + 1]);
        if (Number.isFinite(ms)) expiresAt = Date.now() + ms;
        i += 1;
      }
    }
    if (this.kv.size >= this.maxKeys && !this.kv.has(key)) {
      const oldest = this.kv.keys().next();
      if (!oldest.done) this.kv.delete(oldest.value);
    }
    this.kv.set(key, expiresAt === void 0 ? { value } : { value, expiresAt });
    return "OK";
  }
  async del(key) {
    return this.kv.delete(key) ? 1 : 0;
  }
  async incr(key) {
    const current = Number(await this.get(key) ?? "0");
    const next = current + 1;
    const entry = this.kv.get(key);
    const expiresAt = entry?.expiresAt;
    this.kv.set(key, expiresAt === void 0 ? { value: String(next) } : { value: String(next), expiresAt });
    return next;
  }
  async expire(key, seconds) {
    const entry = this.kv.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1e3;
    return 1;
  }
};

// src/cache/ResponseCache.ts
var ResponseCache = class {
  map = /* @__PURE__ */ new Map();
  ttlMs;
  maxEntries;
  now;
  constructor(ttlMs, maxEntries = DEFAULTS.cache.maxEntries, now = Date.now) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }
  lookup(key) {
    const entry = this.map.get(key);
    if (entry === void 0) return {};
    this.map.delete(key);
    this.map.set(key, entry);
    return this.now() - entry.storedAt <= this.ttlMs ? { fresh: entry, stale: entry } : { stale: entry };
  }
  set(key, entry) {
    this.map.delete(key);
    this.map.set(key, { ...entry, storedAt: this.now() });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
  get size() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
};

// src/routing/RouteLoader.ts
var import_node_fs = require("fs");
var import_node_module = require("module");
var import_node_path = __toESM(require("path"), 1);
var import_node_url = require("url");

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
var UPSTREAM_RE = /^https?:\/\/\S+$/;
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
function parseCache(input) {
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
  const list = Array.isArray(to) ? to : [to];
  if (list.length === 0) throw new Error("[gateway] Route requires at least one upstream.");
  const targets = list.map((url) => {
    if (!UPSTREAM_RE.test(url)) {
      throw new Error(`[gateway] Invalid upstream URL "${url}" \u2014 must start with http:// or https://.`);
    }
    return { url };
  });
  return targets;
}
function buildRoute(def) {
  const route2 = {
    prefix: normalizePrefix(def.path),
    upstreams: toTargets(def.to)
  };
  if (def.auth !== void 0) route2.auth = def.auth;
  if (def.rateLimit !== void 0) route2.rateLimit = parseRateLimit(def.rateLimit);
  if (def.cache !== void 0) route2.cache = parseCache(def.cache);
  if (def.stripPrefix !== void 0) route2.stripPrefix = def.stripPrefix;
  if (def.circuitBreaker !== void 0) route2.circuitBreaker = def.circuitBreaker;
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
var UPSTREAM_RE2 = /^https?:\/\/\S+$/;
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
    if (typeof url !== "string" || !UPSTREAM_RE2.test(url)) {
      fail(file, `route "${pathValue}" has invalid upstream "${String(url)}"`);
    }
  }
  const def = { path: pathValue, to };
  const opts = {};
  if (r.auth !== void 0) opts.auth = r.auth;
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
  const require2 = (0, import_node_module.createRequire)((0, import_node_url.pathToFileURL)(process.cwd() + import_node_path.default.sep).href);
  const entries = (0, import_node_fs.readdirSync)(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const unsupported = entries.map((e) => e.name).filter((name) => !SYNC_EXTENSIONS.has(import_node_path.default.extname(name)));
  if (unsupported.length > 0) {
    throw new Error(
      `[gateway] routesDir contains files unsupported by sync loading: ${unsupported.join(", ")}. Use \`await loadRoutesDir(dir)\` for .ts/.mjs route modules.`
    );
  }
  const files = entries.map((e) => import_node_path.default.join(dir, e.name)).sort();
  const loaded = defsFromFiles(files, (file) => require2(file));
  validateUnique(loaded, dir);
  return loaded.map(
    (d) => route(d.path, d.to, d)
  );
}

// src/auth/providers.ts
var import_node_crypto2 = require("crypto");

// src/auth/jwt.ts
var import_node_crypto = require("crypto");
var fromB64url = (input) => Buffer.from(input, "base64url");
function sign(data, secret) {
  return (0, import_node_crypto.createHmac)("sha256", secret).update(data).digest("base64url");
}
function audienceMatches(aud, expected) {
  if (aud === void 0) return false;
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const actualList = Array.isArray(aud) ? aud : [aud];
  return expectedList.some((e) => actualList.includes(e));
}
function verifyJwt(token, secret, options = {}) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  let alg;
  try {
    alg = JSON.parse(fromB64url(header).toString("utf8")).alg;
  } catch {
    return null;
  }
  if (alg !== "HS256") return null;
  const expected = sign(`${header}.${payload}`, secret);
  const sigBuf = fromB64url(signature);
  const expBuf = fromB64url(expected);
  if (sigBuf.length !== expBuf.length || !(0, import_node_crypto.timingSafeEqual)(sigBuf, expBuf)) {
    return null;
  }
  let claims;
  try {
    claims = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    return null;
  }
  const nowSec = (options.now ?? (() => Date.now() / 1e3))();
  const leeway = options.clockToleranceSec ?? DEFAULTS.auth.jwtLeewaySec;
  if (typeof claims.exp === "number" && claims.exp + leeway < nowSec) return null;
  if (typeof claims.nbf === "number" && claims.nbf - leeway > nowSec) return null;
  if (options.issuer !== void 0 && claims.iss !== options.issuer) return null;
  if (options.audience !== void 0 && !audienceMatches(claims.aud, options.audience)) return null;
  return claims;
}

// src/auth/providers.ts
function bearerToken(req) {
  const auth = getHeaderString(req, HEADERS.authorization);
  if (!auth) return null;
  const [scheme, token] = auth.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}
function isRecord(v) {
  return typeof v === "object" && v !== null;
}
function toRoles(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((r) => typeof r === "string");
  }
  return [];
}
function resolveClaim(claims, path2) {
  let current = claims;
  for (const segment of path2.split(".")) {
    if (!isRecord(current)) return void 0;
    current = current[segment];
  }
  return current;
}
function identityFromClaims(claims, options = {}) {
  const userIdPath = options.userIdClaim ?? "sub";
  const rawUserId = resolveClaim(claims, userIdPath);
  const userId = typeof rawUserId === "string" ? rawUserId : typeof claims.userId === "string" ? claims.userId : void 0;
  if (!userId) return null;
  let roles;
  if (options.roleClaim !== void 0) {
    roles = toRoles(resolveClaim(claims, options.roleClaim));
  } else {
    roles = Array.isArray(claims.roles) ? claims.roles.filter((r) => typeof r === "string") : typeof claims.role === "string" ? [claims.role] : [];
  }
  return { userId, roles };
}
function createJwtProvider(config) {
  return {
    name: "jwt-hs256",
    async authenticate(req) {
      const token = bearerToken(req);
      if (!token) return { skip: true };
      const claims = verifyJwt(token, config.secret, {
        ...config.issuer !== void 0 ? { issuer: config.issuer } : {},
        ...config.audience !== void 0 ? { audience: config.audience } : {},
        ...config.clockToleranceSec !== void 0 ? { clockToleranceSec: config.clockToleranceSec } : {}
      });
      if (!claims) {
        return { authenticated: false, reason: "invalid or expired token" };
      }
      const identity = identityFromClaims(claims);
      if (!identity) {
        return { authenticated: false, reason: "token missing user id claim" };
      }
      return { authenticated: true, identity };
    }
  };
}

// src/security/ApiKeyGuard.ts
var import_node_crypto3 = require("crypto");
function hashApiKey(rawKey) {
  return (0, import_node_crypto3.createHash)("sha256").update(rawKey, "utf8").digest("hex");
}
var ApiKeyGuard = class {
  provider;
  headerName;
  constructor(config) {
    this.provider = config.provider;
    this.headerName = config.headerName ?? HEADERS.apiKeyHeader;
  }
  /** Returns the raw key if present on the request. */
  extractKey(req) {
    const value = getHeaderString(req, this.headerName);
    return value && value.length > 0 ? value : void 0;
  }
  /**
   * Authenticate the request's API key against the route's required scopes.
   * Only invoked for routes that declare `requiredScopes`.
   */
  async authenticate(req, route2) {
    const raw = this.extractKey(req);
    if (!raw) return { ok: false, reason: "missing" };
    const record = await this.provider.resolveByHash(hashApiKey(raw));
    if (!record) return { ok: false, reason: "invalid" };
    if (record.expiresAtMs !== void 0 && record.expiresAtMs <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
    const required = route2.requiredScopes ?? [];
    if (required.length > 0) {
      const hasAll = required.every((scope) => record.scopes.includes(scope));
      if (!hasAll) return { ok: false, reason: "forbidden" };
    }
    return { ok: true, record };
  }
};

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
function isPathTraversal(pathname) {
  return TRAVERSAL_RE.test(pathname);
}
function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n]+/g, "");
}
function contentTypeAllowed(req, allowed) {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const contentType = getHeaderString(req, "content-type");
  if (!contentType) return false;
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowed.some((a) => a.toLowerCase() === mime);
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
  constructor(defaults = {}, now = Date.now) {
    this.defaults = { ...DEFAULTS.circuitBreaker, ...defaults };
    this.now = now;
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
      this.open(state);
      return;
    }
    state.consecutiveFailures += 1;
    state.windowFailures += 1;
    const ratio = opts.failureRatioThreshold;
    const minReq = opts.minimumRequests ?? 0;
    const ratioTripped = ratio !== void 0 && state.windowRequests >= minReq && state.windowFailures / Math.max(1, state.windowRequests) >= ratio;
    if (ratio !== void 0) {
      if (ratioTripped) this.open(state);
      return;
    }
    if (state.consecutiveFailures >= opts.failureThreshold) {
      this.open(state);
    }
  }
  open(state) {
    state.state = CIRCUIT_STATES.open;
    state.openedAt = this.now();
    state.windowRequests = 0;
    state.windowFailures = 0;
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
  counters = /* @__PURE__ */ new Map();
  constructor(routes) {
    this.routes = [...routes].sort(
      (a, b) => b.prefix.length - a.prefix.length
    );
  }
  resolve(req) {
    const pathname = pathnameOf(req.url);
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
var import_node_http = __toESM(require("http"), 1);
var import_node_https = __toESM(require("https"), 1);
var import_node_crypto5 = require("crypto");

// src/security/UpstreamSigner.ts
var import_node_crypto4 = require("crypto");
function signaturePayload(timestampMs, method, path2, userId, requestId) {
  return `${timestampMs}.${method.toUpperCase()}.${path2}.${userId}.${requestId}`;
}
function hmac(payload, secret) {
  return (0, import_node_crypto4.createHmac)("sha256", secret).update(payload).digest("hex");
}
function signGatewayRequest(input) {
  const timestampMs = input.timestampMs ?? Date.now();
  const headerName = input.headerName ?? DEFAULTS.perimeter.signatureHeader;
  const timestampHeader = input.timestampHeader ?? DEFAULTS.perimeter.signatureTimestampHeader;
  const signature = hmac(
    signaturePayload(timestampMs, input.method, input.path, input.userId, input.requestId),
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
var HOP_BY_HOP = new Set(HOP_BY_HOP_HEADERS);
var ProxyHandler = class {
  agents = /* @__PURE__ */ new Map();
  timeoutMs;
  maxSockets;
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.maxSockets = options.maxSockets ?? 256;
  }
  /**
   * Forward `req` to the upstream and stream the response into `res`.
   * Resolves with response metadata once upstream headers arrive.
   * Rejects on connect/timeout errors (response may be partially written —
   * callers should treat rejection as fatal for the request).
   */
  forward(req, res, target, options) {
    return new Promise((resolve, reject) => {
      const maxBodyBytes = options?.maxBodyBytes;
      const contentLength = Number(req.headers["content-length"]);
      if (maxBodyBytes !== void 0 && Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        reject(new PayloadTooLargeError(maxBodyBytes));
        return;
      }
      const url = new URL(target.upstream.url);
      const isHttps = url.protocol === "https:";
      const transport = isHttps ? import_node_https.default : import_node_http.default;
      const requestId = this.resolveRequestId(req, target);
      const headers = this.buildHeaders(req, url, target, requestId);
      const agent = this.agentFor(isHttps);
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
          clearTimeout(timer);
          const statusCode = upstreamRes.statusCode ?? STATUS.badGateway;
          if (options?.maskErrors === true && statusCode >= 500) {
            this.maskedResponse(upstreamRes, res, target.responseHeaders, statusCode, resolve);
            return;
          }
          if (options?.captureBody) {
            const chunks = [];
            upstreamRes.on("data", (chunk) => chunks.push(chunk));
            upstreamRes.on("end", () => {
              const body = Buffer.concat(chunks);
              this.writeResponse(upstreamRes, res, target.responseHeaders, body);
              resolve({
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
          resolve({
            statusCode,
            headers: upstreamRes.headers
          });
        }
      );
      const timer = setTimeout(() => {
        upstreamReq.destroy(new UpstreamTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
      timer.unref?.();
      res.on("close", () => {
        if (!res.writableEnded) upstreamReq.destroy();
      });
      req.on("aborted", () => upstreamReq.destroy());
      upstreamReq.on("error", (err) => {
        clearTimeout(timer);
        reject(err instanceof UpstreamTimeoutError ? err : err);
      });
      req.on("error", (err) => {
        clearTimeout(timer);
        upstreamReq.destroy();
        reject(err);
      });
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
    return (0, import_node_crypto5.randomUUID)();
  }
  buildHeaders(req, url, target, requestId) {
    const headers = {};
    const identity = new Set(IDENTITY_HEADERS);
    const strip = new Set(target.stripHeaders ?? []);
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === void 0 || HOP_BY_HOP.has(name)) continue;
      if (identity.has(name) || strip.has(name)) continue;
      headers[name] = Array.isArray(value) ? value.map(sanitizeHeaderValue) : sanitizeHeaderValue(value);
    }
    headers[HEADERS.requestId] = requestId;
    const clientIp = getHeaderString(req, HEADERS.forwardedFor) ? `${getHeaderString(req, HEADERS.forwardedFor)}, ${req.socket.remoteAddress ?? ""}` : req.socket.remoteAddress ?? "";
    if (clientIp) headers[HEADERS.forwardedFor] = clientIp;
    const proto = getHeaderString(req, HEADERS.forwardedProto) ?? url.protocol.replace(":", "");
    headers[HEADERS.forwardedProto] = proto;
    if (target.identityHeaders) {
      for (const [name, value] of Object.entries(target.identityHeaders)) {
        headers[name.toLowerCase()] = value;
      }
    }
    if (target.signing) {
      const signed = signGatewayRequest({
        secret: target.signing.secret,
        method: req.method ?? "GET",
        path: target.path,
        userId: target.signing.userId,
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
  maskedResponse(upstreamRes, res, extraHeaders, statusCode, resolve) {
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
      resolve({ statusCode, headers: upstreamRes.headers });
    });
    upstreamRes.on("error", () => {
      res.destroy();
      resolve({ statusCode: STATUS.badGateway, headers: {} });
    });
  }
  agentFor(isHttps) {
    const key = isHttps ? "https" : "http";
    let agent = this.agents.get(key);
    if (!agent) {
      agent = isHttps ? new import_node_https.default.Agent({ keepAlive: true, maxSockets: this.maxSockets }) : new import_node_http.default.Agent({ keepAlive: true, maxSockets: this.maxSockets });
      this.agents.set(key, agent);
    }
    return agent;
  }
  async close() {
    await Promise.all(
      [...this.agents.values()].map(
        (agent) => new Promise((resolve) => {
          agent.destroy();
          resolve();
        })
      )
    );
    this.agents.clear();
  }
};

// src/core/GatewayEngine.ts
var isGatewayResponse = (v) => typeof v === "object" && v !== null && "statusCode" in v;
var HOP_BY_HOP2 = new Set(HOP_BY_HOP_HEADERS);
var CACHE_EXCLUDED_HEADERS = /* @__PURE__ */ new Set([
  HEADERS.gatewayCache,
  HEADERS.rateLimitLimit,
  HEADERS.rateLimitRemaining,
  HEADERS.rateLimitReset,
  "x-gateway"
]);
function identityToHeaders(identity) {
  if (!identity) return void 0;
  const headers = { [HEADERS.userId]: identity.userId };
  if (identity.roles.length > 0) headers[HEADERS.userRole] = identity.roles.join(",");
  return headers;
}
function authRequired(route2) {
  return route2.auth !== void 0 && route2.auth !== false;
}
function validateAuthConfig(auth, routes) {
  if (!auth) return;
  const needsAuth = routes.some(authRequired);
  const hasProviders = auth.jwt !== void 0 || (auth.providers?.length ?? 0) > 0;
  if (needsAuth && !hasProviders) {
    throw new Error(
      "[gateway] One or more routes set `auth`, but no auth provider is configured. Set auth.jwt, auth.providers, or use a GatewayPlugin for custom auth."
    );
  }
}
function requestForbidsCache(req) {
  const cc = getHeaderString(req, HEADERS.cacheControl)?.toLowerCase() ?? "";
  return cc.includes("no-store") || cc.includes("private");
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
  const routes = config.routes ?? (config.routesDir ? loadRoutesDirSync(config.routesDir) : []);
  validateAuthConfig(config.auth, routes);
  assertNoMetadataUpstreams(
    routes.flatMap((r) => r.upstreams.map((u) => u.url)),
    config.allowMetadataUpstreams === true
  );
  if (config.cors) assertValidCors(config.cors);
  if (config.upstreamSigning !== void 0 && config.upstreamSigning.secret.length === 0) {
    throw new Error("[gateway] upstreamSigning.secret must not be empty.");
  }
  const router = new Router(routes);
  const limiter = new RedisRateLimiter(config.limiter);
  const apiKeyGuard = config.apiKeys ? new ApiKeyGuard(config.apiKeys) : void 0;
  const authProviders = [
    ...config.auth?.providers ?? [],
    ...config.auth?.jwt !== void 0 ? [createJwtProvider(config.auth.jwt)] : []
  ];
  const securityStore = config.limiter?.redis ?? new InMemoryRedis();
  const bruteForceGuard = config.bruteForce ? new BruteForceGuard(securityStore, config.bruteForce) : void 0;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULTS.perimeter.maxBodyBytes;
  const plugins = config.plugins ?? [];
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
  const circuitBreaker = new CircuitBreaker();
  const proxy = new ProxyHandler({
    timeoutMs: config.upstreamTimeoutMs ?? DEFAULTS.proxy.upstreamTimeoutMs,
    maxSockets: config.maxSockets ?? DEFAULTS.proxy.maxSockets
  });
  const startedAt = Date.now();
  const caches = /* @__PURE__ */ new WeakMap();
  const cacheFor = (route2, cfg) => {
    let cache = caches.get(route2);
    if (!cache) {
      cache = new ResponseCache(cfg.ttlMs, cfg.maxEntries ?? DEFAULTS.cache.maxEntries);
      caches.set(route2, cache);
    }
    return cache;
  };
  const extractKey = config.extractClientKey ?? extractClientIp;
  let draining = false;
  let activeRequests = 0;
  let drainNotify;
  const activeResponses = /* @__PURE__ */ new Set();
  function notifyDrained() {
    if (activeRequests === 0) drainNotify?.();
  }
  async function handleRequest(req, res) {
    if (draining) {
      sendJson(
        res,
        STATUS.serviceUnavailable,
        defaultErrorBody(ERROR_CODES.draining, "server is draining"),
        {
          [HEADERS.connection]: "close",
          [HEADERS.retryAfter]: String(DEFAULTS.shutdown.retryAfterSeconds)
        }
      );
      return;
    }
    activeRequests += 1;
    activeResponses.add(res);
    res.on("close", () => activeResponses.delete(res));
    try {
      await pipeline(req, res);
    } catch (err) {
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, STATUS.badGateway, defaultErrorBody(
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : "internal error"
        ));
      } else {
        res.destroy();
      }
    } finally {
      activeRequests -= 1;
      activeResponses.delete(res);
      notifyDrained();
    }
  }
  function replayCache(res, entry, status) {
    res.writeHead(entry.statusCode, {
      ...entry.headers,
      [HEADERS.gatewayCache]: status
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
    const circuitsOk = routes.every(
      (route2) => route2.upstreams.some(
        (u) => circuitBreaker.stateOf(`${route2.prefix}|${u.url}`) !== CIRCUIT_STATES.open
      )
    );
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
    const started = import_node_perf_hooks.performance.now();
    const ctx = await pipelineInner(req, res);
    if (ctx && plugins.length > 0) {
      const durationMs = import_node_perf_hooks.performance.now() - started;
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
      sendJson(res, 400, defaultErrorBody(
        ERROR_CODES.pathTraversalBlocked,
        "malformed request path"
      ));
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
        sendJson(
          res,
          STATUS.locked,
          defaultErrorBody(ERROR_CODES.locked, "too many failed authentication attempts"),
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
      sendJson(res, 404, defaultErrorBody(ERROR_CODES.noRoute, "no matching route"));
      return void 0;
    }
    const { route: route2, strippedPath } = resolved;
    if (route2.allowedContentTypes && !contentTypeAllowed(req, route2.allowedContentTypes)) {
      sendJson(res, STATUS.unsupportedMediaType, defaultErrorBody(
        ERROR_CODES.unsupportedMediaType,
        "unsupported content type"
      ));
      return void 0;
    }
    const denyAuth = async (statusCode, code, message, extraHeaders) => {
      if (bruteForceGuard) await bruteForceGuard.recordFailure(clientIp);
      emitSecurity(SECURITY_EVENT_TYPES.authDenied, message, clientIp, pathname);
      sendJson(res, statusCode, defaultErrorBody(code, message), extraHeaders);
      return void 0;
    };
    let identity;
    if (authProviders.length > 0 && authRequired(route2)) {
      let deniedReason;
      for (const provider of authProviders) {
        const outcome = await provider.authenticate(req);
        if ("authenticated" in outcome) {
          if (outcome.authenticated) {
            identity = outcome.identity;
            break;
          }
          deniedReason = outcome.reason ?? "authentication failed";
          break;
        }
      }
      if (identity === void 0) {
        const realm = config.auth?.realm;
        return denyAuth(
          STATUS.unauthorized,
          ERROR_CODES.unauthorized,
          deniedReason ?? "authentication required",
          {
            [HEADERS.wwwAuthenticate]: realm ? `Bearer realm="${realm}"` : "Bearer"
          }
        );
      }
      const verified = identity;
      if (Array.isArray(route2.auth) && route2.auth.length > 0) {
        const allowed = route2.auth.some((role) => verified.roles.includes(role));
        if (!allowed) {
          return denyAuth(
            STATUS.forbidden,
            ERROR_CODES.forbidden,
            "insufficient role"
          );
        }
      }
      if (bruteForceGuard) await bruteForceGuard.recordSuccess(clientIp);
    }
    let apiKeyRecord;
    if (apiKeyGuard && route2.requiredScopes !== void 0) {
      const result = await apiKeyGuard.authenticate(req, route2);
      if (!result.ok) {
        const status = result.reason === "forbidden" ? STATUS.forbidden : STATUS.unauthorized;
        const code = result.reason === "forbidden" ? ERROR_CODES.forbidden : ERROR_CODES.apiKeyInvalid;
        if (bruteForceGuard) await bruteForceGuard.recordFailure(clientIp);
        emitSecurity(SECURITY_EVENT_TYPES.apiKeyDenied, result.reason, clientIp, pathname);
        sendJson(res, status, defaultErrorBody(code, `api key ${result.reason}`));
        return void 0;
      }
      apiKeyRecord = result.record;
      if (bruteForceGuard) await bruteForceGuard.recordSuccess(clientIp);
    }
    const extractor = resolveExtractor(route2, extractKey);
    const clientKey = await extractor(req);
    const upstream = router.nextUpstream(route2.prefix, route2.upstreams);
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
      upstreamPath: forwardPathname,
      upstreamUrl: `${upstream.url}${path2}`,
      ...identity !== void 0 ? { identity } : {}
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
        sendJson(
          res,
          decision.statusCode ?? STATUS.forbidden,
          defaultErrorBody(
            decision.code ?? ERROR_CODES.policyDenied,
            decision.message ?? "request denied by policy"
          )
        );
        return ctx;
      }
    }
    const early = await config.hooks?.onRequest?.(ctx);
    if (isGatewayResponse(early)) {
      sendGatewayResponse(res, early);
      return ctx;
    }
    const effectiveRateLimit = apiKeyRecord?.rateLimitOverride ?? route2.rateLimit;
    let rateHeaders;
    if (effectiveRateLimit) {
      const result = await limiter.consume(
        `${route2.prefix}:${clientKey}`,
        effectiveRateLimit
      );
      rateHeaders = {
        [HEADERS.rateLimitLimit]: String(result.limit),
        [HEADERS.rateLimitRemaining]: String(result.remaining),
        [HEADERS.rateLimitReset]: String(result.resetAt)
      };
      if (!result.allowed) {
        sendJson(
          res,
          STATUS.tooManyRequests,
          defaultErrorBody(ERROR_CODES.rateLimited, "rate limit exceeded"),
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
    const breakerKey = `${route2.prefix}|${upstream.url}`;
    if (route2.circuitBreaker) {
      circuitBreaker.configure(breakerKey, route2.circuitBreaker);
    }
    const method = req.method ?? "GET";
    const cacheCfg = route2.cache;
    const cacheable = cacheCfg !== void 0 && (method === "GET" || method === "HEAD");
    const useCache = cacheable && !requestForbidsCache(req) && (identity === void 0 || cacheCfg?.allowAuthenticated === true);
    let cache;
    let cacheKey;
    if (useCache && cacheCfg) {
      cache = cacheFor(route2, cacheCfg);
      cacheKey = `${method} ${ctx.upstreamUrl}`;
      const { fresh, stale } = cache.lookup(cacheKey);
      if (fresh) {
        replayCache(res, fresh, CACHE_STATUS.hit);
        return ctx;
      }
      if (stale && cacheCfg.serveStaleOnCircuitOpen && circuitBreaker.stateOf(breakerKey) === CIRCUIT_STATES.open) {
        replayCache(res, stale, CACHE_STATUS.stale);
        return ctx;
      }
    }
    if (!circuitBreaker.canExecute(breakerKey)) {
      sendJson(
        res,
        STATUS.serviceUnavailable,
        defaultErrorBody(ERROR_CODES.circuitOpen, "upstream circuit is open"),
        rateHeaders
      );
      return ctx;
    }
    const responseHeaders = {
      ...rateHeaders,
      ...cacheable ? { [HEADERS.gatewayCache]: CACHE_STATUS.miss } : {}
    };
    try {
      const info = await proxy.forward(
        req,
        res,
        {
          upstream,
          path: path2,
          responseHeaders: Object.keys(responseHeaders).length ? responseHeaders : void 0,
          identityHeaders: identityToHeaders(identity),
          stripHeaders: config.auth?.stripHeaders,
          ...config.upstreamSigning !== void 0 ? {
            signing: {
              secret: config.upstreamSigning.secret,
              userId: identity?.userId ?? "",
              ...config.upstreamSigning.headerName !== void 0 ? { headerName: config.upstreamSigning.headerName } : {},
              ...config.upstreamSigning.timestampHeader !== void 0 ? { timestampHeader: config.upstreamSigning.timestampHeader } : {}
            }
          } : {}
        },
        {
          captureBody: useCache,
          maxBodyBytes,
          maskErrors: config.maskUpstreamErrors === true
        }
      );
      await config.hooks?.onUpstreamResponse?.(ctx, info);
      if (info.statusCode >= 500) {
        circuitBreaker.recordFailure(breakerKey);
      } else {
        circuitBreaker.recordSuccess(breakerKey);
      }
      if (cache && cacheKey && info.statusCode === STATUS.ok && info.body !== void 0 && !responseForbidsCache(info.headers)) {
        cache.set(cacheKey, {
          statusCode: info.statusCode,
          headers: storableHeaders(info.headers),
          body: info.body
        });
      }
    } catch (err) {
      circuitBreaker.recordFailure(breakerKey);
      await config.hooks?.onUpstreamError?.(
        ctx,
        err instanceof Error ? err : new Error(String(err))
      );
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return ctx;
      }
      if (err instanceof PayloadTooLargeError) {
        sendJson(
          res,
          STATUS.payloadTooLarge,
          defaultErrorBody(ERROR_CODES.payloadTooLarge, "request body too large"),
          rateHeaders
        );
        return ctx;
      }
      const isTimeout = err instanceof UpstreamTimeoutError;
      sendJson(
        res,
        isTimeout ? STATUS.gatewayTimeout : STATUS.badGateway,
        defaultErrorBody(
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : "upstream error"
        ),
        rateHeaders
      );
    }
    return ctx;
  }
  const server = import_node_http2.default.createServer((req, res) => {
    void handleRequest(req, res);
  });
  async function shutdown(options) {
    draining = true;
    for (const res of activeResponses) {
      res.shouldKeepAlive = false;
    }
    const timeoutMs = options?.drainTimeoutMs ?? DEFAULTS.shutdown.drainTimeoutMs;
    if (activeRequests > 0) {
      await Promise.race([
        new Promise((resolve) => {
          drainNotify = () => {
            if (activeRequests === 0) resolve();
          };
          if (activeRequests === 0) resolve();
        }),
        new Promise((resolve) => {
          const t = setTimeout(resolve, timeoutMs);
          t.unref?.();
        })
      ]);
    }
    drainNotify = void 0;
    if (server.listening) {
      const closed = new Promise((resolve) => {
        server.close(() => resolve());
      });
      server.closeIdleConnections();
      await closed;
    }
    await proxy.close();
  }
  return {
    server,
    handleRequest,
    router,
    limiter,
    circuitBreaker,
    listen(port = config.port ?? DEFAULTS.port, host = config.host ?? DEFAULTS.host) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    shutdown,
    close() {
      return shutdown();
    }
  };
}

// src/adapters/express.ts
function gatewayMiddleware(config) {
  const gateway = createGateway(config);
  return function gatewayExpressMiddleware(req, res, next) {
    const matched = gateway.router.resolve(req) !== void 0;
    if (!matched) {
      if (next) {
        next();
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NO_ROUTE", message: "no matching route" } }));
      return;
    }
    void gateway.handleRequest(req, res);
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createGateway,
  gatewayMiddleware
});
//# sourceMappingURL=express.cjs.map