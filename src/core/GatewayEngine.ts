import http from 'node:http';
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
  ApiKeyRecord,
  AuthConfig,
  AuthProvider,
  ClientKeyExtractor,
  GatewayConfig,
  GatewayResponse,
  RequestContext,
  RouteCacheConfig,
  RouteConfig,
  UpstreamTarget,
  VerifiedIdentity,
} from '../types.js';
import { extractClientIp, getHeaderString, resolveExtractor } from '../utils/extractors.js';
import { defaultErrorBody, secondsUntil, sendGatewayResponse, sendJson } from '../utils/http.js';
import { RedisRateLimiter } from '../limiter/RedisRateLimiter.js';
import { InMemoryRedis } from '../limiter/InMemoryRedis.js';
import { ResponseCache } from '../cache/ResponseCache.js';
import type { CacheEntry } from '../cache/ResponseCache.js';
import { loadRoutesDirSync } from '../routing/RouteLoader.js';
import { createJwtProvider } from '../auth/providers.js';
import { ApiKeyGuard } from '../security/ApiKeyGuard.js';
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
}

const isGatewayResponse = (v: unknown): v is GatewayResponse =>
  typeof v === 'object' && v !== null && 'statusCode' in v;

const HOP_BY_HOP = new Set<string>(HOP_BY_HOP_HEADERS);
const CACHE_EXCLUDED_HEADERS = new Set<string>([
  HEADERS.gatewayCache,
  HEADERS.rateLimitLimit,
  HEADERS.rateLimitRemaining,
  HEADERS.rateLimitReset,
  'x-gateway',
]);

function identityToHeaders(
  identity: VerifiedIdentity | undefined,
): Record<string, string> | undefined {
  if (!identity) return undefined;
  const headers: Record<string, string> = { [HEADERS.userId]: identity.userId };
  if (identity.roles.length > 0) headers[HEADERS.userRole] = identity.roles.join(',');
  return headers;
}

function authRequired<TReq extends IncomingMessage>(route: RouteConfig<TReq>): boolean {
  return route.auth !== undefined && route.auth !== false;
}

function validateAuthConfig<TReq extends IncomingMessage>(
  auth: AuthConfig | undefined,
  routes: readonly RouteConfig<TReq>[],
): void {
  if (!auth) return;
  const needsAuth = routes.some(authRequired);
  const hasProviders = auth.jwt !== undefined || (auth.providers?.length ?? 0) > 0;
  if (needsAuth && !hasProviders) {
    throw new Error(
      '[gateway] One or more routes set `auth`, but no auth provider is configured. ' +
        'Set auth.jwt, auth.providers, or use a GatewayPlugin for custom auth.',
    );
  }
}

