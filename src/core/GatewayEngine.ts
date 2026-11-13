import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  CACHE_STATUS,
  CIRCUIT_STATES,
  DEFAULTS,
  ERROR_CODES,
  HEADERS,
  HOP_BY_HOP_HEADERS,
  STATUS,
} from '../constants.js';
import type {
  ClientKeyExtractor,
  EdgeRequestContext,
  GatewayConfig,
  GatewayResponse,
  RequestContext,
  RouteCacheConfig,
  RouteConfig,
  RoutePrefix,
  RouteReloadConfig,
  RoutesInput,
  UpstreamTarget,
  UpstreamUrl,
} from '../types.js';
import { extractClientIp, getHeaderString, resolveExtractor } from '../utils/extractors.js';
import { defaultErrorBody, secondsUntil, sendErrorJson, sendGatewayResponse, sendJson } from '../utils/http.js';
import { RedisRateLimiter } from '../limiter/RedisRateLimiter.js';
import { InMemoryRedis } from '../limiter/InMemoryRedis.js';
import { ResponseCache } from '../cache/ResponseCache.js';
import type { CacheEntry } from '../cache/ResponseCache.js';
import { RequestCoalescer } from '../cache/RequestCoalescer.js';
import { IdempotencyManager } from '../resilience/IdempotencyManager.js';
import { loadRoutesDirSync } from '../routing/RouteLoader.js';
import {
  assembleRoutes,
  isRouteReloadConfig,
} from '../routing/normalize.js';
import { BruteForceGuard } from '../security/BruteForceGuard.js';
import {
  assertNoMetadataUpstreams,
  assertValidCors,
  buildCorsHeaders,
  contentTypeAllowed,
  isOriginAllowed,
  isPathTraversal,
  isPreflight,
} from '../security/PerimeterGuard.js';
import { SECURITY_EVENT_TYPES } from '../constants.js';
import type { SecurityAuditEvent, SecurityEventType } from '../types.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { pathnameOf, Router } from './Router.js';
import { PayloadTooLargeError, ProxyHandler, UpstreamTimeoutError } from './ProxyHandler.js';
import { LoadBalancer } from '../routing/LoadBalancer.js';
import { LoadShedder } from '../networking/LoadShedder.js';
import { listenCluster as runCluster } from '../networking/ClusterSupervisor.js';
import { MetricsCollector } from './MetricsCollector.js';
import { deadlineTimer, destroySafely } from '../shared/timers.js';
import type { DeadlineTimer } from '../shared/timers.js';
import { HOP_BY_HOP_SET } from '../shared/httpUtils.js';
import type { ClusterOptions } from '../networking/ClusterSupervisor.js';
import { proxyUpgrade } from '../networking/UpgradeProxy.js';
import type {
  UpstreamPoolMetrics,
  UpstreamResponseInfo,
} from '../types.js';

export interface ShutdownOptions {
  /** Max time to wait for in-flight requests. Default 10s. */
  drainTimeoutMs?: number;
}

export interface Gateway<TReq extends IncomingMessage = IncomingMessage> {
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

const isGatewayResponse = (v: unknown): v is GatewayResponse =>
  typeof v === 'object' && v !== null && 'statusCode' in v;

const HOP_BY_HOP = HOP_BY_HOP_SET;
const CACHE_EXCLUDED_HEADERS = new Set<string>([
  HEADERS.gatewayCache,
  HEADERS.rateLimitLimit,
  HEADERS.rateLimitRemaining,
  HEADERS.rateLimitReset,
  'x-gateway',
]);

function requestForbidsCache(req: IncomingMessage): boolean {
  const cc = getHeaderString(req, HEADERS.cacheControl)?.toLowerCase() ?? '';
  return cc.includes('no-store') || cc.includes('private');
}

async function readRequestBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new PayloadTooLargeError(limit);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function responseForbidsCache(headers: Record<string, string | string[] | undefined>): boolean {
  const value = headers[HEADERS.cacheControl];
  const cc = (Array.isArray(value) ? value.join(',') : value ?? '').toLowerCase();
  return cc.includes('no-store') || cc.includes('private');
}

function storableHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(lower) || CACHE_EXCLUDED_HEADERS.has(lower)) continue;
    out[lower] = value;
  }
  return out;
}

