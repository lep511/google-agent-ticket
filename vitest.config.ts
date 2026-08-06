import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Two test projects with separate environments:
 *  - `server`: entorno `node`, cubre `server/**` y las pruebas de backend en `tests/server/**`
 *  - `web`:    entorno `jsdom` con `@testing-library/react`, cubre `src/**` y `tests/web/**`
 *
 * La configuración compartida de `fast-check` (mínimo 100 iteraciones por
 * propiedad) vive en `tests/setup/fastCheck.ts`, cargado por ambos proyectos.
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
        resolve: { alias: sharedAlias },
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
