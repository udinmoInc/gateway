import type { UpstreamTarget } from '../types.js';
import { sleep } from '../shared/timers.js';

interface UpstreamStats {
  inFlight: number;
  /** Exponentially-weighted moving average of time-to-first-byte (ms). */
  ewmaMs: number;
  samples: number;
}

const EWMA_ALPHA = 0.2;

// sleep re-exported for existing consumers.
export { sleep };

/**
 * Power-of-two-choices load balancer with live in-flight counts and
 * EWMA latency. Picks two weighted-random candidates and routes to the
 * least-loaded healthy target — avoids herding and self-corrects away
 * from slow upstreams without active health checks.
 */
export class LoadBalancer {
  private readonly stats = new Map<string, UpstreamStats>();

  private statsFor(url: string): UpstreamStats {
    let s = this.stats.get(url);
    if (!s) {
      s = { inFlight: 0, ewmaMs: 0, samples: 0 };
      this.stats.set(url, s);
    }
    return s;
  }

  enter(url: string): void {
    this.statsFor(url).inFlight += 1;
  }

  /** Record completion; latencyMs is time-to-first-byte. */
  leave(url: string, latencyMs: number): void {
    const s = this.statsFor(url);
    s.inFlight = Math.max(0, s.inFlight - 1);
    s.ewmaMs =
      s.samples === 0 ? latencyMs : s.ewmaMs + EWMA_ALPHA * (latencyMs - s.ewmaMs);
    s.samples += 1;
  }

  statsOf(url: string): { inFlight: number; ewmaMs: number } {
    const s = this.stats.get(url);
    return { inFlight: s?.inFlight ?? 0, ewmaMs: s?.ewmaMs ?? 0 };
  }

  /** Weighted random pick of one candidate. */
  private pickWeighted(upstreams: readonly UpstreamTarget[]): UpstreamTarget {
    const total = upstreams.reduce((sum, u) => sum + (u.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const u of upstreams) {
      r -= u.weight ?? 1;
      if (r <= 0) return u;
    }
    return upstreams[0] as UpstreamTarget;
  }

  /** Lower score = less loaded (in-flight dominates, EWMA breaks ties). */
  private score(url: string): number {
    const s = this.stats.get(url);
    if (!s) return 0;
    // Unsampled upstreams get a neutral 50ms prior so they remain
    // explorable without permanently winning over proven-fast peers.
    const latencyScore = s.samples === 0 ? 50_000 : Math.round(s.ewmaMs * 1_000);
    return s.inFlight * 1_000_000 + latencyScore;
  }

  /**
   * Power-of-two-choices: sample two distinct weighted candidates,
   * return the one with the lower load score.
   */
  selectP2C(upstreams: readonly UpstreamTarget[]): UpstreamTarget {
    if (upstreams.length === 1) return upstreams[0] as UpstreamTarget;
    const a = this.pickWeighted(upstreams);
    let b = this.pickWeighted(upstreams);
    if (b.url === a.url && upstreams.length > 1) {
      // resample a bounded number of times for a distinct candidate
      for (let i = 0; i < 4 && b.url === a.url; i += 1) {
        b = this.pickWeighted(upstreams);
      }
      if (b.url === a.url) {
        b = upstreams.find((u) => u.url !== a.url) ?? a;
      }
    }
    return this.score(a.url) <= this.score(b.url) ? a : b;
  }

  /** P2C pick excluding a specific upstream (hedging secondary). */
  selectAlternative(
    upstreams: readonly UpstreamTarget[],
    excludeUrl: string,
  ): UpstreamTarget | undefined {
    const candidates = upstreams.filter((u) => u.url !== excludeUrl);
    if (candidates.length === 0) return undefined;
    return this.selectP2C(candidates);
  }
}
