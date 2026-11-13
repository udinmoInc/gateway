import { DEFAULTS } from '../constants.js';
import type { RedisLike } from '../types.js';
import { BoundedMap } from '../shared/BoundedMap.js';

interface Bucket {
  tokens: number;
  ts: number;
}

/**
 * In-memory RedisLike adapter: implements the token-bucket eval contract
 * plus get/set/del/ping KV ops, so sessions and rate limits work with
 * zero infrastructure. Per-process only — not shared across nodes.
 * All maps are bounded FIFO stores (DEFAULTS.inMemoryRedis.maxKeys).
 */
export class InMemoryRedis implements RedisLike {
  private readonly buckets = new BoundedMap<string, Bucket>({
    maxEntries: DEFAULTS.inMemoryRedis.maxKeys,
  });
  private readonly kv = new BoundedMap<string, string>({
    maxEntries: DEFAULTS.inMemoryRedis.maxKeys,
  });

  async eval(
    _script: string,
    _numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const key = String(args[0]);
    const capacity = Number(args[1]);
    const refill = Number(args[2]);
    const requested = Number(args[3] ?? 1);

    const now = Date.now() / 1000;
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: capacity, ts: now };
      this.buckets.set(key, bucket);
    }

    const elapsed = Math.max(0, now - bucket.ts);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refill);
    bucket.ts = now;

    let allowed = 0;
    let retry = 0;
    if (bucket.tokens >= requested) {
      bucket.tokens -= requested;
      allowed = 1;
    } else {
      retry = (requested - bucket.tokens) / refill;
    }

    return [allowed, bucket.tokens, capacity, now, retry];
  }

  /** In-memory EVALSHA — script text is irrelevant; semantics match eval. */
  async evalSha(
    _sha1: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    return this.eval('', numKeys, ...args);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
    // Supports ioredis-style 'PX', ms and 'NX' flags.
    let pxMs: number | undefined;
    let nx = false;
    for (let i = 0; i < args.length; i += 1) {
      const flag = String(args[i]).toUpperCase();
      if (flag === 'PX') {
        const ms = Number(args[i + 1]);
        if (Number.isFinite(ms)) pxMs = ms;
        i += 1;
      } else if (flag === 'NX') {
        nx = true;
      }
    }
    if (nx && this.kv.get(key) !== undefined) return null;
    this.kv.set(key, value, pxMs);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const current = Number(this.kv.get(key) ?? '0');
    const next = current + 1;
    // Preserve remaining TTL when the key already expires.
    const ttl = this.kv.ttlRemainingMs(key);
    this.kv.set(key, String(next), ttl);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.kv.expire(key, seconds * 1000) ? 1 : 0;
  }
}
