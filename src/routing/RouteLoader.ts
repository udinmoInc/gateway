import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage } from 'node:http';
import type { RouteConfig } from '../types.js';
import { normalizePrefix, parseDurationMs, parseRateLimit, route as buildRoute } from './dsl.js';
import type { RouteDefinition, RouteShortcut, UpstreamInput } from './dsl.js';

const SYNC_EXTENSIONS = new Set(['.js', '.cjs']);
const ASYNC_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);
const UPSTREAM_RE = /^https?:\/\/\S+$/;

interface RawRoute {
  path?: unknown;
  prefix?: unknown;
  to?: unknown;
  upstreams?: unknown;
  guards?: unknown;
  stripHeaders?: unknown;
  rateLimit?: unknown;
  cache?: unknown;
  stripPrefix?: unknown;
  circuitBreaker?: unknown;
}

function fail(file: string, message: string): never {
  throw new Error(`[gateway] Route load error in ${file}: ${message}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function looksLikeRoute(v: unknown): boolean {
  return (
    isObject(v) &&
    ('path' in v || 'prefix' in v || 'to' in v || 'upstreams' in v)
  );
}

/** Extract route-definition candidates from a module namespace/exports object. */
function collectExports(mod: unknown, file: string): unknown[] {
  const out: unknown[] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (looksLikeRoute(item) || isObject(item)) out.push(item);
        else fail(file, 'route array contains a non-object entry');
      }
    } else if (isObject(v)) {
      out.push(v);
    } else {
      fail(file, 'module must export route objects or arrays of routes');
    }
  };

  if (Array.isArray(mod)) {
    push(mod);
    return out;
  }
  if (!isObject(mod)) fail(file, 'module must export route definitions');

  const hasDefault = 'default' in mod;
  const isSingleRoute = looksLikeRoute(mod) && !hasDefault;
  if (isSingleRoute) {
    push(mod);
    return out;
  }
  // Namespace / exports object: default export + named exports.
  for (const [key, value] of Object.entries(mod)) {
    if (key === '__esModule') continue;
    if (key === 'default') push(value);
    else if (looksLikeRoute(value) || Array.isArray(value)) push(value);
  }
  if (out.length === 0) fail(file, 'module exports no route definitions');
  return out;
}

function normalizeRaw(raw: unknown, file: string): RouteDefinition {
  if (!isObject(raw)) fail(file, 'route entry must be an object');
  const r = raw as RawRoute;
  const pathValue =
    typeof r.path === 'string' ? r.path : typeof r.prefix === 'string' ? r.prefix : undefined;
  if (!pathValue) fail(file, 'route is missing "path" (or "prefix")');

  let to: UpstreamInput;
  if (typeof r.to === 'string' || Array.isArray(r.to)) {
    to = r.to as UpstreamInput;
  } else if (
    Array.isArray(r.upstreams) &&
    r.upstreams.every(
      (u) => isObject(u) && typeof (u as { url?: unknown }).url === 'string',
    )
  ) {
    to = (r.upstreams as { url: string }[]).map((u) => u.url) as UpstreamInput;
  } else {
    fail(file, `route "${pathValue}" is missing "to" upstream(s)`);
  }

  const list = Array.isArray(to) ? to : [to];
  for (const url of list) {
    if (typeof url !== 'string' || !UPSTREAM_RE.test(url)) {
      fail(file, `route "${pathValue}" has invalid upstream "${String(url)}"`);
    }
  }

  const def: RouteDefinition = { path: pathValue as `/${string}`, to };
  const opts: RouteShortcut = {};
  if (r.guards !== undefined) opts.guards = r.guards as NonNullable<RouteShortcut['guards']>;
  if (r.stripHeaders !== undefined) {
    opts.stripHeaders = r.stripHeaders as NonNullable<RouteShortcut['stripHeaders']>;
  }
  if (r.rateLimit !== undefined) {
    opts.rateLimit = r.rateLimit as NonNullable<RouteShortcut['rateLimit']>;
  }
  if (r.cache !== undefined) opts.cache = r.cache as NonNullable<RouteShortcut['cache']>;
  if (r.stripPrefix !== undefined) opts.stripPrefix = r.stripPrefix as boolean;
  if (r.circuitBreaker !== undefined) {
    opts.circuitBreaker = r.circuitBreaker as NonNullable<RouteShortcut['circuitBreaker']>;
  }
  return { ...def, ...opts };
}

function validateUnique(defs: RouteDefinition[], dir: string): void {
  const seen = new Set<string>();
  for (const d of defs) {
    const prefix = normalizePrefix(d.path);
    if (seen.has(prefix)) {
      fail(dir, `duplicate/conflicting route prefix "${prefix}"`);
    }
    seen.add(prefix);
  }
}

function routeFiles(dir: string, extensions: Set<string>): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && extensions.has(path.extname(e.name)))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function defsFromFiles(
  files: string[],
  load: (file: string) => unknown,
): RouteDefinition[] {
  const defs: RouteDefinition[] = [];
  for (const file of files) {
    for (const entry of collectExports(load(file), file)) {
      defs.push(normalizeRaw(entry, file));
    }
  }
  return defs;
}

/**
 * Async route discovery — supports .js/.cjs/.mjs/.ts modules.
 * Each module may default-export (or named-export) a route object,
 * an array of routes, or the output of `route()`/`group()`.
 */
export async function loadRoutesDir<TReq extends IncomingMessage = IncomingMessage>(
  dir: string,
): Promise<RouteConfig<TReq>[]> {
  const files = routeFiles(dir, ASYNC_EXTENSIONS);
  const loaded: RouteDefinition[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as unknown;
    for (const entry of collectExports(mod, file)) {
      loaded.push(normalizeRaw(entry, file));
    }
  }
  validateUnique(loaded, dir);
  return loaded.map((d) =>
    buildRoute<TReq>(d.path, d.to, d),
  );
}

/**
 * Synchronous route discovery for `createGateway({ routesDir })`.
 * Supports .js/.cjs only — use `loadRoutesDir` for .ts/.mjs.
 */
export function loadRoutesDirSync<TReq extends IncomingMessage = IncomingMessage>(
  dir: string,
): RouteConfig<TReq>[] {
  const require = createRequire(pathToFileURL(process.cwd() + path.sep).href);
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const unsupported = entries
    .map((e) => e.name)
    .filter((name) => !SYNC_EXTENSIONS.has(path.extname(name)));
  if (unsupported.length > 0) {
    throw new Error(
      `[gateway] routesDir contains files unsupported by sync loading: ${unsupported.join(', ')}. ` +
        'Use `await loadRoutesDir(dir)` for .ts/.mjs route modules.',
    );
  }
  const files = entries
    .map((e) => path.join(dir, e.name))
    .sort();
  const loaded = defsFromFiles(files, (file) => require(file) as unknown);
  validateUnique(loaded, dir);
  return loaded.map((d) =>
    buildRoute<TReq>(d.path, d.to, d),
  );
}
