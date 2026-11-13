import cluster from 'node:cluster';
import type { Worker as ClusterProcess } from 'node:cluster';
import os from 'node:os';

/** Minimal gateway surface the supervisor needs. */
export interface ClusterGateway {
  listen(port?: number, host?: string): Promise<void>;
  shutdown(options?: { drainTimeoutMs?: number }): Promise<void>;
  close(): Promise<void>;
}

export interface ClusterOptions {
  /** Worker count. Default os.availableParallelism(). */
  workers?: number;
  /** Delay before respawning a crashed worker (ms). Default 1000. */
  respawnDelayMs?: number;
}

const SHUTDOWN_MESSAGE = 'gateway:shutdown';

/**
 * Multi-core supervisor built on node:cluster.
 *
 * Usage: call `gateway.listenCluster()` from the primary process — it
 * forks `workers` copies of the current process. Each worker re-runs
 * the entrypoint, calls `listenCluster()` again, sees `cluster.isWorker`
 * and falls through to a normal `listen()` with graceful SIGTERM
 * handling, so `gateway.listen()` / adapters stay untouched.
 *
 * - Worker crash  → respawned after `respawnDelayMs`.
 * - SIGTERM       → workers drain via shutdown message, then exit.
 * - SIGUSR2       → rolling restart: spawn replacement, then retire old.
 */
export async function listenCluster(
  gateway: ClusterGateway,
  options: ClusterOptions = {},
): Promise<void> {
  // ---- worker path: behave exactly like listen() + graceful signals ----
  if (cluster.isWorker) {
    await gateway.listen();
    const shutdown = (): void => {
      void gateway.shutdown().finally(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('message', (msg) => {
      if (msg === SHUTDOWN_MESSAGE) shutdown();
    });
    return;
  }

  // ---- primary path: fork + supervise ----
  const workerCount = options.workers ?? os.availableParallelism();
  const respawnDelayMs = options.respawnDelayMs ?? 1_000;
  const workers = new Set<ClusterProcess>();
  let shuttingDown = false;

  const spawn = (): void => {
    if (shuttingDown) return;
    const worker = cluster.fork();
    workers.add(worker);
    worker.on('exit', () => {
      workers.delete(worker);
      if (!shuttingDown) {
        setTimeout(spawn, respawnDelayMs).unref();
      }
    });
    worker.on('error', () => {
      // exit handler above covers respawn
    });
  };

  for (let i = 0; i < workerCount; i += 1) spawn();

  const retire = (worker: ClusterProcess): void => {
    worker.send(SHUTDOWN_MESSAGE);
    // Hard-kill fallback if the worker doesn't drain in time.
    setTimeout(() => {
      if (!worker.isDead?.() && workers.has(worker)) worker.kill('SIGKILL');
    }, 15_000).unref();
    worker.on('exit', () => workers.delete(worker));
  };

  process.on('SIGTERM', () => {
    shuttingDown = true;
    for (const w of workers) retire(w);
    // Primary exits once all workers are gone.
    const wait = setInterval(() => {
      if (workers.size === 0) {
        clearInterval(wait);
        process.exit(0);
      }
    }, 100);
    wait.unref();
  });

  process.on('SIGINT', () => {
    process.emit('SIGTERM');
  });

  // Rolling restart: replace each worker one at a time.
  process.on('SIGUSR2', () => {
    const snapshot = [...workers];
    for (const w of snapshot) {
      spawn();
      retire(w);
    }
  });

  // Keep the primary alive while workers run.
  await new Promise<void>(() => {
    /* primary stays alive until SIGTERM */
  });
}
