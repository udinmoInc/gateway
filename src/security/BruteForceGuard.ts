import { DEFAULTS } from '../constants.js';
import type { BruteForceConfig, GatewayStore } from '../types.js';

const FAIL_PREFIX = DEFAULTS.perimeter.bruteForceKeyPrefix;

/**
 * Per-IP brute-force lockout backed by GatewayStore.
 *
 * - `gw:bf:fail:{ip}`  — failure counter, expires after windowSec
 * - `gw:bf:lock:{ip}`  — lock marker, expires after lockDurationSec
 *
 * Uses dedicated incr/expire when the store provides them, otherwise
 * falls back to small Lua eval scripts so any RedisLike works.
 */
export class BruteForceGuard {
  private readonly store: GatewayStore;
  private readonly config: BruteForceConfig;

  constructor(store: GatewayStore, config: BruteForceConfig) {
    this.store = store;
    this.config = config;
  }

  private failKey(ip: string): string {
    return `${FAIL_PREFIX}fail:${ip}`;
  }

  private lockKey(ip: string): string {
    return `${FAIL_PREFIX}lock:${ip}`;
  }

  /** Seconds remaining on an active lock, or null when not locked. */
  async lockedFor(ip: string): Promise<number | null> {
    const raw = await this.storeGet(this.lockKey(ip));
    if (raw === null) return null;
    const lockedUntil = Number(raw);
    if (!Number.isFinite(lockedUntil)) return null;
    const remainingMs = lockedUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null;
  }

  /** Record an auth failure; returns lock seconds when this trips the lock. */
  async recordFailure(ip: string): Promise<number | null> {
    const failures = await this.increment(this.failKey(ip));
    // (Re)set the window expiry on every failure.
    await this.expire(this.failKey(ip), this.config.windowSec);
    if (failures >= this.config.maxFailures) {
      const lockUntil = Date.now() + this.config.lockDurationSec * 1000;
      await this.storeSet(this.lockKey(ip), String(lockUntil));
      await this.expire(this.lockKey(ip), this.config.lockDurationSec);
      await this.storeDel(this.failKey(ip));
      return this.config.lockDurationSec;
    }
    return null;
  }

  /** Clear failure counters (e.g. after a successful auth). */
  async recordSuccess(ip: string): Promise<void> {
    await this.storeDel(this.failKey(ip));
  }

  // ---- store abstraction ----

  private async storeGet(key: string): Promise<string | null> {
    if (this.store.get) return this.store.get(key);
    const raw = await this.store.eval('return redis.call("GET", KEYS[1])', 1, key);
    return typeof raw === 'string' ? raw : null;
  }

  private async storeSet(key: string, value: string): Promise<void> {
    if (this.store.set) {
      await this.store.set(key, value);
      return;
    }
    await this.store.eval(
      'redis.call("SET", KEYS[1], ARGV[1]); return 1',
      1,
      key,
      value,
    );
  }

  private async storeDel(key: string): Promise<void> {
    if (this.store.del) {
      await this.store.del(key);
      return;
    }
    await this.store.eval('return redis.call("DEL", KEYS[1])', 1, key);
  }

  private async increment(key: string): Promise<number> {
    if (this.store.incr) return this.store.incr(key);
    const raw = await this.store.eval(
      'local v = redis.call("INCR", KEYS[1]); return v',
      1,
      key,
    );
    return Number(raw) || 0;
  }

  private async expire(key: string, seconds: number): Promise<void> {
    if (this.store.expire) {
      await this.store.expire(key, seconds);
      return;
    }
    await this.store.eval('return redis.call("EXPIRE", KEYS[1], ARGV[1])', 1, key, seconds);
  }
}
