import type { IncomingMessage } from 'node:http';
import type { RouteConfig, UpstreamTarget } from '../types.js';

export interface ResolvedRoute<TReq extends IncomingMessage> {
  route: RouteConfig<TReq>;
  /** Path after stripping the matched prefix (always starts with '/'). */
  strippedPath: string;
}

function pathnameOf(url: string | undefined): string {
  if (!url) return '/';
  // Strip query string; keep it for forwarding separately.
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return true;
  if (pathname === prefix) return true;
  return pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

/**
 * Longest-prefix route resolver + weighted round-robin upstream balancer.
 */
export class Router<TReq extends IncomingMessage = IncomingMessage> {
  private readonly routes: RouteConfig<TReq>[];
  /** O(1) exact-path hits (pathname === prefix) checked before prefix scan. */
  private readonly exact = new Map<string, RouteConfig<TReq>>();
  private readonly counters = new Map<string, number>();

  constructor(routes: readonly RouteConfig<TReq>[]) {
    // Sort longest-prefix-first once; first match wins.
    this.routes = [...routes].sort(
      (a, b) => b.prefix.length - a.prefix.length,
    );
    // Exact-path index: when the request path equals a route prefix
    // verbatim, skip the O(n) prefix scan entirely.
    for (const route of this.routes) {
      const key = String(route.prefix);
      if (!this.exact.has(key)) this.exact.set(key, route);
    }
  }

  resolve(req: TReq): ResolvedRoute<TReq> | undefined {
    const pathname = pathnameOf(req.url);
    const exactHit = this.exact.get(pathname);
    if (exactHit !== undefined) {
      return { route: exactHit, strippedPath: '/' };
    }
    for (const route of this.routes) {
      const prefix: string = route.prefix;
      if (matchesPrefix(pathname, prefix)) {
        const stripped =
          prefix === '/'
            ? pathname
            : pathname.slice(prefix.length) || '/';
        return { route, strippedPath: stripped.startsWith('/') ? stripped : `/${stripped}` };
      }
    }
    return undefined;
  }

  /** Weighted round-robin upstream selection. Key should be route prefix. */
  nextUpstream(key: string, upstreams: readonly UpstreamTarget[]): UpstreamTarget {
    const totalWeight = upstreams.reduce((sum, u) => sum + (u.weight ?? 1), 0);
    let counter = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, counter);

    let acc = 0;
    for (const upstream of upstreams) {
      acc += upstream.weight ?? 1;
      if (counter % totalWeight < acc) {
        // normalize counter growth
        if (counter > totalWeight * 1000) this.counters.set(key, counter % totalWeight);
        return upstream;
      }
    }
    return upstreams[0] as UpstreamTarget;
  }
}

export { pathnameOf };
