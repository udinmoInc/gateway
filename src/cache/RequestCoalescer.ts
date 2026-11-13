import { randomUUID } from 'node:crypto';
import { DEFAULTS } from '../constants.js';
import type { GatewayStore } from '../types.js';
import type { CacheEntry } from './ResponseCache.js';
import { storeDel, storeSetNX } from '../utils/store.js';
import { BoundedMap } from '../shared/BoundedMap.js';
import { sleep } from '../shared/timers.js';

/**
 * Two-layer request coalescing for cacheable GET/HEAD traffic:
 *
 * 1. In-process singleflight — concurrent identical misses on this
 *    node share one upstream fetch via the `inflight` promise map.
 * 2. Cross-node lease — `SET NX PX` on GatewayStore elects a single
 *    leader per key across the fleet; followers poll the shared L2
 *    cache and replay the populated entry (X-Coalesced: true).
 */
export class RequestCoalescer {
  private readonly inflight: BoundedMap<string, Promise<CacheEntry>>;
  private readonly store: GatewayStore | undefined;
  private readonly leaseMs: number;
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly nodeId: string;

  constructor(
    store: GatewayStore | undefined,
    options: {
      leaseMs?: number;
      waitMs?: number;
      pollMs?: number;
      nodeId?: string;
      /** Bound on concurrent in-flight upstream fetches. */
      maxInflight?: number;
    } = {},
  ) {
    this.store = store;
    this.inflight = new BoundedMap<string, Promise<CacheEntry>>({
      maxEntries: options.maxInflight ?? DEFAULTS.cache.maxEntries,
    });
    this.leaseMs = options.leaseMs ?? DEFAULTS.resilience.coalesceLeaseMs;
    this.waitMs = options.waitMs ?? DEFAULTS.resilience.coalesceWaitMs;
    this.pollMs = options.pollMs ?? DEFAULTS.resilience.coalescePollMs;
    this.nodeId = options.nodeId ?? randomUUID();
  }

  /** Existing in-flight upstream fetch for this key, if any. */
  get<T>(key: string): Promise<T> | undefined {
    return this.inflight.get(key) as Promise<T> | undefined;
  }

  set<T>(key: string, promise: Promise<T>): void {
    this.inflight.set(key, promise as Promise<CacheEntry>);
  }

  delete(key: string): void {
    this.inflight.delete(key);
  }

  leaseKey(key: string): string {
    return `${DEFAULTS.resilience.leaseKeyPrefix}${key}`;
  }

  /**
   * Try to become the cross-node leader for this cache key.
   * Returns false when another node holds the lease.
   */
  async acquireLease(key: string): Promise<boolean> {
    if (!this.store) return true; // single-node: always lead
    return storeSetNX(
      this.store,
      this.leaseKey(key),
      this.nodeId,
      this.leaseMs,
    );
  }

  async releaseLease(key: string): Promise<void> {
    if (!this.store) return;
    await storeDel(this.store, this.leaseKey(key)).catch(() => undefined);
  }

  /**
   * Follower path: poll the shared L2 cache until an entry appears or
   * the wait budget expires. Returns the fresh entry or null.
   */
  async waitForShared(
    key: string,
    readL2: () => Promise<{ fresh?: CacheEntry; stale?: CacheEntry }>,
  ): Promise<CacheEntry | null> {
    if (!this.store) return null;
    const deadline = Date.now() + this.waitMs;
    while (Date.now() < deadline) {
      await sleep(this.pollMs);
      const { fresh, stale } = await readL2();
      const entry = fresh ?? stale;
      if (entry) return entry;
    }
    return null;
  }
}
