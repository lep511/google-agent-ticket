import fc from 'fast-check';

/**
 * Shared `fast-check` configuration for every property-based test.
 *
 * Design → Testing Strategy: "a minimum of 100 iterations per property".
 * `FC_NUM_RUNS` raises the iteration count for long runs, but can never lower
 * it below the declared minimum. `FC_SEED` pins the seed so a failure found in
 * CI can be replayed locally.
 */
export const MIN_PROPERTY_RUNS = 100;

/**
 * Resolves the iteration count from a raw `FC_NUM_RUNS` value. Absent, blank
 * and non-numeric values fall back to the minimum, and a smaller request is
 * raised to it.
 */
export function resolvePropertyRuns(raw: string | undefined): number {
  const requested = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(requested) ? Math.max(MIN_PROPERTY_RUNS, requested) : MIN_PROPERTY_RUNS;
}

export const PROPERTY_RUNS = resolvePropertyRuns(process.env.FC_NUM_RUNS);

/** Parsed `FC_SEED`, or `null` when it is absent or not a number. */
export function resolveSeed(raw: string | undefined): number | null {
  const seed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(seed) ? seed : null;
}

const seed = resolveSeed(process.env.FC_SEED);

fc.configureGlobal({
  numRuns: PROPERTY_RUNS,
  // Report the full, untrimmed counterexample so it can be triaged.
  verbose: fc.VerbosityLevel.Verbose,
  // Stable seed by default: failures are reproducible across runs.
  ...(seed === null ? {} : { seed }),
});
