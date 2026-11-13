import type { IncomingMessage } from 'node:http';
import { DEFAULTS, FAIL_MODES } from './constants.js';
import { createGateway } from './core/GatewayEngine.js';
import { InMemoryRedis } from './limiter/InMemoryRedis.js';
import { parseRateLimit } from './routing/dsl.js';
import type { Gateway } from './core/GatewayEngine.js';
import type {
  GatewayConfig,
  RateLimitInput,
  RateLimitRule,
  RedisLike,
  RouteConfig,
  RouteInput,
  RoutePrefix,
  UpstreamTarget,
  UpstreamUrl,
} from './types.js';

/**
 * Beginner-friendly layer: sensible defaults, plain-object routes, and an
 * automatic in-memory Redis-compatible limiter so `startGateway()` works
 * with zero infrastructure.
 *
 * Route paths and upstream URLs are validated as template-literal types
 * (`` `/${string}` ``, `` `http://${string}` ``) — plain literals work
 * without any branding helpers.
 */

export interface SimpleRateLimit {
  /** Sustained requests allowed per minute. Default 60. */
  readonly requestsPerMinute?: number;
  /** Burst capacity (max tokens). Defaults to requestsPerMinute. */
  readonly burst?: number;
}

export type SimpleUpstream =
  | `http://${string}`
  | `https://${string}`
  | readonly (`http://${string}` | `https://${string}`)[];

export interface SimpleRoute {
  readonly path: `/${string}`;
  readonly to: SimpleUpstream;
  readonly stripPrefix?: boolean;
  /** Per-route override (requests/minute). Falls back to global rateLimit. */
  readonly limitPerMinute?: number;
}

export type SimpleRouteMap = Readonly<
  Record<`/${string}`, `http://${string}` | `https://${string}` | readonly (`http://${string}` | `https://${string}`)[]>
>;

export interface QuickGatewayOptions<TReq extends IncomingMessage = IncomingMessage>
  extends Omit<GatewayConfig<TReq>, 'routes' | 'limiter' | 'rateLimit'> {
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
  readonly routes?:
    | SimpleRouteMap
    | readonly SimpleRoute[]
    | readonly RouteInput<TReq>[];
  /**
   * Global rate limit — `{ requestsPerMinute, burst? }` or any
   * `RateLimitInput` (`{ capacity, refillPerSecond }` / `'600/min'`).
   * Default: 60 requests/minute, burst 60.
   */
  readonly rateLimit?: SimpleRateLimit | RateLimitInput;
  /** Auto per-route circuit breaker. Default true. */
  readonly autoCircuitBreaker?: boolean;
}

function rpmToRule(rpm: number, burst?: number): RateLimitRule {
  return {
    capacity: burst ?? rpm,
    refillPerSecond: rpm / 60,
  };
}

/** Normalize every accepted rateLimit shape to a concrete RateLimitRule. */
function toRateLimitRule(
  rl: SimpleRateLimit | RateLimitInput | undefined,
): RateLimitRule {
  if (rl === undefined) {
    return rpmToRule(DEFAULTS.quickstart.requestsPerMinute);
  }
  if (typeof rl === 'string') return parseRateLimit(rl);
  if ('capacity' in rl) return rl; // already a RateLimitRule
  return rpmToRule(
    rl.requestsPerMinute ?? DEFAULTS.quickstart.requestsPerMinute,
    rl.burst,
  );
}

function toTargets(
  to: SimpleUpstream,
): readonly [UpstreamTarget, ...UpstreamTarget[]] {
  const list = Array.isArray(to) ? to : [to];
  const targets = list.map((url) => ({ url: url as UpstreamUrl }));
  return targets as [UpstreamTarget, ...UpstreamTarget[]];
}

function normalizeRoutes<TReq extends IncomingMessage>(
  input: NonNullable<QuickGatewayOptions<TReq>['routes']>,
  globalRule: RateLimitRule,
  autoCircuitBreaker: boolean,
): RouteInput<TReq>[] {
  const autoCb = autoCircuitBreaker
    ? ({
        failureThreshold: DEFAULTS.autoCircuitBreaker.minimumRequests,
        successThreshold: DEFAULTS.autoCircuitBreaker.successThreshold,
        openDurationMs: DEFAULTS.autoCircuitBreaker.resetTimeoutMs,
        probeTimeoutMs: DEFAULTS.autoCircuitBreaker.probeTimeoutMs,
        failureRatioThreshold: DEFAULTS.autoCircuitBreaker.failureThreshold,
        minimumRequests: DEFAULTS.autoCircuitBreaker.minimumRequests,
      } as const)
    : undefined;

  const build = (
    path: string,
    to: SimpleUpstream,
    stripPrefix: boolean | undefined,
    limitPerMinute: number | undefined,
  ): RouteConfig<TReq> => {
    const route: RouteConfig<TReq> = {
      prefix: path as RoutePrefix,
      upstreams: toTargets(to),
    };
    if (stripPrefix !== undefined) route.stripPrefix = stripPrefix;
    if (limitPerMinute !== undefined) {
      route.rateLimit = rpmToRule(limitPerMinute);
    } else {
      route.rateLimit = globalRule;
    }
    if (autoCb !== undefined) route.circuitBreaker = { ...autoCb };
    return route;
  };

  if (Array.isArray(input)) {
    // Route-config items (route()/group()/asProtection output — anything
    // carrying prefix/upstreams/guards) pass through untouched; the
    // engine's own normalizer validates them. SimpleRoute items get the
    // beginner defaults (global rate limit + auto circuit breaker).
    return input.map((r) => {
      const rec = r as Record<string, unknown>;
      if (
        typeof rec === 'object' &&
        rec !== null &&
        ('prefix' in rec || 'upstreams' in rec || 'guards' in rec)
      ) {
        return rec as unknown as RouteInput<TReq>;
      }
      const sr = r as SimpleRoute;
      return build(sr.path, sr.to, sr.stripPrefix, sr.limitPerMinute);
    });
  }

  return Object.entries(input).map(([path, to]) =>
    build(path, to, undefined, undefined),
  );
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
export function startGateway<TReq extends IncomingMessage = IncomingMessage>(
  options: QuickGatewayOptions<TReq>,
): Gateway<TReq> {
  const globalRule = toRateLimitRule(options.rateLimit);
  const autoCircuitBreaker = options.autoCircuitBreaker ?? true;

  const routes =
    options.routes === undefined
      ? undefined
      : normalizeRoutes(options.routes, globalRule, autoCircuitBreaker);

  const { routes: _routes, rateLimit: _rl, autoCircuitBreaker: _acb, redis, ...rest } = options;

  return createGateway<TReq>({
    ...rest,
    ...(routes !== undefined ? { routes } : {}),
    // Applies to the `target` catch-all route; ignored when routes are set.
    rateLimit: globalRule,
    limiter: {
      redis: redis ?? new InMemoryRedis(),
      failMode: FAIL_MODES.fallback,
    },
  });
}
