import { CIRCUIT_STATES, DEFAULTS } from '../constants.js';
import type { CircuitBreakerOptions, CircuitState, GatewayStore } from '../types.js';
import { storeDel, storeGet, storeSet, storeSetNX } from '../utils/store.js';

interface BreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number;
  halfOpenInFlight: number;
  /** Requests observed since last close (ratio window). */
  windowRequests: number;
  /** Failures observed since last close (ratio window). */
  windowFailures: number;
}

interface OpenMarker {
  openedAt: number;
}

export interface CircuitBreakerLike {
  /** Returns true if a request may proceed for this key. */
  canExecute(key: string): boolean;
  /** Record an upstream success for this key. */
  recordSuccess(key: string): void;
  /** Record an upstream failure for this key. */
  recordFailure(key: string): void;
  /** Current state for observability. */
  stateOf(key: string): CircuitState;
  /** Drop all state (tests / config reload). */
  reset(): void;
}

/**
 * CLOSED -> OPEN -> HALF_OPEN state machine, keyed per route+upstream.
 * OPEN blocks traffic for openDurationMs, then allows a limited number of
 * probe requests. Probes need `successThreshold` consecutive successes to
 * close; any failure re-opens immediately.
 *
 * When a GatewayStore is attached, OPEN transitions are published as
 * markers so peer nodes respect them immediately, and HALF_OPEN probes
 * are gated by an atomic NX lease so only one node probes at a time.
 */
export class CircuitBreaker implements CircuitBreakerLike {
  private readonly states = new Map<string, BreakerState>();
  private readonly defaults: CircuitBreakerOptions;
  private readonly overrides = new Map<string, Partial<CircuitBreakerOptions>>();
  private readonly now: () => number;
  private store: GatewayStore | undefined;
  private nodeId = 'local';

  constructor(
    defaults: Partial<CircuitBreakerOptions> = {},
    now: () => number = Date.now,
  ) {
    this.defaults = { ...DEFAULTS.circuitBreaker, ...defaults };
    this.now = now;
  }

  /** Attach a shared store for cross-node OPEN propagation + probe leases. */
  setDistributedStore(store: GatewayStore, nodeId: string): void {
    this.store = store;
    this.nodeId = nodeId;
  }

  /** Register per-key option overrides (e.g. per route). */
  configure(key: string, options: Partial<CircuitBreakerOptions>): void {
    this.overrides.set(key, { ...this.overrides.get(key), ...options });
  }

  canExecute(key: string): boolean {
    const state = this.getOrCreate(key);
    const opts = this.optionsFor(key);
    const now = this.now();

    switch (state.state) {
      case CIRCUIT_STATES.closed:
        state.windowRequests += 1;
        return true;
      case CIRCUIT_STATES.open:
        if (now - state.openedAt >= opts.openDurationMs) {
          state.state = CIRCUIT_STATES.halfOpen;
          state.consecutiveSuccesses = 0;
          state.halfOpenInFlight = 0;
          return this.canExecute(key);
        }
        return false;
      case CIRCUIT_STATES.halfOpen:
        // Limit concurrent probes to avoid a thundering herd.
        if (state.halfOpenInFlight >= opts.successThreshold) return false;
        state.halfOpenInFlight += 1;
        return true;
    }
  }

  /**
   * Distributed-aware canExecute: honors OPEN markers published by peer
   * nodes and serializes HALF_OPEN probes across the fleet via an
   * atomic NX lease. Falls back to local behavior without a store.
   */
  async canExecuteShared(key: string): Promise<boolean> {
    if (this.store) {
      const marker = await storeGet(this.store, this.openKey(key));
      if (marker !== null) {
        let openedAt = this.now();
        try {
          openedAt = (JSON.parse(marker) as OpenMarker).openedAt ?? openedAt;
        } catch {
          // malformed marker — treat as freshly opened
        }
        const state = this.getOrCreate(key);
        if (state.state !== CIRCUIT_STATES.open) {
          state.state = CIRCUIT_STATES.open;
          state.openedAt = openedAt;
          state.windowRequests = 0;
          state.windowFailures = 0;
        }
        return false;
      }

      // Probe lease: only one node may probe a recovering upstream.
      const local = this.states.get(key);
      const opts = this.optionsFor(key);
      const probeCandidate =
        local !== undefined &&
        (local.state === CIRCUIT_STATES.halfOpen ||
          (local.state === CIRCUIT_STATES.open &&
            this.now() - local.openedAt >= opts.openDurationMs));
      if (probeCandidate) {
        const leased = await storeSetNX(
          this.store,
          this.probeKey(key),
          this.nodeId,
          Math.min(opts.openDurationMs, 30_000),
        );
        if (!leased) return false;
      }
    }
    return this.canExecute(key);
  }

