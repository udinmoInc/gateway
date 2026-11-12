import { DEFAULTS } from '../constants.js';

export interface CacheEntry {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** Epoch ms when the entry was stored. */
  storedAt: number;
}

export interface CacheLookup {
  /** Entry still within TTL. */
  fresh?: CacheEntry;
  /** Entry past TTL (candidate for stale-while-circuit-open). */
  stale?: CacheEntry;
}

/**
 * Bounded LRU response cache for GET/HEAD upstream responses.
 * Map insertion order provides O(1) LRU eviction.
 */
export class ResponseCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    ttlMs: number,
    maxEntries: number = DEFAULTS.cache.maxEntries,
    now: () => number = Date.now,
  ) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  lookup(key: string): CacheLookup {
    const entry = this.map.get(key);
    if (entry === undefined) return {};
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, entry);
    return this.now() - entry.storedAt <= this.ttlMs
      ? { fresh: entry, stale: entry }
      : { stale: entry };
  }

  set(key: string, entry: Omit<CacheEntry, 'storedAt'>): void {
    this.map.delete(key);
    this.map.set(key, { ...entry, storedAt: this.now() });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
