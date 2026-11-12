import { DEFAULTS, FAIL_MODES } from '../constants.js';
import { LocalFallback } from './LocalFallback.js';
import { TOKEN_BUCKET_SCRIPT } from './scripts.js';
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
    const timer = setTimeout(() => reject(new Error('redis timeout')), ms);
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
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
export class RedisRateLimiter {
  private readonly redis: RedisLike | undefined;
  private readonly failMode: FailMode;
  private readonly keyPrefix: string;
  private readonly timeoutMs: number;
  private readonly local: LocalFallback;
  private warnedNoRedis = false;

  constructor(options: RateLimiterOptions = {}) {
    this.redis = options.redis;
    this.failMode = options.failMode ?? FAIL_MODES.fallback;
    this.keyPrefix = options.keyPrefix ?? DEFAULTS.redisPrefix;
    this.timeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.local = new LocalFallback(options.localMaxKeys);
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
      return this.local.consume(key, rule);
    }

    const redisKey = `${this.keyPrefix}:${key}`;
    try {
      const raw = await withTimeout(
        this.redis.eval(
          TOKEN_BUCKET_SCRIPT,
          1,
          redisKey,
          rule.capacity,
          rule.refillPerSecond,
          1,
        ),
        this.timeoutMs,
      );
      return this.parseResult(raw, rule);
    } catch {
      return this.handleFailure(key, rule);
    }
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
        };
      case FAIL_MODES.closed:
        return {
          allowed: false,
          remaining: 0,
          limit: rule.capacity,
          resetAt: Math.ceil(Date.now() / 1000) + 1,
          retryAfterMs: this.timeoutMs,
        };
      case FAIL_MODES.fallback:
      default:
        return this.local.consume(key, rule);
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