  /** State including peer-published OPEN markers. */
  async stateOfShared(key: string): Promise<CircuitState> {
    const local = this.stateOf(key);
    if (local === CIRCUIT_STATES.open || !this.store) return local;
    const marker = await storeGet(this.store, this.openKey(key));
    return marker !== null ? CIRCUIT_STATES.open : local;
  }

  recordSuccess(key: string): void {
    const state = this.getOrCreate(key);
    const opts = this.optionsFor(key);
    state.consecutiveFailures = 0;

    if (state.state === CIRCUIT_STATES.halfOpen) {
      state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
      state.consecutiveSuccesses += 1;
      if (state.consecutiveSuccesses >= opts.successThreshold) {
        state.state = CIRCUIT_STATES.closed;
        state.consecutiveSuccesses = 0;
        state.windowRequests = 0;
        state.windowFailures = 0;
        this.releaseDistributed(key);
      }
      return;
    }
    state.consecutiveSuccesses = 0;
  }

  recordFailure(key: string): void {
    const state = this.getOrCreate(key);
    const opts = this.optionsFor(key);
    state.consecutiveSuccesses = 0;

    if (state.state === CIRCUIT_STATES.halfOpen) {
      state.halfOpenInFlight = Math.max(0, state.halfOpenInFlight - 1);
      state.consecutiveFailures = opts.failureThreshold;
      this.open(key, state, opts.openDurationMs);
      return;
    }

    state.consecutiveFailures += 1;
    state.windowFailures += 1;

    const ratio = opts.failureRatioThreshold;
    const minReq = opts.minimumRequests ?? 0;
    const ratioTripped =
      ratio !== undefined &&
      state.windowRequests >= minReq &&
      state.windowFailures / Math.max(1, state.windowRequests) >= ratio;

    // Ratio mode (when configured) replaces the consecutive-failure check.
    if (ratio !== undefined) {
      if (ratioTripped) this.open(key, state, opts.openDurationMs);
      return;
    }
    if (state.consecutiveFailures >= opts.failureThreshold) {
      this.open(key, state, opts.openDurationMs);
    }
  }

  private open(key: string, state: BreakerState, openDurationMs: number): void {
    state.state = CIRCUIT_STATES.open;
    state.openedAt = this.now();
    state.windowRequests = 0;
    state.windowFailures = 0;
    if (this.store) {
      const marker: OpenMarker = { openedAt: state.openedAt };
      void storeSet(
        this.store,
        this.openKey(key),
        JSON.stringify(marker),
        openDurationMs,
      ).catch(() => undefined);
    }
  }

  /** Best-effort release of open marker + probe lease after recovery. */
  private releaseDistributed(key: string): void {
    if (!this.store) return;
    void storeDel(this.store, this.openKey(key)).catch(() => undefined);
    void storeDel(this.store, this.probeKey(key)).catch(() => undefined);
  }

  private openKey(key: string): string {
    return `${DEFAULTS.resilience.cbKeyPrefix}open:${key}`;
  }

  private probeKey(key: string): string {
    return `${DEFAULTS.resilience.cbKeyPrefix}probe:${key}`;
  }

  stateOf(key: string): CircuitState {
    return this.states.get(key)?.state ?? CIRCUIT_STATES.closed;
  }

  reset(): void {
    this.states.clear();
  }

  private getOrCreate(key: string): BreakerState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        state: CIRCUIT_STATES.closed,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        openedAt: 0,
        halfOpenInFlight: 0,
        windowRequests: 0,
        windowFailures: 0,
      };
      this.states.set(key, state);
    }
    return state;
  }

  private optionsFor(key: string): CircuitBreakerOptions {
    return { ...this.defaults, ...this.overrides.get(key) };
  }
}
