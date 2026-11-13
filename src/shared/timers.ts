import type { Duplex } from 'node:stream';
import type { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DeadlineTimer {
  /** Cancel the pending fire. Idempotent. */
  clear(): void;
  /** True once the timeout callback has run. */
  readonly fired: boolean;
}

/**
 * Single-source timeout handle: always unref'd (never keeps the event
 * loop alive), cleared exactly once, and reports whether it fired.
 */
export function deadlineTimer(ms: number, onTimeout: () => void): DeadlineTimer {
  let fired = false;
  let cleared = false;
  const timer = setTimeout(() => {
    fired = true;
    cleared = true;
    onTimeout();
  }, ms);
  timer.unref?.();
  return {
    clear() {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
    },
    get fired() {
      return fired;
    },
  };
}

/**
 * Best-effort teardown of sockets/streams — destroy() never throws on
 * already-closed handles, and errors are swallowed so shutdown paths
 * can't be crashed by a half-dead peer.
 */
export function destroySafely(
  ...targets: ReadonlyArray<Duplex | Socket | ServerResponse | undefined | null>
): void {
  for (const t of targets) {
    if (t === undefined || t === null) continue;
    try {
      t.destroy();
    } catch {
      // already destroyed / closing — nothing to do
    }
  }
}
