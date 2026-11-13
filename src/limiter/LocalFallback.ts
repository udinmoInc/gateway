import type { RateLimitResult, RateLimitRule } from '../types.js';
import { DEFAULTS } from '../constants.js';
import { BoundedMap } from '../shared/BoundedMap.js';

interface BucketState {
  tokens: number;
  /** Last refill timestamp in ms (monotonic-ish; Date.now). */
  ts: number;
}

/**
 * Bounded in-memory token bucket used when Redis is unavailable
 * (fail-open fallback) or when no Redis client is configured.
 * LRU eviction keeps memory bounded under key-cardinality attacks.
 */
export class LocalFallback {
  private readonly buckets: BoundedMap<string, BucketState>;

  constructor(maxKeys: number = DEFAULTS.limiter.localMaxKeys) {
    this.buckets = new BoundedMap<string, BucketState>({
      maxEntries: maxKeys,
      mode: 'lru',
    });
  }

  consume(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: rule.capacity, ts: now };
      this.buckets.set(key, bucket);
    }
    // 'lru' mode: get()/set() already refreshed recency.

    const elapsedSec = Math.max(0, (now - bucket.ts) / 1000);
    bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsedSec * rule.refillPerSecond);
    bucket.ts = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: rule.capacity,
        resetAt: Math.ceil(now / 1000) + Math.ceil((rule.capacity - bucket.tokens) / rule.refillPerSecond),
        retryAfterMs: 0,
      };
    }

    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / rule.refillPerSecond) * 1000);
    return {
      allowed: false,
      remaining: 0,
      limit: rule.capacity,
      resetAt: Math.ceil(now / 1000) + Math.ceil(retryAfterMs / 1000),
      retryAfterMs,
    };
  }

  get size(): number {
    return this.buckets.size;
  }
}
