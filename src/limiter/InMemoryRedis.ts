import { DEFAULTS } from '../constants.js';
import type { RedisLike } from '../types.js';

interface StringEntry {
  value: string;
  /** Epoch ms expiry; undefined = no expiry. */
  expiresAt?: number;
}

/**
 * In-memory RedisLike adapter: implements the token-bucket eval contract
 * plus get/set/del/ping KV ops, so sessions and rate limits work with
 * zero infrastructure. Per-process only — not shared across nodes.
 */
export class InMemoryRedis implements RedisLike {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  private readonly kv = new Map<string, StringEntry>();
  private readonly maxKeys = DEFAULTS.inMemoryRedis.maxKeys;

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
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
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

  async ping(): Promise<string> {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.kv.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK'> {
    // Supports ioredis-style 'PX', ms argument pairs.
    let expiresAt: number | undefined;
    for (let i = 0; i < args.length; i += 1) {
      if (String(args[i]).toUpperCase() === 'PX') {
        const ms = Number(args[i + 1]);
        if (Number.isFinite(ms)) expiresAt = Date.now() + ms;
        i += 1;
      }
    }
    if (this.kv.size >= this.maxKeys && !this.kv.has(key)) {
      const oldest = this.kv.keys().next();
      if (!oldest.done) this.kv.delete(oldest.value);
    }
    this.kv.set(key, expiresAt === undefined ? { value } : { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const current = Number(await this.get(key) ?? '0');
    const next = current + 1;
    // preserve existing TTL if present
    const entry = this.kv.get(key);
    const expiresAt = entry?.expiresAt;
    this.kv.set(key, expiresAt === undefined ? { value: String(next) } : { value: String(next), expiresAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.kv.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
}
