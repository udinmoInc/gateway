import type { RoutePrefix } from '../types.js';

export type MetricOutcome =
  | 'request'
  | 'rate_limited'
  | 'circuit_open'
  | 'cache_hit'
  | 'upstream_error';

interface RouteStat {
  requestsTotal: number;
  rateLimitedTotal: number;
  circuitOpenTotal: number;
  cacheHitTotal: number;
  upstreamErrorsTotal: number;
  /** Ring buffer of recent latencies (ms) for rolling quantiles. */
  latencies: number[];
  latencyIndex: number;
  latencyFilled: boolean;
}

const LATENCY_WINDOW = 512;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

/**
 * Lock-free (single-threaded) per-route counters + rolling latency
 * quantiles. Always cheap to record; only rendered when metricsPath
 * (or gateway.metrics) is consumed.
 */
export class MetricsCollector {
  private readonly stats = new Map<string, RouteStat>();

  private statFor(routeKey: string): RouteStat {
    let s = this.stats.get(routeKey);
    if (!s) {
      s = {
        requestsTotal: 0,
        rateLimitedTotal: 0,
        circuitOpenTotal: 0,
        cacheHitTotal: 0,
        upstreamErrorsTotal: 0,
        latencies: new Array<number>(LATENCY_WINDOW).fill(0),
        latencyIndex: 0,
        latencyFilled: false,
      };
      this.stats.set(routeKey, s);
    }
    return s;
  }

  /** Count one completed request + observe its latency. */
  recordRequest(route: RoutePrefix | string, latencyMs: number): void {
    const s = this.statFor(String(route));
    s.requestsTotal += 1;
    s.latencies[s.latencyIndex] = latencyMs;
    s.latencyIndex = (s.latencyIndex + 1) % LATENCY_WINDOW;
    if (s.latencyIndex === 0) s.latencyFilled = true;
  }

  /** Increment a specific outcome counter for a route. */
  recordOutcome(route: RoutePrefix | string, outcome: Exclude<MetricOutcome, 'request'>): void {
    const s = this.statFor(String(route));
    switch (outcome) {
      case 'rate_limited':
        s.rateLimitedTotal += 1;
        break;
      case 'circuit_open':
        s.circuitOpenTotal += 1;
        break;
      case 'cache_hit':
        s.cacheHitTotal += 1;
        break;
      case 'upstream_error':
        s.upstreamErrorsTotal += 1;
        break;
    }
  }

  /** JSON snapshot for `Accept: application/json`. */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [route, s] of this.stats) {
      const window = s.latencyFilled
        ? s.latencies
        : s.latencies.slice(0, s.latencyIndex);
      const sorted = [...window].sort((a, b) => a - b);
      out[route] = {
        requestsTotal: s.requestsTotal,
        rateLimitedTotal: s.rateLimitedTotal,
        circuitOpenTotal: s.circuitOpenTotal,
        cacheHitTotal: s.cacheHitTotal,
        upstreamErrorsTotal: s.upstreamErrorsTotal,
        latencyMs: {
          count: sorted.length,
          p50: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          p99: quantile(sorted, 0.99),
        },
      };
    }
    return out;
  }

  /** Prometheus exposition format (text/plain; version=0.0.4). */
  prometheus(): string {
    const lines: string[] = [];
    for (const [route, s] of this.stats) {
      const label = `route="${route.replace(/"/g, '\\"')}"`;
      lines.push(
        `gateway_requests_total{${label}} ${s.requestsTotal}`,
        `gateway_rate_limited_total{${label}} ${s.rateLimitedTotal}`,
        `gateway_circuit_open_total{${label}} ${s.circuitOpenTotal}`,
        `gateway_cache_hit_total{${label}} ${s.cacheHitTotal}`,
        `gateway_upstream_errors_total{${label}} ${s.upstreamErrorsTotal}`,
      );
      const window = s.latencyFilled
        ? s.latencies
        : s.latencies.slice(0, s.latencyIndex);
      const sorted = [...window].sort((a, b) => a - b);
      for (const [q, name] of [
        [0.5, '0.5'],
        [0.95, '0.95'],
        [0.99, '0.99'],
      ] as const) {
        lines.push(
          `gateway_request_duration_ms{${label},quantile="${name}"} ${quantile(sorted, q).toFixed(3)}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }
}