function requestForbidsCache(req: IncomingMessage): boolean {
  const cc = getHeaderString(req, HEADERS.cacheControl)?.toLowerCase() ?? '';
  return cc.includes('no-store') || cc.includes('private');
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
  const routes =
    config.routes ??
    (config.routesDir ? loadRoutesDirSync<TReq>(config.routesDir) : []);

  validateAuthConfig(config.auth, routes);

  // ---- boot-time perimeter validation (fail fast) ----
  assertNoMetadataUpstreams(
    routes.flatMap((r) => r.upstreams.map((u) => u.url)),
    config.allowMetadataUpstreams === true,
  );
  if (config.cors) assertValidCors(config.cors);
  if (config.upstreamSigning !== undefined && config.upstreamSigning.secret.length === 0) {
    throw new Error('[gateway] upstreamSigning.secret must not be empty.');
  }

  const router = new Router<TReq>(routes);
  const limiter = new RedisRateLimiter(config.limiter);

  const apiKeyGuard = config.apiKeys ? new ApiKeyGuard(config.apiKeys) : undefined;
  // Auth provider chain: custom providers first, then the JWT shorthand.
  const authProviders: AuthProvider<TReq>[] = [
    ...(config.auth?.providers ?? []),
    ...(config.auth?.jwt !== undefined
      ? [createJwtProvider<TReq>(config.auth.jwt)]
      : []),
  ];
  const securityStore = config.limiter?.redis ?? new InMemoryRedis();
  const bruteForceGuard = config.bruteForce
    ? new BruteForceGuard(securityStore, config.bruteForce)
    : undefined;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULTS.perimeter.maxBodyBytes;
  const plugins = config.plugins ?? [];

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
  const circuitBreaker = new CircuitBreaker();
  const proxy = new ProxyHandler({
    timeoutMs: config.upstreamTimeoutMs ?? DEFAULTS.proxy.upstreamTimeoutMs,
    maxSockets: config.maxSockets ?? DEFAULTS.proxy.maxSockets,
  });
  const startedAt = Date.now();

  // Per-route response caches (created lazily, bounded LRU).
  const caches = new WeakMap<RouteConfig<TReq>, ResponseCache>();
  const cacheFor = (route: RouteConfig<TReq>, cfg: RouteCacheConfig): ResponseCache => {
    let cache = caches.get(route);
    if (!cache) {
      cache = new ResponseCache(cfg.ttlMs, cfg.maxEntries ?? DEFAULTS.cache.maxEntries);
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

  function notifyDrained(): void {
    if (activeRequests === 0) drainNotify?.();
  }

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (draining) {
      sendJson(
        res,
        STATUS.serviceUnavailable,
        defaultErrorBody(ERROR_CODES.draining, 'server is draining'),
        {
          [HEADERS.connection]: 'close',
          [HEADERS.retryAfter]: String(DEFAULTS.shutdown.retryAfterSeconds),
        },
      );
      return;
    }

    activeRequests += 1;
    activeResponses.add(res);
    res.on('close', () => activeResponses.delete(res));
    try {
      await pipeline(req as TReq, res);
    } catch (err) {
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, STATUS.badGateway, defaultErrorBody(
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : 'internal error',
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

  function replayCache(res: ServerResponse, entry: CacheEntry, status: string): void {
    res.writeHead(entry.statusCode, {
      ...entry.headers,
      [HEADERS.gatewayCache]: status,
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
    const circuitsOk = routes.every((route) =>
      route.upstreams.some(
        (u) => circuitBreaker.stateOf(`${route.prefix}|${u.url}`) !== CIRCUIT_STATES.open,
      ),
    );
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
      sendJson(res, 400, defaultErrorBody(
        ERROR_CODES.pathTraversalBlocked, 'malformed request path',
      ));
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
        sendJson(
          res,
          STATUS.locked,
          defaultErrorBody(ERROR_CODES.locked, 'too many failed authentication attempts'),
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
      sendJson(res, 404, defaultErrorBody(ERROR_CODES.noRoute, 'no matching route'));
      return undefined;
    }
    const { route, strippedPath } = resolved;

    // ---- content-type enforcement ----
    if (route.allowedContentTypes && !contentTypeAllowed(req, route.allowedContentTypes)) {
      sendJson(res, STATUS.unsupportedMediaType, defaultErrorBody(
        ERROR_CODES.unsupportedMediaType, 'unsupported content type',
      ));
      return undefined;
    }

    const denyAuth = async (
      statusCode: number,
      code: string,
      message: string,
      extraHeaders?: Record<string, string>,
    ): Promise<undefined> => {
      if (bruteForceGuard) await bruteForceGuard.recordFailure(clientIp);
      emitSecurity(SECURITY_EVENT_TYPES.authDenied, message, clientIp, pathname);
      sendJson(res, statusCode, defaultErrorBody(code, message), extraHeaders);
      return undefined;
    };

    // ---- pluggable stateless authentication ----
    let identity: VerifiedIdentity | undefined;
    if (authProviders.length > 0 && authRequired(route)) {
      let deniedReason: string | undefined;
      for (const provider of authProviders) {
        const outcome = await provider.authenticate(req);
        if ('authenticated' in outcome) {
          if (outcome.authenticated) {
            identity = outcome.identity;
            break;
          }
          deniedReason = outcome.reason ?? 'authentication failed';
          break;
        }
        // { skip: true } → try the next provider
      }
      if (identity === undefined) {
        const realm = config.auth?.realm;
        return denyAuth(
          STATUS.unauthorized,
          ERROR_CODES.unauthorized,
          deniedReason ?? 'authentication required',
          {
            [HEADERS.wwwAuthenticate]: realm
              ? `Bearer realm="${realm}"`
              : 'Bearer',
          },
        );
      }
      const verified = identity;
      if (Array.isArray(route.auth) && route.auth.length > 0) {
        const allowed = route.auth.some((role) => verified.roles.includes(role));
        if (!allowed) {
          return denyAuth(
            STATUS.forbidden,
            ERROR_CODES.forbidden,
            'insufficient role',
          );
        }
      }
      if (bruteForceGuard) await bruteForceGuard.recordSuccess(clientIp);
    }

    // ---- scoped API keys ----
    let apiKeyRecord: ApiKeyRecord | undefined;
    if (apiKeyGuard && route.requiredScopes !== undefined) {
      const result = await apiKeyGuard.authenticate(req, route);
      if (!result.ok) {
        const status = result.reason === 'forbidden' ? STATUS.forbidden : STATUS.unauthorized;
        const code = result.reason === 'forbidden' ? ERROR_CODES.forbidden : ERROR_CODES.apiKeyInvalid;
        if (bruteForceGuard) await bruteForceGuard.recordFailure(clientIp);
        emitSecurity(SECURITY_EVENT_TYPES.apiKeyDenied, result.reason, clientIp, pathname);
        sendJson(res, status, defaultErrorBody(code, `api key ${result.reason}`));
        return undefined;
      }
      apiKeyRecord = result.record;
      if (bruteForceGuard) await bruteForceGuard.recordSuccess(clientIp);
    }

    const extractor = resolveExtractor(route, extractKey as ClientKeyExtractor<TReq>);
    const clientKey = await extractor(req);
    const upstream = router.nextUpstream(route.prefix, route.upstreams);

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
      upstreamPath: forwardPathname,
      upstreamUrl: `${upstream.url}${path}`,
      ...(identity !== undefined ? { identity } : {}),
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
        sendJson(
          res,
          decision.statusCode ?? STATUS.forbidden,
          defaultErrorBody(
            decision.code ?? ERROR_CODES.policyDenied,
            decision.message ?? 'request denied by policy',
          ),
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
    const effectiveRateLimit = apiKeyRecord?.rateLimitOverride ?? route.rateLimit;
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
      };
      if (!result.allowed) {
        sendJson(
          res,
          STATUS.tooManyRequests,
          defaultErrorBody(ERROR_CODES.rateLimited, 'rate limit exceeded'),
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

    // Circuit breaker (keyed per route+upstream)
    const breakerKey = `${route.prefix}|${upstream.url}`;
    if (route.circuitBreaker) {
      circuitBreaker.configure(breakerKey, route.circuitBreaker);
    }

    // ---- bounded GET/HEAD response cache ----
    const method = req.method ?? 'GET';
    const cacheCfg = route.cache;
    const cacheable =
      cacheCfg !== undefined && (method === 'GET' || method === 'HEAD');
    // no-store/private requests bypass lookup and store but still report MISS.
    // Authenticated responses are never cached unless the route opts in.
    const useCache =
      cacheable &&
      !requestForbidsCache(req) &&
      (identity === undefined || cacheCfg?.allowAuthenticated === true);
    let cache: ResponseCache | undefined;
    let cacheKey: string | undefined;
    if (useCache && cacheCfg) {
      cache = cacheFor(route, cacheCfg);
      cacheKey = `${method} ${ctx.upstreamUrl}`;
      const { fresh, stale } = cache.lookup(cacheKey);
      if (fresh) {
        replayCache(res, fresh, CACHE_STATUS.hit);
        return ctx;
      }
      if (
        stale &&
        cacheCfg.serveStaleOnCircuitOpen &&
        circuitBreaker.stateOf(breakerKey) === CIRCUIT_STATES.open
      ) {
        replayCache(res, stale, CACHE_STATUS.stale);
        return ctx;
      }
    }

    if (!circuitBreaker.canExecute(breakerKey)) {
      sendJson(
        res,
        STATUS.serviceUnavailable,
        defaultErrorBody(ERROR_CODES.circuitOpen, 'upstream circuit is open'),
        rateHeaders,
      );
      return ctx;
    }

    const responseHeaders: Record<string, string> = {
      ...rateHeaders,
      ...(cacheable ? { [HEADERS.gatewayCache]: CACHE_STATUS.miss } : {}),
    };

    try {
      const info = await proxy.forward(
        req,
        res,
        {
          upstream,
          path,
          responseHeaders: Object.keys(responseHeaders).length ? responseHeaders : undefined,
          identityHeaders: identityToHeaders(identity),
          stripHeaders: config.auth?.stripHeaders,
          ...(config.upstreamSigning !== undefined
            ? {
                signing: {
                  secret: config.upstreamSigning.secret,
                  userId: identity?.userId ?? '',
                  ...(config.upstreamSigning.headerName !== undefined
                    ? { headerName: config.upstreamSigning.headerName }
                    : {}),
                  ...(config.upstreamSigning.timestampHeader !== undefined
                    ? { timestampHeader: config.upstreamSigning.timestampHeader }
                    : {}),
                },
              }
            : {}),
        },
        {
          captureBody: useCache,
          maxBodyBytes,
          maskErrors: config.maskUpstreamErrors === true,
        },
      );
      await config.hooks?.onUpstreamResponse?.(ctx, info);
      if (info.statusCode >= 500) {
        circuitBreaker.recordFailure(breakerKey);
      } else {
        circuitBreaker.recordSuccess(breakerKey);
      }
      if (
        cache &&
        cacheKey &&
        info.statusCode === STATUS.ok &&
        info.body !== undefined &&
        !responseForbidsCache(info.headers)
      ) {
        cache.set(cacheKey, {
          statusCode: info.statusCode,
          headers: storableHeaders(info.headers),
          body: info.body,
        });
      }
    } catch (err) {
      circuitBreaker.recordFailure(breakerKey);
      await config.hooks?.onUpstreamError?.(
        ctx,
        err instanceof Error ? err : new Error(String(err)),
      );
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return ctx;
      }
      if (err instanceof PayloadTooLargeError) {
        sendJson(
          res,
          STATUS.payloadTooLarge,
          defaultErrorBody(ERROR_CODES.payloadTooLarge, 'request body too large'),
          rateHeaders,
        );
        return ctx;
      }
      const isTimeout = err instanceof UpstreamTimeoutError;
      sendJson(
        res,
        isTimeout ? STATUS.gatewayTimeout : STATUS.badGateway,
        defaultErrorBody(
          ERROR_CODES.upstreamError,
          err instanceof Error ? err.message : 'upstream error',
        ),
        rateHeaders,
      );
    }
    return ctx;
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function shutdown(options?: ShutdownOptions): Promise<void> {
    draining = true;
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
    router,
    limiter,
    circuitBreaker,
    listen(port = config.port ?? DEFAULTS.port, host = config.host ?? DEFAULTS.host) {
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    shutdown,
    close() {
      return shutdown();
    },
  };
}

export type { RouteConfig, UpstreamTarget, RequestContext, GatewayResponse };
