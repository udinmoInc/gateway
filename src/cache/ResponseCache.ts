import { DEFAULTS } from '../constants.js';
import type { GatewayStore } from '../types.js';
import { storeGet, storeSet } from '../utils/store.js';
import { BoundedMap } from '../shared/BoundedMap.js';

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

interface L2Payload {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string; // base64
  storedAt: number;
}

/**
 * Two-tier response cache: fast in-process L1 LRU plus an optional
 * shared L2 GatewayStore tier so horizontally-scaled nodes share
 * entries and serve STALE across the fleet.
 */
export class ResponseCache {
  private readonly map: BoundedMap<string, CacheEntry>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly store: GatewayStore | undefined;
  private readonly l2Prefix: string;

  constructor(
    ttlMs: number,
    maxEntries: number = DEFAULTS.cache.maxEntries,
    now: () => number = Date.now,
    store?: GatewayStore,
    l2Prefix: string = DEFAULTS.resilience.l2KeyPrefix,
  ) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new BoundedMap<string, CacheEntry>({
      maxEntries,
      mode: 'lru',
      now,
    });
    this.store = store;
    this.l2Prefix = l2Prefix;
  }

  /** Synchronous L1-only lookup (hot path). */
  lookup(key: string): CacheLookup {
    const entry = this.map.get(key); // 'lru' refreshes recency
    if (entry === undefined) return {};
    return this.freshness(entry);
  }

  /**
   * L1 → L2 lookup. On L2 hit the entry is hydrated into L1.
   * Falls back to L1-only behavior when no store is configured.
   */
  async lookupShared(key: string): Promise<CacheLookup> {
    const local = this.lookup(key);
    if (local.fresh || local.stale) return local;
    if (!this.store) return local;

    const raw = await storeGet(this.store, this.l2Key(key));
    if (!raw) return local;
    let payload: L2Payload;
    try {
      payload = JSON.parse(raw) as L2Payload;
    } catch {
      return local;
    }
    if (typeof payload.storedAt !== 'number' || typeof payload.body !== 'string') {
      return local;
    }
    const entry: CacheEntry = {
      statusCode: payload.statusCode,
      headers: payload.headers ?? {},
      body: Buffer.from(payload.body, 'base64'),
      storedAt: payload.storedAt,
    };
    this.setLocal(key, entry);
    return this.freshness(entry);
  }

  /** L2-only read — used by cross-node coalescing followers. */
  async lookupL2(key: string): Promise<CacheLookup> {
    if (!this.store) return {};
    const raw = await storeGet(this.store, this.l2Key(key));
    if (!raw) return {};
    let payload: L2Payload;
    try {
      payload = JSON.parse(raw) as L2Payload;
    } catch {
      return {};
    }
    if (typeof payload.storedAt !== 'number' || typeof payload.body !== 'string') {
      return {};
    }
    const entry: CacheEntry = {
      statusCode: payload.statusCode,
      headers: payload.headers ?? {},
      body: Buffer.from(payload.body, 'base64'),
      storedAt: payload.storedAt,
    };
    return this.freshness(entry);
  }

  set(key: string, entry: Omit<CacheEntry, 'storedAt'>): void {
    this.setLocal(key, { ...entry, storedAt: this.now() });
  }

  /** L1 + L2 populate. L2 retention covers the stale window. */
  async setShared(key: string, entry: Omit<CacheEntry, 'storedAt'>): Promise<void> {
    const full: CacheEntry = { ...entry, storedAt: this.now() };
    this.setLocal(key, full);
    if (!this.store) return;
    const payload: L2Payload = {
      statusCode: full.statusCode,
      headers: full.headers,
      body: full.body.toString('base64'),
      storedAt: full.storedAt,
    };
    const retention =
      this.ttlMs * DEFAULTS.resilience.l2StaleRetentionFactor;
    await storeSet(this.store, this.l2Key(key), JSON.stringify(payload), retention).catch(
      () => undefined,
    );
  }

  private freshness(entry: CacheEntry): CacheLookup {
    return this.now() - entry.storedAt <= this.ttlMs
      ? { fresh: entry, stale: entry }
      : { stale: entry };
  }

  private setLocal(key: string, entry: CacheEntry): void {
    this.map.set(key, entry); // bounded LRU eviction is automatic
  }

  private l2Key(key: string): string {
    return `${this.l2Prefix}${key}`;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
