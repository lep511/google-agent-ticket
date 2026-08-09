import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Four test projects: two environments × two costs.
 *
 *  - `server` / `web`: the essential suites, a few seconds end to end. This is
 *    the run for every edit (`npm run test:essential`).
 *  - `server-slow` / `web-slow`: the non-essential ones, minutes end to end,
 *    run before merging (`npm run test:non-essential`).
 *
 * `npm test` still runs all four.
 *
 * The environments are unchanged: `node` for `server/**` and `tests/server/**`,
 * `jsdom` with `@testing-library/react` for `src/**` and `tests/web/**`. The
 * shared `fast-check` configuration (at least 100 iterations per property) lives
 * in `tests/setup/fastCheck.ts` and is loaded by all of them.
 */
const sharedAlias = {
  '@': path.resolve(__dirname, '.'),
};

/*
  The split is by cost, not by value: these suites assert as much as any other,
  their price is repetition. Each one mounts the whole application or builds real
  catalogs on disk once per property case, a hundred cases per property, so the
  iteration count stays where the design put it and the suites move out of the
  edit loop instead.

  Timings from a full run; they are what put each file on this list. The four
  together account for about 227 s of the 231 s the suite spends in tests.
*/
const NON_ESSENTIAL_SERVER_TESTS = [
  'server/lib/agent/agentRegistry.test.ts', // ~5.8 s: real catalogs on disk
  'tests/server/tempCatalog.test.ts',       // ~5.7 s: real catalogs on disk
];

const NON_ESSENTIAL_WEB_TESTS = [
  'src/App.history.test.tsx',              // ~194 s: mounts the whole app
  'src/components/HistoryPanel.test.tsx',  // ~22 s: mounts the panel tree
];

const ESSENTIAL_SERVER_TESTS = [
  'tests/server/**/*.test.ts',
  'server/**/*.test.ts',
  'tests/*.test.ts',
];

const ESSENTIAL_WEB_TESTS = [
  'tests/web/**/*.test.{ts,tsx}',
  'src/**/*.test.{ts,tsx}',
];

/** Vitest's own exclusions (`node_modules`, `dist`, …) plus the given globs. */
const excluding = (globs: string[]) => [...configDefaults.exclude, ...globs];

interface ProjectSpec {
  name: string;
  include: string[];
  /** Globs to leave out, on top of the defaults. */
  exclude?: string[];
}

/** Backend project: plain Node, no DOM. */
const serverProject = ({ name, include, exclude = [] }: ProjectSpec) => ({
  resolve: { alias: sharedAlias },
  test: {
    name,
    environment: 'node' as const,
    globals: false,
    setupFiles: [path.resolve(__dirname, 'tests/setup/fastCheck.ts')],
    include,
    exclude: excluding(exclude),
  },
});

/** Frontend project: jsdom, React, and animations stubbed out. */
const webProject = ({ name, include, exclude = [] }: ProjectSpec) => ({
  plugins: [react()],
  resolve: {
    alias: {
      ...sharedAlias,
      // Animations add nothing to the assertions but dominate the cost of
      // mounting the tree inside a 100-iteration property test.
      'motion/react': path.resolve(__dirname, 'tests/helpers/motionStub.tsx'),
    },
  },
  define: { global: 'window' },
  test: {
    name,
    environment: 'jsdom' as const,
    globals: false,
    setupFiles: [
      path.resolve(__dirname, 'tests/setup/fastCheck.ts'),
      path.resolve(__dirname, 'tests/setup/dom.ts'),
    ],
    include,
    exclude: excluding(exclude),
  },
});

export default defineConfig({
  test: {
    projects: [
      serverProject({
        name: 'server',
        include: ESSENTIAL_SERVER_TESTS,
        exclude: NON_ESSENTIAL_SERVER_TESTS,
      }),
      serverProject({
        name: 'server-slow',
        include: NON_ESSENTIAL_SERVER_TESTS,
      }),
      webProject({
        name: 'web',
        include: ESSENTIAL_WEB_TESTS,
        exclude: NON_ESSENTIAL_WEB_TESTS,
      }),
      webProject({
        name: 'web-slow',
        include: NON_ESSENTIAL_WEB_TESTS,
      }),
    ],
  },
});
