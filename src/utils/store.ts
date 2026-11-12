import type { GatewayStore } from '../types.js';

/** Shared GatewayStore helpers with eval-Lua fallbacks. */

export async function storeGet(store: GatewayStore, key: string): Promise<string | null> {
  if (store.get) return store.get(key);
  const raw = await store.eval('return redis.call("GET", KEYS[1])', 1, key);
  return typeof raw === 'string' ? raw : null;
}

export async function storeSet(
  store: GatewayStore,
  key: string,
  value: string,
  pxMs?: number,
): Promise<unknown> {
  if (store.set) {
    return pxMs === undefined
      ? store.set(key, value)
      : store.set(key, value, 'PX', pxMs);
  }
  if (pxMs === undefined) {
    return store.eval('redis.call("SET", KEYS[1], ARGV[1]); return 1', 1, key, value);
  }
  return store.eval(
    'redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2]); return 1',
    1,
    key,
    value,
    pxMs,
  );
}

/** Atomic SET ... PX ms NX. Returns true only when the lock was acquired. */
export async function storeSetNX(
  store: GatewayStore,
  key: string,
  value: string,
  pxMs: number,
): Promise<boolean> {
  if (store.set) {
    const res = await store.set(key, value, 'PX', pxMs, 'NX');
    return res === 'OK';
  }
  const raw = await store.eval(
    'local r = redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX"); return r and 1 or 0',
    1,
    key,
    value,
    pxMs,
  );
  return Number(raw) === 1;
}

export async function storeDel(store: GatewayStore, key: string): Promise<void> {
  if (store.del) {
    await store.del(key);
    return;
  }
  await store.eval('return redis.call("DEL", KEYS[1])', 1, key);
}
