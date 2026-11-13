import { HOP_BY_HOP_HEADERS } from '../constants.js';
import type {
  RoutePrefix,
  UpstreamTarget,
  UpstreamUrl,
} from '../types.js';

/** Canonical upstream URL shape (http/https, no whitespace). */
export const UPSTREAM_URL_RE = /^https?:\/\/\S+$/;

/** Runtime-validated RoutePrefix brand — throws on non-'/' prefixes. */
export function asRoutePrefix(prefix: string): RoutePrefix {
  if (!prefix.startsWith('/')) {
    throw new Error(`[gateway] Route path must start with '/', got "${prefix}".`);
  }
  return prefix as RoutePrefix;
}

/** Runtime-validated UpstreamUrl brand — throws on malformed URLs. */
export function asUpstreamUrl(url: string): UpstreamUrl {
  if (!UPSTREAM_URL_RE.test(url)) {
    throw new Error(
      `[gateway] Invalid upstream URL "${url}" — must start with http:// or https://.`,
    );
  }
  return url as UpstreamUrl;
}

/**
 * Expand a target shorthand to a URL string:
 *   4001 | ':4001'        → http://localhost:4001
 *   'users:4001'         → http://users:4001   (scheme-less host:port)
 *   'http(s)://...'      → unchanged
 */
export function expandTargetUrl(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0 && value <= 65_535) {
      return `http://localhost:${value}`;
    }
    throw new Error(`[gateway] invalid port number ${value}.`);
  }
  if (typeof value === 'string') {
    if (UPSTREAM_URL_RE.test(value)) return value;
    if (/^:?\d{1,5}$/.test(value)) {
      const port = Number(value.replace(':', ''));
      if (port > 0 && port <= 65_535) return `http://localhost:${port}`;
      throw new Error(`[gateway] invalid port "${value}".`);
    }
    if (/^[^\s/:]+:\d{1,5}$/.test(value)) {
      // Scheme-less host:port → http://
      const port = Number(value.slice(value.lastIndexOf(':') + 1));
      if (port > 0 && port <= 65_535) return `http://${value}`;
      throw new Error(`[gateway] invalid port in "${value}".`);
    }
    throw new Error(
      `[gateway] Invalid upstream URL "${value}" — must start with http:// or https://.`,
    );
  }
  throw new Error(
    `[gateway] invalid upstream target ${JSON.stringify(value)} — expected a URL, port, or 'host:port'.`,
  );
}

/**
 * Normalize any upstream shorthand (string | number | {url,weight} |
 * array) into branded UpstreamTarget[]. Throws on empty lists, bad
 * targets, or non-positive weights.
 */
export function toUpstreamTargets(
  input: unknown,
): readonly [UpstreamTarget, ...UpstreamTarget[]] {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) {
    throw new Error('[gateway] Route requires at least one upstream.');
  }
  const targets = list.map((item): UpstreamTarget => {
    if (typeof item === 'string' || typeof item === 'number') {
      return { url: asUpstreamUrl(expandTargetUrl(item)) };
    }
    if (typeof item === 'object' && item !== null) {
      const rec = item as { url?: unknown; weight?: unknown };
      const target: UpstreamTarget = {
        url: asUpstreamUrl(expandTargetUrl(rec.url)),
      };
      if (rec.weight !== undefined) {
        if (
          typeof rec.weight !== 'number' ||
          !Number.isFinite(rec.weight) ||
          rec.weight <= 0
        ) {
          throw new Error('[gateway] upstream weight must be a positive number.');
        }
        target.weight = rec.weight;
      }
      return target;
    }
    throw new Error('[gateway] invalid upstream target.');
  });
  return targets as [UpstreamTarget, ...UpstreamTarget[]];
}

/** Canonical hop-by-hop header set — single source of truth. */
export const HOP_BY_HOP_SET: ReadonlySet<string> = new Set(HOP_BY_HOP_HEADERS);

/** Hop-by-hop set plus caller extras (e.g. 'host' for upgrade handshakes). */
export function hopByHopSet(extra?: readonly string[]): ReadonlySet<string> {
  if (extra === undefined || extra.length === 0) return HOP_BY_HOP_SET;
  return new Set([...HOP_BY_HOP_HEADERS, ...extra]);
}

/** Strip CR/LF from a header value (CRLF injection defense). */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, '');
}

/** First value of a header from a headers record (case-insensitive name). */
export function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
