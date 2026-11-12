import { CIRCUIT_STATES, DEFAULTS } from '../constants.js';
import type { CircuitBreakerOptions, CircuitState } from '../types.js';

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
 */
export class CircuitBreaker implements CircuitBreakerLike {
  private readonly states = new Map<string, BreakerState>();
  private readonly defaults: CircuitBreakerOptions;
  private readonly overrides = new Map<string, Partial<CircuitBreakerOptions>>();
  private readonly now: () => number;

  constructor(
    defaults: Partial<CircuitBreakerOptions> = {},
    now: () => number = Date.now,
  ) {
    this.defaults = { ...DEFAULTS.circuitBreaker, ...defaults };
    this.now = now;
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
      this.open(state);
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
      if (ratioTripped) this.open(state);
      return;
    }
    if (state.consecutiveFailures >= opts.failureThreshold) {
      this.open(state);
    }
  }

  private open(state: BreakerState): void {
    state.state = CIRCUIT_STATES.open;
    state.openedAt = this.now();
    state.windowRequests = 0;
    state.windowFailures = 0;
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
