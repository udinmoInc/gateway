import type {
  AutoRoutesConfig,
  CacheInput,
  CircuitBreakerInput,
  CircuitBreakerOptions,
  DurationString,
  MappedRouteConfig,
  RateLimitInput,
  RateLimitRule,
  RateLimitString,
  RouteCacheConfig,
  RouteConfig,
  RouteInput,
  RouteMapInput,
  RouteReloadConfig,
  RouteShorthandFields,
  RoutesInput,
  UpstreamInput,
} from '../types.js';
import type { IncomingMessage } from 'node:http';
import {
  normalizePrefix,
  parseCacheInput,
  parseDurationMs,
  parseRateLimit,
} from './dsl.js';
import { asRoutePrefix, toUpstreamTargets } from '../shared/httpUtils.js';

/**
 * Boundary normalizer: accepts every ergonomic route shape
 * (RouteConfig, {prefix,...}, {path,to,...}, route maps) and produces
 * strict RouteConfig[] with branded types — all validation happens
 * here, once, at boot/reload time.
 */

/** Loose view over any accepted route item — every field re-validated. */
interface RawRoute<TReq extends IncomingMessage>
  extends Omit<RouteShorthandFields<TReq>, 'rateLimit' | 'circuitBreaker' | 'cache'> {
  prefix?: unknown;
  path?: unknown;
  upstreams?: unknown;
  to?: unknown;
  rateLimit?: unknown;
  circuitBreaker?: unknown;
  cache?: unknown;
}

function normalizeRateLimit(input: unknown): RateLimitRule {
  if (typeof input === 'string') {
    // Regex-validated inside parseRateLimit.
    return parseRateLimit(input as RateLimitString);
  }
  if (typeof input === 'object' && input !== null) {
    const rule = input as RateLimitRule;
    if (
      typeof rule.capacity === 'number' &&
      Number.isFinite(rule.capacity) &&
      rule.capacity > 0 &&
      typeof rule.refillPerSecond === 'number' &&
      Number.isFinite(rule.refillPerSecond) &&
      rule.refillPerSecond > 0
    ) {
      return rule;
    }
  }
  throw new Error(
    "[gateway] invalid rateLimit — expected a RateLimitRule or a string like '600/min'.",
  );
}

function normalizeCache(input: unknown): RouteCacheConfig {
  if (typeof input === 'number') return parseCacheInput(input);
  if (typeof input === 'string') {
    return parseCacheInput(input as DurationString);
  }
  if (typeof input === 'object' && input !== null) {
    return parseCacheInput(input as RouteCacheConfig);
  }
  throw new Error("[gateway] invalid cache — expected ttl ms, '30s', or RouteCacheConfig.");
}

function normalizeCircuitBreaker(
  input: unknown,
): Partial<CircuitBreakerOptions> | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'object' || input === null) {
    throw new Error('[gateway] invalid circuitBreaker — expected an options object.');
  }
  const { openDurationMs, ...rest } = input as CircuitBreakerOptions & {
    openDurationMs?: number | DurationString;
  };
  const cb: Partial<CircuitBreakerOptions> = { ...rest };
  if (openDurationMs !== undefined) {
    cb.openDurationMs = parseDurationMs(openDurationMs);
  }
  return cb;
}

/** Normalize one route item (any accepted shape) → strict RouteConfig. */
export function normalizeRoute<TReq extends IncomingMessage = IncomingMessage>(
  item: RouteInput<TReq>,
): RouteConfig<TReq> {
  const raw: RawRoute<TReq> = item;

  const pathValue = raw.path ?? raw.prefix;
  if (typeof pathValue !== 'string' || pathValue.length === 0) {
    throw new Error("[gateway] route requires a 'prefix' or 'path' starting with '/'.");
  }
  const upstreamInput = raw.upstreams ?? raw.to;
  if (upstreamInput === undefined) {
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

  const route: RouteConfig<TReq> = {
    prefix: asRoutePrefix(normalizePrefix(pathValue)),
    upstreams: toUpstreamTargets(upstreamInput),
    ...rest,
  };
  if (raw.rateLimit !== undefined) route.rateLimit = normalizeRateLimit(raw.rateLimit);
  const cb = normalizeCircuitBreaker(raw.circuitBreaker);
  if (cb !== undefined) route.circuitBreaker = cb;
  if (raw.cache !== undefined) route.cache = normalizeCache(raw.cache);
  return route;
}

/**
 * Normalize the full `routes` option: array of any route shape, or a
 * plain object map `{ '/api': 'http://host' }`.
 */
export function normalizeRoutes<TReq extends IncomingMessage = IncomingMessage>(
  input: RoutesInput<TReq> | undefined,
): RouteConfig<TReq>[] | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'object' || input === null) {
    throw new Error('[gateway] routes must be an array or an object map.');
  }
  if (Array.isArray(input)) {
    return input.map((item) => normalizeRoute<TReq>(item));
  }
  const map = input as RouteMapInput;
  return Object.entries(map).map(([prefix, to]) =>
    normalizeRoute<TReq>({ prefix, upstreams: to } as MappedRouteConfig<TReq>),
  );
}

