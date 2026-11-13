import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DEFAULTS } from '../constants.js';

/**
 * Event-loop lag + in-flight concurrency load shedder.
 * Rejects new work with 503 before it can pile onto an already
 * saturated event loop (head-of-line blocking protection).
 */
export class LoadShedder {
  private readonly histogram = monitorEventLoopDelay({
    resolution: DEFAULTS.networking.eventLoopResolutionMs,
  });
  private readonly maxEventLoopDelayMs: number;
  private readonly maxConcurrentRequests: number | undefined;
  private inFlightCount = 0;
  private enabled = false;

  constructor(options: {
    maxEventLoopDelayMs?: number;
    maxConcurrentRequests?: number;
  } = {}) {
    this.maxEventLoopDelayMs =
      options.maxEventLoopDelayMs ?? DEFAULTS.networking.maxEventLoopDelayMs;
    this.maxConcurrentRequests = options.maxConcurrentRequests;
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.histogram.enable();
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.histogram.disable();
  }

  enter(): void {
    this.inFlightCount += 1;
  }

  leave(): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
  }

  get inFlight(): number {
    return this.inFlightCount;
  }

  /** p99 event-loop delay in milliseconds. */
  eventLoopDelayP99Ms(): number {
    if (!this.enabled) return 0;
    return this.histogram.percentile(99) / 1e6;
  }

  shouldShed(): boolean {
    if (this.maxConcurrentRequests !== undefined &&
        this.inFlightCount >= this.maxConcurrentRequests) {
      return true;
    }
    return this.eventLoopDelayP99Ms() > this.maxEventLoopDelayMs;
  }
}
