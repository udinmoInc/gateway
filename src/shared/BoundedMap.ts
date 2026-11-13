/**
 * Single-source bounded map: deterministic FIFO or LRU eviction,
 * optional per-entry TTL with lazy expiry on read.
 *
 * Replaces the hand-rolled eviction loops that were duplicated across
 * InMemoryRedis, LocalFallback, ResponseCache, IdempotencyManager,
 * RequestCoalescer, RedisRateLimiter batch credits and the HTTP error
 * body cache.
 */
export type EvictionMode = 'fifo' | 'lru';

export interface BoundedMapOptions {
  maxEntries: number;
  /** 'lru' refreshes recency on get/set; 'fifo' evicts oldest insert. */
  mode?: EvictionMode;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface Slot<V> {
  value: V;
  /** Epoch ms after which the entry is considered expired. */
  expiresAt: number | undefined;
}

export class BoundedMap<K, V> {
  private readonly slots = new Map<K, Slot<V>>();
  private readonly maxEntries: number;
  private readonly mode: EvictionMode;
  private readonly now: () => number;

  constructor(options: BoundedMapOptions) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.mode = options.mode ?? 'fifo';
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.slots.size;
  }

  /** Live (non-expired) entry count — used by tests/metrics. */
  get liveSize(): number {
    let n = 0;
    for (const key of this.slots.keys()) {
      if (this.live(key)) n += 1;
    }
    return n;
  }

  private live(key: K): boolean {
    const slot = this.slots.get(key);
    if (slot === undefined) return false;
    if (slot.expiresAt !== undefined && slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return false;
    }
    return true;
  }

  /** Returns the value, or undefined when missing/expired. LRU refreshes. */
  get(key: K): V | undefined {
    const slot = this.slots.get(key);
    if (slot === undefined) return undefined;
    if (slot.expiresAt !== undefined && slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return undefined;
    }
    if (this.mode === 'lru') {
      this.slots.delete(key);
      this.slots.set(key, slot);
    }
    return slot.value;
  }

  /** Raw slot access for callers needing expiry metadata (e.g. incr TTL). */
  entry(key: K): { value: V; expiresAt: number | undefined } | undefined {
    const slot = this.slots.get(key);
    if (slot === undefined) return undefined;
    if (slot.expiresAt !== undefined && slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return undefined;
    }
    if (this.mode === 'lru') {
      this.slots.delete(key);
      this.slots.set(key, slot);
    }
    return { value: slot.value, expiresAt: slot.expiresAt };
  }

  /**
   * Insert/overwrite. `ttlMs` > 0 arms lazy expiry; evicts the oldest
   * entry (or least-recently-used in 'lru' mode) when at capacity.
   */
  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt =
      ttlMs !== undefined && ttlMs > 0 ? this.now() + ttlMs : undefined;
    const existing = this.slots.get(key);
    if (existing !== undefined) {
      this.slots.delete(key);
    } else if (this.slots.size >= this.maxEntries) {
      const oldest = this.slots.keys().next();
      if (!oldest.done) this.slots.delete(oldest.value);
    }
    this.slots.set(key, { value, expiresAt });
  }

  /** Set only when absent (SET NX semantics for locks/leases). */
  setIfAbsent(key: K, value: V, ttlMs?: number): boolean {
    if (this.get(key) !== undefined) return false;
    this.set(key, value, ttlMs);
    return true;
  }

  delete(key: K): boolean {
    return this.slots.delete(key);
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /** Arm/replace the TTL on a live entry. Returns false when missing/expired. */
  expire(key: K, ttlMs: number): boolean {
    const slot = this.slots.get(key);
    if (slot === undefined || !this.live(key)) return false;
    slot.expiresAt = this.now() + ttlMs;
    return true;
  }

  /** Milliseconds until expiry, or undefined when no TTL / missing. */
  ttlRemainingMs(key: K): number | undefined {
    const slot = this.slots.get(key);
    if (slot === undefined || slot.expiresAt === undefined) return undefined;
    if (slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return undefined;
    }
    return slot.expiresAt - this.now();
  }

  keys(): IterableIterator<K> {
    return this.slots.keys();
  }

  *values(): IterableIterator<V> {
    for (const key of this.slots.keys()) {
      const v = this.get(key);
      if (v !== undefined) yield v;
    }
  }

  *entries(): IterableIterator<[K, V]> {
    for (const key of this.slots.keys()) {
      const v = this.get(key);
      if (v !== undefined) yield [key, v];
    }
  }

  clear(): void {
    this.slots.clear();
  }
}