/**
 * Prepend `basePrefix` to every route prefix, joining cleanly:
 *   base '/api' + '/users' → '/api/users';  base '/api' + '/' → '/api'.
 * A base of '/' (or undefined) is a no-op.
 */
export function applyBasePrefix<TReq extends IncomingMessage = IncomingMessage>(
  routes: readonly RouteConfig<TReq>[],
  basePrefix: string | undefined,
): RouteConfig<TReq>[] {
  if (basePrefix === undefined) return [...routes];
  const base = normalizePrefix(basePrefix);
  if (base === '/') return [...routes];
  return routes.map((r) => {
    const prefix = String(r.prefix);
    const joined = prefix === '/' ? base : `${base}${prefix}`;
    return { ...r, prefix: asRoutePrefix(joined) };
  });
}

const DEFAULT_ENV_PREFIX = 'GATEWAY_';

/**
 * Auto-discover routes from environment variables:
 *   GATEWAY_USERS=4001            → /users  → http://localhost:4001
 *   GATEWAY_ORDER_ITEMS=orders:2  → /order-items → http://orders:2
 * `basePrefix` is applied by the caller (applyBasePrefix runs after).
 */
export function autoRoutesFromEnv<
  TReq extends IncomingMessage = IncomingMessage,
>(config: AutoRoutesConfig | undefined): RouteConfig<TReq>[] {
  if (config === undefined) return [];
  const env = config.env ?? process.env;
  const envPrefix = config.envPrefix ?? DEFAULT_ENV_PREFIX;
  const out: RouteConfig<TReq>[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === '') continue;
    if (!key.startsWith(envPrefix)) continue;
    const suffix = key
      .slice(envPrefix.length)
      .toLowerCase()
      .replace(/_+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (suffix === '') continue;
    out.push(
      normalizeRoute<TReq>({ prefix: `/${suffix}`, upstreams: value }),
    );
  }
  return out;
}

/** Everything needed to assemble a route table — shared by boot & reload. */
export interface RouteAssemblyInput<
  TReq extends IncomingMessage = IncomingMessage,
> {
  routes?: RoutesInput<TReq> | undefined;
  /** Pre-loaded routesDir output (already RouteConfig[]). */
  dirRoutes?: readonly RouteConfig<TReq>[] | undefined;
  target?: UpstreamInput | undefined;
  rateLimit?: RateLimitInput | undefined;
  circuitBreaker?: CircuitBreakerInput | undefined;
  cache?: CacheInput | undefined;
  basePrefix?: string | undefined;
  autoRoutes?: AutoRoutesConfig | undefined;
}

/**
 * Single assembly pipeline used identically at boot and on reload:
 * explicit routes → routesDir → autoRoutes env discovery → `target`
 * catch-all (only when nothing else produced routes) → basePrefix.
 */
export function assembleRoutes<TReq extends IncomingMessage = IncomingMessage>(
  input: RouteAssemblyInput<TReq>,
): RouteConfig<TReq>[] {
  const explicit =
    normalizeRoutes(input.routes) ?? [...(input.dirRoutes ?? [])];
  const routes = [...explicit, ...autoRoutesFromEnv<TReq>(input.autoRoutes)];
  if (routes.length === 0 && input.target !== undefined) {
    const def: MappedRouteConfig<TReq> = {
      prefix: '/',
      upstreams: input.target,
    };
    if (input.rateLimit !== undefined) def.rateLimit = input.rateLimit;
    if (input.circuitBreaker !== undefined) {
      def.circuitBreaker = input.circuitBreaker;
    }
    if (input.cache !== undefined) def.cache = input.cache;
    routes.push(normalizeRoute<TReq>(def));
  }
  return applyBasePrefix(routes, input.basePrefix);
}

const RELOAD_OPTION_KEYS = new Set([
  'routes',
  'target',
  'rateLimit',
  'circuitBreaker',
  'cache',
  'autoRoutes',
]);

/**
 * Distinguish a RouteReloadConfig options object from a plain
 * RoutesInput (array or '/'-prefixed route map). Route-map keys always
 * start with '/', so option names can never collide.
 */
export function isRouteReloadConfig(
  value: unknown,
): value is RouteReloadConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).some((k) => RELOAD_OPTION_KEYS.has(k));
}
