/* ──────────────────────────────────────────────────────────── */
/*  Shared test setup                                            */
/*                                                               */
/*  The property tests inherit their iteration count from the      */
/*  global fast-check configuration instead of declaring it, so a   */
/*  setup file that failed to load would silently drop every        */
/*  property back to fast-check's own defaults, with no seed and    */
/*  no verbose counterexample.                                     */
/* ──────────────────────────────────────────────────────────── */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MIN_PROPERTY_RUNS,
  PROPERTY_RUNS,
  resolvePropertyRuns,
  resolveSeed,
} from '../setup/fastCheck.ts';

describe('shared fast-check configuration', () => {
  it('requires at least 100 iterations per property', () => {
    expect(MIN_PROPERTY_RUNS).toBe(100);
    expect(PROPERTY_RUNS).toBeGreaterThanOrEqual(MIN_PROPERTY_RUNS);
  });

  it('is applied globally, so properties do not have to declare numRuns', () => {
    const global = fc.readConfigureGlobal();

    expect(global.numRuns).toBe(PROPERTY_RUNS);
    expect(global.verbose).toBe(fc.VerbosityLevel.Verbose);
  });

  it('never lowers the minimum, whatever FC_NUM_RUNS asks for', () => {
    expect(resolvePropertyRuns(undefined)).toBe(MIN_PROPERTY_RUNS);
    expect(resolvePropertyRuns('')).toBe(MIN_PROPERTY_RUNS);
    expect(resolvePropertyRuns('not a number')).toBe(MIN_PROPERTY_RUNS);
    expect(resolvePropertyRuns('1')).toBe(MIN_PROPERTY_RUNS);
    expect(resolvePropertyRuns(String(MIN_PROPERTY_RUNS - 1))).toBe(MIN_PROPERTY_RUNS);
  });

  it('raises the iteration count when FC_NUM_RUNS asks for more', () => {
    expect(resolvePropertyRuns('500')).toBe(500);
  });

  it('only pins the seed when FC_SEED is numeric', () => {
    expect(resolveSeed(undefined)).toBeNull();
    expect(resolveSeed('')).toBeNull();
    expect(resolveSeed('abc')).toBeNull();
    expect(resolveSeed('42')).toBe(42);
  });
});
