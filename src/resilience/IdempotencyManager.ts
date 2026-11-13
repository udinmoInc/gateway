import { createHash, randomUUID } from 'node:crypto';
import { DEFAULTS, HEADERS, STATUS } from '../constants.js';
import { HOP_BY_HOP_SET } from '../shared/httpUtils.js';
import { sleep } from '../shared/timers.js';
import type { GatewayStore, IdempotencyConfig } from '../types.js';
import { storeDel, storeGet, storeSet, storeSetNX } from '../utils/store.js';

export type IdempotencyBegin =
  | { action: 'proceed'; complete: (result: IdempotentResult) => Promise<void>; abort: () => Promise<void> }
  | { action: 'replay'; statusCode: number; headers: Record<string, string>; body: Buffer }
  | { action: 'conflict' }
  | { action: 'fingerprint-mismatch' };

export interface IdempotentResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

interface StoredState {
  state: 'IN_PROGRESS' | 'COMPLETED';
  fingerprint: string;
  node?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string; // base64
}

const HOP = HOP_BY_HOP_SET;
const REPLAY_EXCLUDED = new Set(['x-idempotent-replay']);

function jittered(ms: number): number {
  return ms + Math.floor(Math.random() * ms);
}

/**
 * Distributed idempotency via GatewayStore atomic state machine:
 * IN_PROGRESS (NX+PX lock) → COMPLETED (fingerprint + serialized
 * response). Followers poll with jittered backoff; mismatched payload
 * fingerprints are rejected; failures release the key for safe retry.
 */
export class IdempotencyManager {
  private readonly store: GatewayStore;
  private readonly nodeId: string;

  constructor(store: GatewayStore, nodeId: string = randomUUID()) {
    this.store = store;
    this.nodeId = nodeId;
  }

  keyFor(scope: string, idempotencyKey: string): string {
    return `${DEFAULTS.resilience.idempotencyKeyPrefix}${scope}|${idempotencyKey}`;
  }

  fingerprint(method: string, url: string, rawBody: Buffer): string {
    return createHash('sha256')
      .update(method.toUpperCase())
      .update(' ')
      .update(url)
      .update('\n')
      .update(rawBody)
      .digest('hex');
  }

  /**
   * Attempt to begin an idempotent operation.
   * Returns 'proceed' with complete/abort callbacks when the lock is
   * acquired, a replay/conflict/mismatch decision otherwise.
   */
  async begin(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    options: { ttlMs: number; lockTimeoutMs: number },
  ): Promise<IdempotencyBegin> {
    const key = this.keyFor(scope, idempotencyKey);
    const deadline = Date.now() + options.lockTimeoutMs;

    // Try to acquire the lock; on contention inspect the stored state.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const locked = await storeSetNX(
        this.store,
        key,
        JSON.stringify({ state: 'IN_PROGRESS', fingerprint, node: this.nodeId } satisfies StoredState),
        options.lockTimeoutMs,
      );
      if (locked) {
        return {
          action: 'proceed',
          complete: (result) => this.complete(key, fingerprint, result, options.ttlMs),
          abort: () => storeDel(this.store, key).then(() => undefined),
        };
      }

      const raw = await storeGet(this.store, key);
      if (raw === null) continue; // expired between NX and GET — retry lock

      let state: StoredState;
      try {
        state = JSON.parse(raw) as StoredState;
      } catch {
        await storeDel(this.store, key);
        continue;
      }

      if (state.state === 'COMPLETED') {
        if (state.fingerprint !== fingerprint) {
          return { action: 'fingerprint-mismatch' };
        }
        return {
          action: 'replay',
          statusCode: state.statusCode ?? STATUS.ok,
          headers: state.headers ?? {},
          body: Buffer.from(state.body ?? '', 'base64'),
        };
      }

      // IN_PROGRESS elsewhere — poll until COMPLETED, key loss, or deadline.
      return this.pollForCompletion(key, fingerprint, deadline);
    }
    return { action: 'conflict' };
  }

  private async pollForCompletion(
    key: string,
    fingerprint: string,
    deadline: number,
  ): Promise<IdempotencyBegin> {
    while (Date.now() < deadline) {
      await sleep(jittered(50));
      const raw = await storeGet(this.store, key);
      if (raw === null) {
        // Lock expired without completion — caller may retry acquisition.
        return { action: 'conflict' };
      }
      let state: StoredState;
      try {
        state = JSON.parse(raw) as StoredState;
      } catch {
        return { action: 'conflict' };
      }
      if (state.state === 'COMPLETED') {
        if (state.fingerprint !== fingerprint) {
          return { action: 'fingerprint-mismatch' };
        }
        return {
          action: 'replay',
          statusCode: state.statusCode ?? STATUS.ok,
          headers: state.headers ?? {},
          body: Buffer.from(state.body ?? '', 'base64'),
        };
      }
    }
    return { action: 'conflict' };
  }

  private async complete(
    key: string,
    fingerprint: string,
    result: IdempotentResult,
    ttlMs: number,
  ): Promise<void> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(result.headers)) {
      const lower = name.toLowerCase();
      if (HOP.has(lower) || REPLAY_EXCLUDED.has(lower) || value === undefined) continue;
      headers[lower] = Array.isArray(value) ? value.join(', ') : value;
    }
    const stored: StoredState = {
      state: 'COMPLETED',
      fingerprint,
      statusCode: result.statusCode,
      headers,
      body: result.body.toString('base64'),
    };
    await storeSet(this.store, key, JSON.stringify(stored), ttlMs);
  }
}
