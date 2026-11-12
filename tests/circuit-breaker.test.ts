import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/core/CircuitBreaker.js';
import { CIRCUIT_STATES } from '../src/constants.js';

const KEY = 'route|http://upstream';

describe('CircuitBreaker', () => {
  it('stays closed below failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure(KEY);
    cb.recordFailure(KEY);
    expect(cb.stateOf(KEY)).toBe(CIRCUIT_STATES.closed);
    expect(cb.canExecute(KEY)).toBe(true);
  });

  it('opens after threshold and blocks requests', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000 });
    cb.recordFailure(KEY);
    cb.recordFailure(KEY);
    expect(cb.stateOf(KEY)).toBe(CIRCUIT_STATES.open);
    expect(cb.canExecute(KEY)).toBe(false);
  });

  it('transitions to half-open after cooldown and closes on probe successes', () => {
    let now = 0;
    const cb = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 2, openDurationMs: 1000 },
      () => now,
    );
    cb.recordFailure(KEY);
    expect(cb.canExecute(KEY)).toBe(false);

    now = 1500; // past cooldown
    expect(cb.canExecute(KEY)).toBe(true); // probe 1
    cb.recordSuccess(KEY);
    expect(cb.stateOf(KEY)).toBe(CIRCUIT_STATES.halfOpen);
    expect(cb.canExecute(KEY)).toBe(true); // probe 2
    cb.recordSuccess(KEY);
    expect(cb.stateOf(KEY)).toBe(CIRCUIT_STATES.closed);
  });

  it('re-opens when a half-open probe fails', () => {
    let now = 0;
    const cb = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 2, openDurationMs: 1000 },
      () => now,
    );
    cb.recordFailure(KEY);
    now = 1500;
    expect(cb.canExecute(KEY)).toBe(true);
    cb.recordFailure(KEY);
    expect(cb.stateOf(KEY)).toBe(CIRCUIT_STATES.open);
    expect(cb.canExecute(KEY)).toBe(false);
  });

  it('limits concurrent half-open probes', () => {
    let now = 0;
    const cb = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 2, openDurationMs: 1000 },
      () => now,
    );
    cb.recordFailure(KEY);
    now = 1500;
    expect(cb.canExecute(KEY)).toBe(true);
    expect(cb.canExecute(KEY)).toBe(true);
    expect(cb.canExecute(KEY)).toBe(false); // in-flight cap reached
  });

  it('reset clears all state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure(KEY);
    cb.reset();
    expect(cb.stateOf(KEY)).toBe(CIRCUIT_STATES.closed);
  });
});
