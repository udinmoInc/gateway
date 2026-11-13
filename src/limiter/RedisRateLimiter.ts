import { DEFAULTS, FAIL_MODES } from '../constants.js';
import { LocalFallback } from './LocalFallback.js';
import { TOKEN_BUCKET_SCRIPT, TOKEN_BUCKET_SHA1 } from './scripts.js';
import { BoundedMap } from '../shared/BoundedMap.js';
import { deadlineTimer } from '../shared/timers.js';
import type {
  FailMode,
  RateLimitResult,
  RateLimitRule,
  RateLimiterOptions,
  RedisLike,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = deadlineTimer(ms, () =>
      reject(new Error('redis timeout')),
    );
    promise.then(
      (v) => {
        timer.clear();
        resolve(v);
      },
      (e) => {
        timer.clear();
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Distributed token-bucket rate limiter backed by Redis + Lua.
 * Falls back per configured fail mode when Redis is unreachable:
 *  - 'open'    : allow the request (availability first)
 *  - 'closed'  : deny the request (strict limiting)
 *  - 'fallback': delegate to a bounded in-memory LRU bucket
 */
function isNoScriptError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('NOSCRIPT');
}

export class RedisRateLimiter {
  private readonly redis: RedisLike | undefined;
  private readonly failMode: FailMode;
  private readonly keyPrefix: string;
  private readonly timeoutMs: number;
  private readonly local: LocalFallback;
  /**
   * Locally-banked batch tokens per Redis key (batchSize > 1 leasing).
   * Bounded FIFO — high-cardinality keys can't grow it unboundedly.
   */
  private readonly batchCredits: BoundedMap<string, number>;
  private warnedNoRedis = false;

  constructor(options: RateLimiterOptions = {}) {
    this.redis = options.redis;
    this.failMode = options.failMode ?? FAIL_MODES.fallback;
    this.keyPrefix = options.keyPrefix ?? DEFAULTS.redisPrefix;
    this.timeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.local = new LocalFallback(options.localMaxKeys);
    this.batchCredits = new BoundedMap<string, number>({
      maxEntries: options.localMaxKeys ?? DEFAULTS.limiter.localMaxKeys,
    });
    if (!this.redis && !this.warnedNoRedis) {
      this.warnedNoRedis = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[gateway] No Redis client configured — using in-memory rate limiting. ' +
          'Limits are per-process, not distributed.',
      );
    }
  }

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    if (!this.redis) {
      return { ...this.local.consume(key, rule), source: 'local' };
    }

    const redisKey = `${this.keyPrefix}:${key}`;
    const batch = this.batchFor(rule);

    // Serve from banked batch credits — zero Redis round-trips.
    if (batch > 1) {
      const credit = this.batchCredits.get(redisKey) ?? 0;
      if (credit > 0) {
        this.batchCredits.set(redisKey, credit - 1);
        return {
          allowed: true,
          remaining: credit - 1,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1000) + 1,
          retryAfterMs: 0,
          source: 'batch',
        };
      }
    }

    try {
      const raw = await this.runScript(redisKey, rule, batch);
      const result = this.parseResult(raw, rule);
      // Bank the unused batch tokens for subsequent local serves.
      if (result.allowed && batch > 1) {
        this.setBatchCredit(redisKey, batch - 1);
      }
      return { ...result, source: 'redis' };
    } catch {
      return this.handleFailure(key, rule);
    }
  }

  /** Tokens leased per Redis round-trip (clamped to burst capacity). */
  private batchFor(rule: RateLimitRule): number {
    const batch = rule.batchSize;
    if (batch === undefined || batch <= 1) return 1;
    return Math.min(Math.floor(batch), Math.floor(rule.capacity), 1_000);
  }

  /** EVALSHA first (pre-loaded script), EVAL fallback on NOSCRIPT. */
  private async runScript(
    redisKey: string,
    rule: RateLimitRule,
    requested: number,
  ): Promise<unknown> {
    const args: (string | number)[] = [
      redisKey,
      rule.capacity,
      rule.refillPerSecond,
      requested,
    ];
    if (this.redis?.evalSha) {
      try {
        return await withTimeout(
          this.redis.evalSha(TOKEN_BUCKET_SHA1, 1, ...args),
          this.timeoutMs,
        );
      } catch (err) {
        if (!isNoScriptError(err)) throw err;
        // NOSCRIPT → fall through to full EVAL (Redis re-caches it).
      }
    }
    return withTimeout(
      (this.redis as RedisLike).eval(TOKEN_BUCKET_SCRIPT, 1, ...args),
      this.timeoutMs,
    );
  }

  private setBatchCredit(redisKey: string, credits: number): void {
    this.batchCredits.set(redisKey, credits); // bounded FIFO eviction
  }

  /** Bulk pre-check used by adapters that want headers before deciding. */
  async check(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    return this.consume(key, rule);
  }

  /**
   * Liveness probe for readiness checks. In-memory mode is always ready;
   * a configured Redis must answer PING within the command timeout.
   */
  async ping(timeoutMs: number = this.timeoutMs): Promise<boolean> {
    if (!this.redis) return true;
    try {
      if (this.redis.ping) {
        await withTimeout(this.redis.ping(), timeoutMs);
      } else {
        await withTimeout(
          this.redis.eval('return redis.call("ping")', 0),
          timeoutMs,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  private handleFailure(key: string, rule: RateLimitRule): RateLimitResult {
    switch (this.failMode) {
      case FAIL_MODES.open:
        return {
          allowed: true,
          remaining: rule.capacity,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1000) + 1,
          retryAfterMs: 0,
          source: 'fail-open',
        };
      case FAIL_MODES.closed:
        return {
          allowed: false,
          remaining: 0,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1000) + 1,
          retryAfterMs: this.timeoutMs,
          source: 'fail-closed',
        };
      case FAIL_MODES.fallback:
      default:
        return { ...this.local.consume(key, rule), source: 'local-fallback' };
    }
  }

  private parseResult(raw: unknown, rule: RateLimitRule): RateLimitResult {
    if (!Array.isArray(raw) || raw.length < 5) {
      throw new Error('unexpected redis script result');
    }
    const [allowedRaw, tokensRaw, , nowRaw, retryRaw] = raw as [
      number,
      number,
      number,
      number,
      number,
    ];
    const allowed = Number(allowedRaw) === 1;
    const tokens = Number(tokensRaw);
    const now = Number(nowRaw);
    const retrySec = Number(retryRaw);
    return {
      allowed,
      remaining: Math.max(0, Math.floor(tokens)),
      limit: rule.capacity,
      resetAt: Math.ceil(now + (rule.capacity - tokens) / rule.refillPerSecond),
      retryAfterMs: allowed ? 0 : Math.max(1, Math.ceil(retrySec * 1000)),
    };
  }
}
