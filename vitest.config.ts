import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Two test projects with separate environments:
 *  - `server`: `node` environment, covers `server/**` and the backend tests in `tests/server/**`
 *  - `web`:    `jsdom` environment with `@testing-library/react`, covers `src/**` and `tests/web/**`
 *
 * The shared `fast-check` configuration (a minimum of 100 iterations per
 * property) lives in `tests/setup/fastCheck.ts`, loaded by both projects.
 */
const sharedAlias = {
  '@': path.resolve(__dirname, '.'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: sharedAlias },
        test: {
          name: 'server',
          environment: 'node',
          globals: false,
          setupFiles: [path.resolve(__dirname, 'tests/setup/fastCheck.ts')],
          include: [
            'tests/server/**/*.test.ts',
            'server/**/*.test.ts',
            'tests/*.test.ts',
          ],
        },
      },
      {
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
          name: 'web',
          environment: 'jsdom',
          globals: false,
          setupFiles: [
            path.resolve(__dirname, 'tests/setup/fastCheck.ts'),
            path.resolve(__dirname, 'tests/setup/dom.ts'),
          ],
          include: [
            'tests/web/**/*.test.{ts,tsx}',
            'src/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
  },
});
