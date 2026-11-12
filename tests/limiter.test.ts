import { describe, expect, it } from 'vitest';
import { LocalFallback } from '../src/limiter/LocalFallback.js';
import { RedisRateLimiter } from '../src/limiter/RedisRateLimiter.js';
import type { RedisLike } from '../src/types.js';
import { FAIL_MODES } from '../src/constants.js';

const rule = { capacity: 3, refillPerSecond: 1 };

describe('LocalFallback', () => {
  it('allows up to capacity then denies', () => {
    const lb = new LocalFallback();
    const now = 1_000_000;
    expect(lb.consume('k', rule, now).allowed).toBe(true);
    expect(lb.consume('k', rule, now).allowed).toBe(true);
    expect(lb.consume('k', rule, now).allowed).toBe(true);
    const denied = lb.consume('k', rule, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    const lb = new LocalFallback();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) lb.consume('k', rule, now);
    expect(lb.consume('k', rule, now).allowed).toBe(false);
    // 1 second later → 1 token refilled
    const later = lb.consume('k', rule, now + 1000);
    expect(later.allowed).toBe(true);
  });

  it('evicts oldest keys beyond maxKeys', () => {
    const lb = new LocalFallback(2);
    const now = 1_000_000;
    lb.consume('a', rule, now);
    lb.consume('b', rule, now);
    lb.consume('c', rule, now);
    expect(lb.size).toBe(2);
  });
});

describe('RedisRateLimiter', () => {
  const fakeRedis = (result: unknown): RedisLike => ({
    async eval() {
      return result;
    },
  });

  it('parses redis script result', async () => {
    const limiter = new RedisRateLimiter({
      redis: fakeRedis([1, 7.5, 10, 1_700_000_000, 0]),
    });
    const res = await limiter.consume('user:1', { capacity: 10, refillPerSecond: 5 });
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(7);
    expect(res.limit).toBe(10);
  });

  it('denies when script reports not allowed', async () => {
    const limiter = new RedisRateLimiter({
      redis: fakeRedis([0, 0, 10, 1_700_000_000, 2.5]),
    });
    const res = await limiter.consume('user:1', { capacity: 10, refillPerSecond: 5 });
    expect(res.allowed).toBe(false);
    expect(res.retryAfterMs).toBe(2500);
  });

  it('fail-open allows requests when redis throws', async () => {
    const limiter = new RedisRateLimiter({
      redis: {
        async eval() {
          throw new Error('ECONNREFUSED');
        },
      },
      failMode: FAIL_MODES.open,
    });
    const res = await limiter.consume('k', rule);
    expect(res.allowed).toBe(true);
  });

  it('fail-closed denies requests when redis throws', async () => {
    const limiter = new RedisRateLimiter({
      redis: {
        async eval() {
          throw new Error('ECONNREFUSED');
        },
      },
      failMode: FAIL_MODES.closed,
    });
    const res = await limiter.consume('k', rule);
    expect(res.allowed).toBe(false);
  });

  it('fallback mode uses local bucket when redis throws', async () => {
    let calls = 0;
    const limiter = new RedisRateLimiter({
      redis: {
        async eval() {
          calls += 1;
          throw new Error('down');
        },
      },
      failMode: FAIL_MODES.fallback,
    });
    // capacity 3 → 3 allowed via fallback
    for (let i = 0; i < 3; i++) {
      expect((await limiter.consume('k', rule)).allowed).toBe(true);
    }
    expect((await limiter.consume('k', rule)).allowed).toBe(false);
    expect(calls).toBe(4);
  });

  it('works without redis (local mode)', async () => {
    const limiter = new RedisRateLimiter();
    expect((await limiter.consume('k', rule)).allowed).toBe(true);
  });
});
