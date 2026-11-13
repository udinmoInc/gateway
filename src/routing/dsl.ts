import type {
  CacheInput,
  CircuitBreakerInput,
  CircuitBreakerOptions,
  ClientKeyExtractor,
  DurationString,
  EdgeGuard,
  RateLimitInput,
  RateLimitRule,
  RateLimitString,
  RouteCacheConfig,
  RouteConfig,
  RoutePrefix,
  UpstreamInput,
  UpstreamTarget,
} from '../types.js';
import type { IncomingMessage } from 'node:http';
import { toUpstreamTargets } from '../shared/httpUtils.js';

// Canonical shorthand types live in types.ts — re-exported here so
// existing `from './routing/dsl.js'` imports keep working.
export type {
  CacheInput,
  DurationString,
  RateLimitInput,
  RateLimitString,
  UpstreamInput,
} from '../types.js';

const RATE_LIMIT_RE = /^(\d+(?:\.\d+)?)\/(sec|min|hour)$/;
const UNIT_SECONDS: Record<string, number> = { sec: 1, min: 60, hour: 3600 };
const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse '60/sec' | '120/min' | '1000/hour' → token bucket rule. Throws on malformed input. */
export function parseRateLimit(input: RateLimitInput): RateLimitRule {
  if (typeof input !== 'string') return input;
  const match = RATE_LIMIT_RE.exec(input);
  if (!match) {
    throw new Error(
      `[gateway] Invalid rate limit "${input}". Expected '<n>/sec' | '<n>/min' | '<n>/hour'.`,
    );
  }
  const amount = Number(match[1]);
  const unitSec = UNIT_SECONDS[match[2] as string];
  if (!Number.isFinite(amount) || amount <= 0 || unitSec === undefined) {
    throw new Error(`[gateway] Invalid rate limit "${input}".`);
  }
  return {
    capacity: Math.ceil(amount),
    refillPerSecond: amount / unitSec,
  };
}

/** Parse '500ms' | '30s' | '5m' | '7d' (or a number of ms) → milliseconds. */
export function parseDurationMs(input: number | DurationString): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`[gateway] Invalid duration ${input}ms.`);
    }
    return input;
  }
  const match = DURATION_RE.exec(input);
  if (!match) {
    throw new Error(
      `[gateway] Invalid duration "${input}". Expected '<n>ms' | '<n>s' | '<n>m' | '<n>h' | '<n>d'.`,
    );
  }
  const value = Number(match[1]);
  const unitMs = DURATION_UNIT_MS[match[2] as string];
  if (!Number.isFinite(value) || value < 0 || unitMs === undefined) {
    throw new Error(`[gateway] Invalid duration "${input}".`);
  }
  return Math.round(value * unitMs);
}

export function parseCacheInput(input: CacheInput): RouteCacheConfig {
  if (typeof input === 'object') return input;
  return { ttlMs: parseDurationMs(input) };
}

/** Normalize '/api/*' → '/api' (wildcard suffix supported in the DSL). */
export function normalizePrefix(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`[gateway] Route path must start with '/', got "${path}".`);
  }
  if (path.length > 2 && path.endsWith('/*')) return path.slice(0, -2);
  if (path.endsWith('/') && path.length > 1) return path.slice(0, -1);
  return path === '' ? '/' : path;
}

function toTargets(
  to: UpstreamInput,
): readonly [UpstreamTarget, ...UpstreamTarget[]] {
  // Shared runtime builder — validates URLs/weights and brands targets.
  return toUpstreamTargets(to);
}

export interface RouteShortcut<TReq extends IncomingMessage = IncomingMessage> {
  guards?: readonly EdgeGuard<TReq>[];
  stripHeaders?: readonly string[];
  rateLimit?: RateLimitInput;
  cache?: CacheInput;
  stripPrefix?: boolean;
  circuitBreaker?: CircuitBreakerInput;
  extractClientKey?: ClientKeyExtractor<TReq>;
}

export interface RouteDefinition<TReq extends IncomingMessage = IncomingMessage>
  extends RouteShortcut<TReq> {
  path: `/${string}` | `${string}/*`;
  to: UpstreamInput;
}

function buildRoute<TReq extends IncomingMessage>(
  def: RouteDefinition<TReq>,
): RouteConfig<TReq> {
  const route: RouteConfig<TReq> = {
    prefix: normalizePrefix(def.path) as RoutePrefix,
    upstreams: toTargets(def.to),
  };
  if (def.guards !== undefined) route.guards = def.guards;
  if (def.stripHeaders !== undefined) route.stripHeaders = def.stripHeaders;
  if (def.rateLimit !== undefined) route.rateLimit = parseRateLimit(def.rateLimit);
  if (def.cache !== undefined) route.cache = parseCacheInput(def.cache);
  if (def.stripPrefix !== undefined) route.stripPrefix = def.stripPrefix;
  if (def.circuitBreaker !== undefined) {
    const { openDurationMs, ...rest } = def.circuitBreaker;
    const cb: Partial<CircuitBreakerOptions> = { ...rest };
    if (openDurationMs !== undefined) {
      cb.openDurationMs = parseDurationMs(openDurationMs);
    }
    route.circuitBreaker = cb;
  }
  if (def.extractClientKey !== undefined) route.extractClientKey = def.extractClientKey;
  return route;
}

/**
 * Concise route helper:
 *
 * ```ts
 * route('/api/users/*', 'http://users:4001', { auth: true, rateLimit: '120/min', cache: '30s' })
 * ```
 */
/** A built route that also retains its DSL definition for group() merging. */
export type RouteResult<TReq extends IncomingMessage = IncomingMessage> =
  RouteConfig<TReq> & RouteDefinition<TReq>;

export function route<TReq extends IncomingMessage = IncomingMessage>(
  path: `/${string}` | `${string}/*`,
  to: UpstreamInput,
  options: RouteShortcut<TReq> = {},
): RouteResult<TReq> {
  const def: RouteDefinition<TReq> = { path, to, ...options };
  const built = buildRoute<TReq>(def);
  return { ...built, path: def.path, to: def.to };
}

function joinPrefix(prefix: string, path: string): string {
  const p = normalizePrefix(prefix);
  const c = normalizePrefix(path);
  if (c === '/') return p;
  return `${p === '/' ? '' : p}${c}`;
}

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
export function group<TReq extends IncomingMessage = IncomingMessage>(
  prefix: `/${string}`,
  shared: RouteShortcut<TReq>,
  routes: readonly RouteDefinition<TReq>[],
): RouteConfig<TReq>[] {
  return routes.map((def) => {
    const merged: RouteDefinition<TReq> = { ...shared, ...def, path: joinPrefix(prefix, def.path) as `/${string}` };
    return buildRoute<TReq>(merged);
  });
}