export function createGateway<TReq extends IncomingMessage = IncomingMessage>(
  config: GatewayConfig<TReq>,
): Gateway<TReq> {
  const configuredRoutes: RouteConfig<TReq>[] = assembleRoutes<TReq>({
    routes: config.routes,
    dirRoutes: config.routesDir
      ? loadRoutesDirSync<TReq>(config.routesDir)
      : undefined,
    target: config.target,
    rateLimit: config.rateLimit,
    circuitBreaker: config.circuitBreaker,
    cache: config.cache,
    basePrefix: config.basePrefix,
    autoRoutes: config.autoRoutes,
  });

  // Fail fast on an empty route table — unless the gateway exists only to
  // serve probe/metrics endpoints.
  if (
    configuredRoutes.length === 0 &&
    config.healthPath === undefined &&
    config.probes?.livenessPath === undefined &&
    config.probes?.readinessPath === undefined &&
    config.metricsPath === undefined
  ) {
    throw new Error(
      '[gateway] empty route table — provide `routes`, `target`, `routesDir`, or `autoRoutes` (or a health/metrics path).',
    );
  }

  // ---- boot-time perimeter validation (fail fast) ----
  assertNoMetadataUpstreams(
    configuredRoutes.flatMap((r) => r.upstreams.map((u) => u.url)),
    config.allowMetadataUpstreams === true,
  );
  if (config.cors) assertValidCors(config.cors);
  if (config.upstreamSigning !== undefined && config.upstreamSigning.secret.length === 0) {
    throw new Error('[gateway] upstreamSigning.secret must not be empty.');
  }

  const metrics = new MetricsCollector();
  const metricsPathKey =
    config.metricsPath !== undefined ? String(config.metricsPath) : undefined;

  /** True when an existing route prefix already covers the metrics path. */
  const metricsPathCovered = (table: readonly RouteConfig<TReq>[]): boolean => {
    if (metricsPathKey === undefined) return true;
    return table.some((r) => {
      const p = String(r.prefix);
      return p === '/' || metricsPathKey === p || metricsPathKey.startsWith(`${p}/`);
    });
  };

  /** metricsPath gets an implicit route so global/per-route guards apply. */
  const withMetricsRoute = (
    table: readonly RouteConfig<TReq>[],
  ): RouteConfig<TReq>[] => {
    if (metricsPathKey === undefined || metricsPathCovered(table)) {
      return [...table];
    }
    return [
      ...table,
      {
        prefix: config.metricsPath as RoutePrefix,
        // Never contacted — the pipeline serves metrics before proxying.
        upstreams: [{ url: 'http://127.0.0.1:9' as UpstreamUrl }],
      },
    ];
  };

  let routeTable = withMetricsRoute(configuredRoutes);
  let router = new Router<TReq>(routeTable);

  // ---- boot-time route normalization (zero per-request allocation) ----
  interface PreparedRoute {
    /** Merged global+route stripHeaders, lowercased. */
    stripHeaders: ReadonlySet<string>;
    /** Lowercased allowed Content-Types; undefined = unrestricted. */
    contentTypes?: ReadonlySet<string>;
    /** Lowercased cache.varyHeaders names; undefined = none. */
    varyHeaders?: readonly string[];
  }
  const globalStripHeaders = new Set(
    (config.stripHeaders ?? []).map((h) => h.toLowerCase()),
  );
  const preparedRoutes = new Map<RouteConfig<TReq>, PreparedRoute>();
  const buildPreparedRoutes = (table: readonly RouteConfig<TReq>[]): void => {
    preparedRoutes.clear();
    for (const route of table) {
      const stripHeaders = new Set(globalStripHeaders);
      for (const h of route.stripHeaders ?? []) stripHeaders.add(h.toLowerCase());
      const prep: PreparedRoute = { stripHeaders };
      if (route.allowedContentTypes !== undefined) {
        prep.contentTypes = new Set(
          route.allowedContentTypes.map((c) => c.toLowerCase()),
        );
      }
      const varyHeaders = route.cache?.varyHeaders;
      if (varyHeaders !== undefined && varyHeaders.length > 0) {
        prep.varyHeaders = varyHeaders.map((h) => h.toLowerCase());
      }
      preparedRoutes.set(route, prep);
    }
  };
  buildPreparedRoutes(routeTable);

  const limiter = new RedisRateLimiter(config.limiter);

  const securityStore = config.limiter?.redis ?? new InMemoryRedis();
  const bruteForceGuard = config.bruteForce
    ? new BruteForceGuard(securityStore, config.bruteForce)
    : undefined;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULTS.perimeter.maxBodyBytes;
  const plugins = config.plugins ?? [];
  const loadBalancer = new LoadBalancer();
  const shedder = config.loadShedding?.enabled === true
    ? new LoadShedder({
        ...(config.loadShedding.maxEventLoopDelayMs !== undefined
          ? { maxEventLoopDelayMs: config.loadShedding.maxEventLoopDelayMs }
          : {}),
        ...(config.loadShedding.maxConcurrentRequests !== undefined
          ? { maxConcurrentRequests: config.loadShedding.maxConcurrentRequests }
          : {}),
      })
    : undefined;
  shedder?.start();

  const emitSecurity = (
    type: SecurityEventType,
    detail: string | undefined,
    clientIp: string | undefined,
    path: string | undefined,
  ): void => {
    if (!config.onSecurityEvent) return;
    const event: SecurityAuditEvent = {
      type,
      timestampMs: Date.now(),
      ...(clientIp !== undefined ? { clientIp } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(detail !== undefined ? { detail } : {}),
    };
    try {
      config.onSecurityEvent(event);
    } catch {
      // audit sink must never break the request path
    }
  };
  const nodeId = randomUUID();
  // Shared store backing brute-force, idempotency, coalescing, L2 cache
  // and circuit-breaker coordination — Redis when configured, else a
  // per-process InMemoryRedis (single-node still works).
  const distributedStore = securityStore;
  const idempotencyManager = new IdempotencyManager(distributedStore, nodeId);
  const coalescer = new RequestCoalescer(distributedStore, { nodeId });
  const circuitBreaker = new CircuitBreaker();
  circuitBreaker.setDistributedStore(distributedStore, nodeId);
  const proxy = new ProxyHandler({
    timeoutMs: config.upstreamTimeoutMs ?? DEFAULTS.proxy.upstreamTimeoutMs,
    maxSockets:
      config.maxSocketsPerUpstream ??
      config.maxSockets ??
      DEFAULTS.proxy.maxSockets,
  });
  const startedAt = Date.now();

  // Per-route response caches (created lazily, bounded LRU).
  const caches = new WeakMap<RouteConfig<TReq>, ResponseCache>();
  const cacheFor = (route: RouteConfig<TReq>, cfg: RouteCacheConfig): ResponseCache => {
    let cache = caches.get(route);
    if (!cache) {
      cache = new ResponseCache(
        cfg.ttlMs,
        cfg.maxEntries ?? DEFAULTS.cache.maxEntries,
        Date.now,
        distributedStore,
      );
      caches.set(route, cache);
    }
    return cache;
  };

  const extractKey = config.extractClientKey ?? extractClientIp;

  // ---- drain / shutdown state ----
  let draining = false;
  let activeRequests = 0;
  let drainNotify: (() => void) | undefined;
  const activeResponses = new Set<ServerResponse>();
  // Raw upgrade tunnels (WebSocket/SSE) are detached from the HTTP
  // server's connection tracking — track them explicitly so shutdown
  // can destroy them instead of leaking open sockets.
  const activeTunnels = new Set<import('node:stream').Duplex>();

  function notifyDrained(): void {
    if (activeRequests === 0) drainNotify?.();
  }

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (draining) {
      sendErrorJson(
        res,
        STATUS.serviceUnavailable,
        ERROR_CODES.draining,
        'server is draining',
        {
          [HEADERS.connection]: 'close',
          [HEADERS.retryAfter]: String(DEFAULTS.shutdown.retryAfterSeconds),
        },
      );
      return;
    }

    // Load shedding: reject before parsing bodies / hitting stores.
    if (shedder?.shouldShed()) {
      sendErrorJson(
        res,
        STATUS.serviceUnavailable,
        ERROR_CODES.overloaded,
        'gateway overloaded',
        {
          [HEADERS.retryAfter]: String(DEFAULTS.networking.shedRetryAfterSec),
        },
      );
      return;
    }

    activeRequests += 1;
    shedder?.enter();
    activeResponses.add(res);
    res.on('close', () => activeResponses.delete(res));
    try {
      await pipeline(req as TReq, res);
    } catch (err) {
      if (!res.headersSent && !res.writableEnded) {
        sendErrorJson(res, STATUS.badGateway, ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : 'internal error');
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

  function replayCache(
    res: ServerResponse,
    entry: CacheEntry,
    status: string,
    extraHeaders?: Record<string, string>,
  ): void {
    res.writeHead(entry.statusCode, {
      ...entry.headers,
      [HEADERS.gatewayCache]: status,
      ...extraHeaders,
    });
    res.end(entry.body);
  }

  async function handleLiveness(res: ServerResponse): Promise<void> {
    sendJson(res, STATUS.ok, {
      status: 'ok',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    });
  }

  async function handleReadiness(res: ServerResponse): Promise<void> {
    const timeoutMs = config.probes?.readinessTimeoutMs ?? DEFAULTS.probes.readinessTimeoutMs;
    const redisOk = await limiter.ping(timeoutMs);
    let circuitsOk = true;
    for (const route of routeTable) {
      for (const u of route.upstreams) {
        if ((await circuitBreaker.stateOfShared(`${route.prefix}|${u.url}`)) === CIRCUIT_STATES.open) {
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
        status: ready ? 'ready' : 'not_ready',
        checks: {
          redis: redisOk ? 'up' : 'down',
          circuits: circuitsOk ? 'ok' : 'degraded',
        },
      },
    );
  }

  async function handleHealth(res: ServerResponse): Promise<void> {
    const ok = await limiter.ping(DEFAULTS.probes.readinessTimeoutMs);
    const failClosed = config.limiter?.failMode === 'closed';
    const healthy = ok || !failClosed;
    sendJson(res, healthy ? STATUS.ok : STATUS.serviceUnavailable, {
      status: healthy ? 'ok' : 'unhealthy',
    });
  }

  function applyPerimeterHeaders(req: TReq, res: ServerResponse): void {
    // Security headers on every response (setHeader merges into writeHead).
    res.setHeader(HEADERS.contentTypeOptions, DEFAULTS.perimeter.nosniff);
    res.setHeader(
      HEADERS.frameOptions,
      config.securityHeaders?.frameOptions ?? DEFAULTS.perimeter.frameOptions,
    );
    res.setHeader(HEADERS.referrerPolicy, DEFAULTS.perimeter.referrerPolicy);
    const hsts = config.securityHeaders?.hsts;
    if (hsts) {
      res.setHeader(
        HEADERS.strictTransportSecurity,
        `max-age=${hsts.maxAgeSec}${hsts.includeSubDomains ? '; includeSubDomains' : ''}`,
      );
    }
    // CORS
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

  async function pipeline(req: TReq, res: ServerResponse): Promise<void> {
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
          // plugin errors must not break the response path
        }
      }
    }
  }

  async function pipelineInner(
    req: TReq,
    res: ServerResponse,
  ): Promise<RequestContext<TReq> | undefined> {
    const pathname = pathnameOf(req.url);
    const clientIp = extractClientIp(req);

    // ---- path traversal / injection guard ----
    if (isPathTraversal(pathname)) {
      emitSecurity(SECURITY_EVENT_TYPES.pathTraversalBlocked, pathname, clientIp, pathname);
      sendErrorJson(res, 400, ERROR_CODES.pathTraversalBlocked, 'malformed request path');
      return undefined;
    }

    applyPerimeterHeaders(req, res);

    // ---- brute-force lockout ----
    if (bruteForceGuard) {
      const lockedSecs = await bruteForceGuard.lockedFor(clientIp);
      if (lockedSecs !== null) {
        emitSecurity(
          SECURITY_EVENT_TYPES.bruteForceLocked,
          `locked for ${lockedSecs}s`,
          clientIp,
          pathname,
        );
        sendErrorJson(
          res,
          STATUS.locked,
          ERROR_CODES.locked,
          'too many failed authentication attempts',
          { [HEADERS.retryAfter]: String(lockedSecs) },
        );
        return undefined;
      }
    }

    // ---- CORS preflight ----
    if (config.cors && isPreflight(req)) {
      res.writeHead(STATUS.noContent);
      res.end();
      return undefined;
    }

    // ---- probes: bypass routing, rate limits, and upstreams ----
    if (config.probes?.livenessPath && pathname === String(config.probes.livenessPath)) {
      await handleLiveness(res);
      return undefined;
    }
    if (config.probes?.readinessPath && pathname === String(config.probes.readinessPath)) {
      await handleReadiness(res);
      return undefined;
    }
    if (config.healthPath && pathname === String(config.healthPath)) {
      await handleHealth(res);
      return undefined;
    }

    const resolved = router.resolve(req);
    if (!resolved) {
      sendErrorJson(res, 404, ERROR_CODES.noRoute, 'no matching route');
      return undefined;
    }
    const { route, strippedPath } = resolved;
    const prep = preparedRoutes.get(route);

    // ---- content-type enforcement ----
    if (prep?.contentTypes !== undefined && !contentTypeAllowed(req, prep.contentTypes)) {
      sendErrorJson(res, STATUS.unsupportedMediaType,
        ERROR_CODES.unsupportedMediaType, 'unsupported content type');
      return undefined;
    }

    const denyGuard = async (
      statusCode: number,
      code: string,
      message: string,
      extraHeaders?: Record<string, string>,
    ): Promise<undefined> => {
      if (bruteForceGuard) await bruteForceGuard.recordFailure(clientIp);
      emitSecurity(SECURITY_EVENT_TYPES.authDenied, message, clientIp, pathname);
      sendErrorJson(res, statusCode, code, message, extraHeaders);
      return undefined;
    };

    const extractor = resolveExtractor(route, extractKey as ClientKeyExtractor<TReq>);
    const clientKey = await extractor(req);

    // ---- edge guard pipeline (global + per-route, fully stateless) ----
    // Core knows nothing about domains — guards are opaque functions
    // returning allow(headers,tags)/deny(status,code,message).
    const guardHeaders: Record<string, string> = {};
    const guardTags: Record<string, string> = {};
    const prepStrip = prep?.stripHeaders;
    const allGuards = [...(config.guards ?? []), ...(route.guards ?? [])];
    if (allGuards.length > 0) {
      const edgeCtx: EdgeRequestContext<TReq> = {
        req,
        method: req.method ?? 'GET',
        path: pathname,
        url: req.url,
        routePrefix: String(route.prefix),
        clientKey,
        clientIp,
        tags: guardTags,
        headers: guardHeaders,
      };
      for (const guard of allGuards) {
        const decision = await guard.evaluate(edgeCtx);
        if (decision.action === 'deny') {
          return denyGuard(
            decision.status,
            decision.code,
            decision.message,
            decision.headers,
          );
        }
        if (decision.headers) Object.assign(guardHeaders, decision.headers);
        if (decision.tags) Object.assign(guardTags, decision.tags);
      }
      if (bruteForceGuard) await bruteForceGuard.recordSuccess(clientIp);
    }
    // Requests carrying guard-emitted context are "contextual" — never
    // cached/idempotency-shared unless the route opts in.
    const hasGuardContext =
      Object.keys(guardTags).length > 0 || Object.keys(guardHeaders).length > 0;
    // P2C is the default when a route has multiple upstreams.
    const strategy =
      route.upstreamStrategy ??
      (route.upstreams.length > 1 ? 'p2c' : 'weighted-rr');
    const upstream =
      strategy === 'p2c'
        ? loadBalancer.selectP2C(route.upstreams)
        : router.nextUpstream(route.prefix, route.upstreams);

    const queryIndex = req.url?.indexOf('?') ?? -1;
    const query = queryIndex === -1 ? '' : req.url!.slice(queryIndex);
    const forwardPathname = route.stripPrefix === false ? pathname : strippedPath;
    const path = `${forwardPathname}${query}`;

    const ctx: RequestContext<TReq> = {
      req,
      res,
      route,
      upstream,
      clientKey,
      tags: guardTags,
      upstreamPath: forwardPathname,
      upstreamUrl: `${upstream.url}${path}`,
    };

    // ---- lifecycle plugins (policy interceptors) ----
    for (const plugin of plugins) {
      const decision = await plugin.onRequest?.(ctx);
      if (decision?.action === 'deny') {
        emitSecurity(
          SECURITY_EVENT_TYPES.policyDenied,
          `${plugin.name}: ${decision.message ?? 'denied'}`,
          clientIp,
          pathname,
        );
        sendErrorJson(
          res,
          decision.statusCode ?? STATUS.forbidden,
          decision.code ?? ERROR_CODES.policyDenied,
          decision.message ?? 'request denied by policy',
        );
        return ctx;
      }
    }

    // Hook: pre-rate-limit
    const early = await config.hooks?.onRequest?.(ctx);
    if (isGatewayResponse(early)) {
      sendGatewayResponse(res, early);
      return ctx;
    }

    // Rate limiting (API-key override wins over the route rule)
    const effectiveRateLimit = route.rateLimit;
    let rateHeaders: Record<string, string> | undefined;
    if (effectiveRateLimit) {
      const result = await limiter.consume(
        `${route.prefix}:${clientKey}`,
        effectiveRateLimit,
      );
      rateHeaders = {
        [HEADERS.rateLimitLimit]: String(result.limit),
        [HEADERS.rateLimitRemaining]: String(result.remaining),
        [HEADERS.rateLimitReset]: String(result.resetAt),
        ...(result.source !== undefined
          ? { [HEADERS.rateLimitSource]: result.source }
          : {}),
      };
      if (!result.allowed) {
        metrics.recordOutcome(route.prefix, 'rate_limited');
        await config.hooks?.onRateLimited?.(ctx, result);
        sendErrorJson(
          res,
          STATUS.tooManyRequests,
          ERROR_CODES.rateLimited,
          'rate limit exceeded',
          {
            ...rateHeaders,
            [HEADERS.retryAfter]: String(secondsUntil(result.resetAt, Date.now())),
          },
        );
        return ctx;
      }
    }

    // Hook: post-authorization
    const authorized = await config.hooks?.onAuthorized?.(ctx);
    if (isGatewayResponse(authorized)) {
      sendGatewayResponse(res, { ...authorized, headers: { ...rateHeaders, ...authorized.headers } });
      return ctx;
    }

    // ---- metrics endpoint: served in-pipeline so guards/rate limits apply ----
    if (metricsPathKey !== undefined && pathname === metricsPathKey) {
      const accept = getHeaderString(req, 'accept') ?? '';
      if (accept.includes('application/json')) {
        sendJson(res, STATUS.ok, metrics.snapshot());
      } else {
        const body = metrics.prometheus();
        res.writeHead(STATUS.ok, {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'content-length': String(Buffer.byteLength(body)),
        });
        res.end(body);
      }
      return ctx;
    }

    // ---- distributed idempotency ----
    const method = req.method ?? 'GET';
    const idemCfg = route.idempotency;
    const idemKey = getHeaderString(req, HEADERS.idempotencyKey);
    const idemApplies =
      idemCfg?.enabled === true &&
      idemKey !== null &&
      (idemCfg.methods ?? DEFAULTS.resilience.idempotencyMethods).includes(method);
    let idemBody: Buffer | undefined;
    let idemComplete:
      | ((result: { statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }) => Promise<void>)
      | undefined;
    let idemAbort: (() => Promise<void>) | undefined;
    if (idemApplies && idemKey) {
      try {
        idemBody = await readRequestBody(req, maxBodyBytes);
      } catch {
        sendErrorJson(
          res,
          STATUS.payloadTooLarge,
          ERROR_CODES.payloadTooLarge,
          'request body too large',
          rateHeaders,
        );
        return ctx;
      }
      // Scope binds to client key + route + all guard-emitted tags, so
      // idempotent replays never cross tenant/plan/context boundaries.
      const tagScope = Object.keys(guardTags)
        .sort()
        .map((k) => `${k}=${guardTags[k] ?? ''}`)
        .join('&');
      const scope = `${clientKey}|${String(route.prefix)}|${tagScope}`;
      const fingerprint = idempotencyManager.fingerprint(method, req.url ?? pathname, idemBody);
      const begin = await idempotencyManager.begin(scope, idemKey, fingerprint, {
        ttlMs: idemCfg?.ttlMs ?? DEFAULTS.resilience.idempotencyTtlMs,
        lockTimeoutMs: idemCfg?.lockTimeoutMs ?? DEFAULTS.resilience.idempotencyLockTimeoutMs,
      });
      if (begin.action === 'replay') {
        res.writeHead(begin.statusCode, {
          ...begin.headers,
          [HEADERS.idempotentReplay]: 'true',
        });
        res.end(begin.body);
        return ctx;
      }
      if (begin.action === 'conflict') {
        sendErrorJson(
          res,
          STATUS.conflict,
          ERROR_CODES.conflict,
          'request with this Idempotency-Key is still in progress',
          { ...rateHeaders, [HEADERS.retryAfter]: '1' },
        );
        return ctx;
      }
      if (begin.action === 'fingerprint-mismatch') {
        sendErrorJson(
          res,
          STATUS.unprocessableEntity,
          ERROR_CODES.idempotencyMismatch,
          'Idempotency-Key was already used with a different request payload',
          rateHeaders,
        );
        return ctx;
      }
      idemComplete = begin.complete;
      idemAbort = begin.abort;
    }

    // Circuit breaker (keyed per route+upstream)
    const breakerKey = `${route.prefix}|${upstream.url}`;
    if (route.circuitBreaker) {
      circuitBreaker.configure(breakerKey, route.circuitBreaker);
    }

    // ---- bounded GET/HEAD response cache (L1 + shared L2) ----
    const cacheCfg = route.cache;
    const cacheable =
      cacheCfg !== undefined && (method === 'GET' || method === 'HEAD');
    // no-store/private requests bypass lookup and store but still report MISS.
    // Contextual responses are never cached unless the route opts in.
    const useCache =
      cacheable &&
      !requestForbidsCache(req) &&
      (!hasGuardContext || cacheCfg?.allowContextual === true);
    let cache: ResponseCache | undefined;
    let cacheKey: string | undefined;
    if (useCache && cacheCfg) {
      cache = cacheFor(route, cacheCfg);
      // Vary on configured tags/headers; when allowContextual is set,
      // the full guard context is part of the key so contextual
      // responses can never leak across tag/header boundaries.
      let keySuffix = '';
      for (const tagKey of cacheCfg.varyTags ?? []) {
        const v = guardTags[tagKey];
        if (v !== undefined) keySuffix += `|t:${tagKey}=${v}`;
      }
      for (const headerName of prep?.varyHeaders ?? []) {
        const raw = req.headers[headerName];
        const v = Array.isArray(raw) ? raw[0] : raw;
        if (v !== undefined) keySuffix += `|h:${headerName}=${v}`;
      }
      if (cacheCfg.allowContextual === true) {
        for (const k of Object.keys(guardTags).sort()) {
          keySuffix += `|t:${k}=${guardTags[k] ?? ''}`;
        }
        for (const k of Object.keys(guardHeaders).sort()) {
          keySuffix += `|g:${k}=${guardHeaders[k] ?? ''}`;
        }
      }
      cacheKey = `${method} ${ctx.upstreamUrl}${keySuffix}`;
      const { fresh, stale } = await cache.lookupShared(cacheKey);
      if (fresh) {
        metrics.recordOutcome(route.prefix, 'cache_hit');
        replayCache(res, fresh, CACHE_STATUS.hit);
        return ctx;
      }
      if (
        stale &&
        cacheCfg.serveStaleOnCircuitOpen &&
        (await circuitBreaker.stateOfShared(breakerKey)) === CIRCUIT_STATES.open
      ) {
        metrics.recordOutcome(route.prefix, 'cache_hit');
        replayCache(res, stale, CACHE_STATUS.stale);
        return ctx;
      }
    }

    if (!(await circuitBreaker.canExecuteShared(breakerKey))) {
      metrics.recordOutcome(route.prefix, 'circuit_open');
      await config.hooks?.onCircuitOpen?.(ctx);
      sendErrorJson(
        res,
        STATUS.serviceUnavailable,
        ERROR_CODES.circuitOpen,
        'upstream circuit is open',
        rateHeaders,
      );
      return ctx;
    }

    const responseHeaders: Record<string, string> = {
      ...rateHeaders,
      ...(cacheable ? { [HEADERS.gatewayCache]: CACHE_STATUS.miss } : {}),
    };

    const hedgeCfg = route.hedging;
    // Hedge only idempotent traffic: safe methods, or any request
    // carrying an Idempotency-Key (upstream dedupes the duplicate).
    const hedgeIdempotent =
      method === 'GET' ||
      method === 'HEAD' ||
      method === 'OPTIONS' ||
      getHeaderString(req, HEADERS.idempotencyKey) !== null;
    const hedgeApplies =
      hedgeCfg?.enabled === true &&
      hedgeIdempotent &&
      route.upstreams.length > 1;

    const forwardTarget = (u: UpstreamTarget) => ({
      upstream: u,
      path,
      responseHeaders: Object.keys(responseHeaders).length ? responseHeaders : undefined,
      guardHeaders: Object.keys(guardHeaders).length > 0 ? guardHeaders : undefined,
      stripHeaders: prepStrip !== undefined && prepStrip.size > 0 ? prepStrip : undefined,
      ...(idemBody !== undefined ? { bodyOverride: idemBody } : {}),
      ...(config.upstreamSigning !== undefined
        ? {
            signing: {
              secret: config.upstreamSigning.secret,
              subject:
                config.upstreamSigning.subjectTag !== undefined
                  ? (guardTags[config.upstreamSigning.subjectTag] ?? '')
                  : '',
              subjectHeader:
                config.upstreamSigning.subjectHeader ?? HEADERS.gatewaySubject,
              ...(config.upstreamSigning.headerName !== undefined
                ? { headerName: config.upstreamSigning.headerName }
                : {}),
              ...(config.upstreamSigning.timestampHeader !== undefined
                ? { timestampHeader: config.upstreamSigning.timestampHeader }
                : {}),
            },
          }
        : {}),
    });

    interface FetchOutcome {
      info: UpstreamResponseInfo;
      used: UpstreamTarget;
    }

    const fetchOnce = async (
      u: UpstreamTarget,
      signal?: AbortSignal,
    ): Promise<FetchOutcome> => {
      const t0 = performance.now();
      loadBalancer.enter(u.url);
      try {
        const info = await proxy.forward(
          req,
          res,
          forwardTarget(u),
          {
            captureBody: useCache || idemComplete !== undefined,
            maxBodyBytes,
            maskErrors: config.maskUpstreamErrors === true,
            ...(signal !== undefined ? { signal } : {}),
          },
        );
        return { info, used: u };
      } finally {
        loadBalancer.leave(u.url, performance.now() - t0);
      }
    };

    /** Primary + speculative hedges; first fulfilled attempt wins. */
    const fetchUpstream = async (): Promise<FetchOutcome> => {
      if (!hedgeApplies || hedgeCfg === undefined) {
        return fetchOnce(upstream);
      }
      const ac = new AbortController();
      const maxHedges = hedgeCfg.maxHedges ?? 1;
      const delayMs = hedgeCfg.delayMs;
      const hedgeTimers = new Set<DeadlineTimer>();
      const clearHedgeTimers = (): void => {
        for (const t of hedgeTimers) t.clear();
        hedgeTimers.clear();
      };
      // Client going away must cancel pending hedge timers immediately —
      // otherwise a scheduled hedge fires into a dead response.
      const onClientGone = (): void => {
        if (!res.writableEnded) {
          ac.abort();
          clearHedgeTimers();
        }
      };
      res.once('close', onClientGone);
      const attempts: Promise<FetchOutcome>[] = [fetchOnce(upstream, ac.signal)];
      const tried = new Set<string>([upstream.url]);
      for (let i = 0; i < maxHedges; i += 1) {
        const candidates = route.upstreams.filter((u) => !tried.has(u.url));
        if (candidates.length === 0) break;
        const alt = loadBalancer.selectP2C(candidates);
        tried.add(alt.url);
        attempts.push(
          new Promise<FetchOutcome>((resolve, reject) => {
            const t = deadlineTimer(delayMs * (i + 1), () => {
              hedgeTimers.delete(t);
              if (ac.signal.aborted) {
                reject(new Error('hedge aborted'));
                return;
              }
              fetchOnce(alt, ac.signal).then(resolve, reject);
            });
            hedgeTimers.add(t);
          }),
        );
      }
      try {
        const winner = await Promise.any(attempts);
        ac.abort(); // kill losing attempts
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
        res.off('close', onClientGone);
      }
    };

    /**
     * Single upstream attempt: proxy → hooks → breaker → cache store.
     * Returns the stored cache entry (when one was written) so in-process
     * coalesced followers can replay it.
     */
    const performUpstream = async (): Promise<CacheEntry | undefined> => {
      try {
        const { info, used } = await fetchUpstream();
        const usedBreakerKey = `${route.prefix}|${used.url}`;
        await config.hooks?.onUpstreamResponse?.(ctx, info);

        // Idempotency: COMPLETED on non-5xx, release key on failure so
        // safe retries can proceed.
        if (idemComplete) {
          if (info.statusCode < 500) {
            await idemComplete({
              statusCode: info.statusCode,
              headers: info.headers,
              body: info.body ?? Buffer.alloc(0),
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
        if (
          cache &&
          cacheKey &&
          info.statusCode === STATUS.ok &&
          info.body !== undefined &&
          !responseForbidsCache(info.headers)
        ) {
          const entry: CacheEntry = {
            statusCode: info.statusCode,
            headers: storableHeaders(info.headers),
            body: info.body,
            storedAt: Date.now(),
          };
          await cache.setShared(cacheKey, entry);
          return entry;
        }
        return undefined;
      } catch (err) {
        await idemAbort?.();
        circuitBreaker.recordFailure(breakerKey);
        await config.hooks?.onUpstreamError?.(
          ctx,
          err instanceof Error ? err : new Error(String(err)),
        );
        await config.hooks?.onProxyError?.(
          ctx,
          err instanceof Error ? err : new Error(String(err)),
        );
        if (res.headersSent || res.writableEnded) {
          res.destroy();
          return undefined;
        }
        if (err instanceof PayloadTooLargeError) {
          sendErrorJson(
            res,
            STATUS.payloadTooLarge,
            ERROR_CODES.payloadTooLarge,
            'request body too large',
            rateHeaders,
          );
          return undefined;
        }
        const isTimeout = err instanceof UpstreamTimeoutError;
        metrics.recordOutcome(route.prefix, 'upstream_error');
        sendErrorJson(
          res,
          isTimeout ? STATUS.gatewayTimeout : STATUS.badGateway,
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : 'upstream error',
          rateHeaders,
        );
        return undefined;
      }
    };

    // ---- request coalescing: singleflight + cross-node lease ----
    const coalesceKey =
      useCache && cacheCfg?.coalesce !== false && cacheKey ? cacheKey : undefined;
    if (coalesceKey !== undefined && cache !== undefined) {
      const existing = coalescer.get<CacheEntry | undefined>(coalesceKey);
      if (existing !== undefined) {
        const entry = await existing;
        if (entry) {
          metrics.recordOutcome(route.prefix, 'cache_hit');
          replayCache(res, entry, CACHE_STATUS.hit, { [HEADERS.coalesced]: 'true' });
        } else {
          await performUpstream(); // leader failed — fetch ourselves
        }
        return ctx;
      }

      const isLeader = await coalescer.acquireLease(coalesceKey);
      if (!isLeader) {
        const shared = await coalescer.waitForShared(coalesceKey, () =>
          cache.lookupL2(coalesceKey),
        );
        if (shared) {
          metrics.recordOutcome(route.prefix, 'cache_hit');
          replayCache(res, shared, CACHE_STATUS.hit, { [HEADERS.coalesced]: 'true' });
          return ctx;
        }
        // Wait budget expired — proceed as an unfettered fetcher.
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

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  // Disable Nagle on client sockets — small error/health responses
  // shouldn't wait for ACK batching.
  server.on('connection', (socket) => {
    socket.setNoDelay(true);
  });
  // Aligned server-side socket hygiene for high concurrency.
  server.keepAliveTimeout = DEFAULTS.networking.serverKeepAliveTimeoutMs;
  server.headersTimeout = DEFAULTS.networking.serverHeadersTimeoutMs;
  server.requestTimeout = DEFAULTS.networking.serverRequestTimeoutMs;

  // ---- WebSocket / SSE upgrade tunnel (auth + RBAC + rate limit) ----
  const denyUpgrade = (
    socket: import('node:stream').Duplex,
    status: number,
    reason: string,
    code: string,
    message: string,
  ): void => {
    const body = JSON.stringify(defaultErrorBody(code, message));
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n` +
        'content-type: application/json\r\n' +
        `content-length: ${Buffer.byteLength(body)}\r\n` +
        'connection: close\r\n\r\n' +
        body,
    );
    socket.destroy();
  };

  async function handleUpgrade(
    req: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      if (draining) {
        denyUpgrade(socket, 503, 'Service Unavailable', ERROR_CODES.draining, 'server is draining');
        return;
      }
      const upgradeReq = req as TReq;
      const resolved = router.resolve(upgradeReq);
      if (!resolved) {
        denyUpgrade(socket, 404, 'Not Found', ERROR_CODES.noRoute, 'no matching route');
        return;
      }
      const { route, strippedPath } = resolved;

      const extractor = resolveExtractor(route, extractKey as ClientKeyExtractor<TReq>);
      const clientKey = await extractor(upgradeReq);
      const clientIp =
        (socket as import('node:net').Socket).remoteAddress ?? '';

      // Same edge-guard pipeline as HTTP (stateless, composable).
      const guardHeaders: Record<string, string> = {};
      const guardTags: Record<string, string> = {};
      const prepStrip = preparedRoutes.get(route)?.stripHeaders;
      const allGuards = [...(config.guards ?? []), ...(route.guards ?? [])];
      if (allGuards.length > 0) {
        const edgeCtx: EdgeRequestContext<TReq> = {
          req: upgradeReq,
          method: req.method ?? 'GET',
          path: pathnameOf(req.url),
          url: req.url,
          routePrefix: String(route.prefix),
          clientKey,
          clientIp,
          tags: guardTags,
          headers: guardHeaders,
        };
        for (const guard of allGuards) {
          const decision = await guard.evaluate(edgeCtx);
          if (decision.action === 'deny') {
            const reason =
              decision.status === 401 ? 'Unauthorized'
              : decision.status === 403 ? 'Forbidden'
              : decision.status === 429 ? 'Too Many Requests'
              : 'Denied';
            denyUpgrade(socket, decision.status, reason, decision.code, decision.message);
            return;
          }
          if (decision.headers) Object.assign(guardHeaders, decision.headers);
          if (decision.tags) Object.assign(guardTags, decision.tags);
        }
      }

      // Rate limit on upgrades too.
      if (route.rateLimit) {
        const result = await limiter.consume(`${route.prefix}:${clientKey}`, route.rateLimit);
        if (!result.allowed) {
          denyUpgrade(socket, 429, 'Too Many Requests', ERROR_CODES.rateLimited,
            'rate limit exceeded');
          return;
        }
      }

      const queryIndex = req.url?.indexOf('?') ?? -1;
      const query = queryIndex === -1 ? '' : req.url!.slice(queryIndex);
      const pathname = pathnameOf(req.url);
      const forwardPathname = route.stripPrefix === false ? pathname : strippedPath;
      const upstream =
        (route.upstreamStrategy ??
          (route.upstreams.length > 1 ? 'p2c' : 'weighted-rr')) === 'p2c'
          ? loadBalancer.selectP2C(route.upstreams)
          : router.nextUpstream(route.prefix, route.upstreams);
      loadBalancer.enter(upstream.url);
      try {
        proxyUpgrade(req, socket as import('node:net').Socket, head, upstream, {
          path: `${forwardPathname}${query}`,
          guardHeaders: Object.keys(guardHeaders).length > 0 ? guardHeaders : undefined,
          stripHeaders: prepStrip !== undefined && prepStrip.size > 0 ? prepStrip : undefined,
          ...(config.upgradeHandshakeTimeoutMs !== undefined
            ? { handshakeTimeoutMs: config.upgradeHandshakeTimeoutMs }
            : {}),
        });
      } finally {
        // in-flight counts connection setup only; tunnel lifetime is
        // bounded by socket close, not the upgrade handshake.
        loadBalancer.leave(upstream.url, 0);
      }
    } catch {
      socket.destroy();
    }
  }

  server.on('upgrade', (req, socket, head) => {
    activeTunnels.add(socket);
    socket.once('close', () => activeTunnels.delete(socket));
    void handleUpgrade(req, socket, head);
  });

  function listen(port = config.port ?? DEFAULTS.port, host = config.host ?? DEFAULTS.host) {
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  async function shutdown(options?: ShutdownOptions): Promise<void> {
    draining = true;
    shedder?.stop();
    // Destroy raw upgrade tunnels — they are outside server.close()'s
    // connection tracking and would otherwise leak past shutdown.
    for (const tunnel of activeTunnels) {
      destroySafely(tunnel);
    }
    activeTunnels.clear();
    // In-flight responses must not keep sockets alive past the drain.
    for (const res of activeResponses) {
      res.shouldKeepAlive = false;
    }

    const timeoutMs = options?.drainTimeoutMs ?? DEFAULTS.shutdown.drainTimeoutMs;
    if (activeRequests > 0) {
      await Promise.race([
        new Promise<void>((resolve) => {
          drainNotify = () => {
            if (activeRequests === 0) resolve();
          };
          if (activeRequests === 0) resolve();
        }),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, timeoutMs);
          t.unref?.();
        }),
      ]);
    }
    drainNotify = undefined;

    if (server.listening) {
      const closed = new Promise<void>((resolve) => {
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
    get router() {
      return router;
    },
    limiter,
    circuitBreaker,
    metrics,
    reloadRoutes(next: RoutesInput<TReq> | RouteReloadConfig<TReq>): void {
      // Options-object form shares the boot pipeline: target/autoRoutes/
      // global defaults resolve identically; config.basePrefix always applies.
      const normalized = isRouteReloadConfig(next)
        ? assembleRoutes<TReq>({
            routes: next.routes,
            target: next.target ?? config.target,
            rateLimit: next.rateLimit ?? config.rateLimit,
            circuitBreaker: next.circuitBreaker ?? config.circuitBreaker,
            cache: next.cache ?? config.cache,
            autoRoutes: next.autoRoutes ?? config.autoRoutes,
            basePrefix: config.basePrefix,
          })
        : assembleRoutes<TReq>({
            // Guard returned false → `next` is RoutesInput, not options.
            routes: next as RoutesInput<TReq>,
            basePrefix: config.basePrefix,
          });
      if (normalized.length === 0) {
        throw new Error(
          '[gateway] reloadRoutes produced an empty route table — refusing to drop all routes.',
        );
      }
      assertNoMetadataUpstreams(
        normalized.flatMap((r) => r.upstreams.map((u) => u.url)),
        config.allowMetadataUpstreams === true,
      );
      routeTable = withMetricsRoute(normalized);
      router = new Router<TReq>(routeTable);
      buildPreparedRoutes(routeTable);
    },
    listen,
    listenCluster(portOrOptions?: number | ClusterOptions, workerCount?: number) {
      // listenCluster(port?, workerCount?) or listenCluster({workers, respawnDelayMs}).
      // Cluster workers share the listen() port via node:cluster; a
      // numeric first arg is accepted for signature compatibility.
      const options: ClusterOptions = {
        ...(typeof portOrOptions === 'object' ? portOrOptions : {}),
        ...(workerCount !== undefined ? { workers: workerCount } : {}),
      };
      return runCluster(
        { listen, shutdown, close: () => shutdown() },
        options,
      );
    },
    poolMetrics() {
      const sockets = proxy.poolMetrics();
      const out: Record<string, UpstreamPoolMetrics> = {};
      const seen = new Set<string>();
      for (const route of routeTable) {
        for (const u of route.upstreams) {
          if (seen.has(u.url)) continue;
          seen.add(u.url);
          try {
            const origin = new URL(u.url).origin;
            const s = sockets[origin] ?? {
              activeSockets: 0,
              freeSockets: 0,
              queuedRequests: 0,
            };
            out[u.url] = {
              ...s,
              inFlight: loadBalancer.statsOf(u.url).inFlight,
            };
          } catch {
            out[u.url] = {
              activeSockets: 0,
              freeSockets: 0,
              queuedRequests: 0,
              inFlight: loadBalancer.statsOf(u.url).inFlight,
            };
          }
        }
      }
      return out;
    },
    shutdown,
    close() {
      return shutdown();
    },
  };
}

export type { RouteConfig, UpstreamTarget, RequestContext, GatewayResponse };
