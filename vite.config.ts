import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // amazon-cognito-identity-js expects a Node-style `global` in the browser.
    define: {
      global: 'window',
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      fs: {
        strict: true,
        // In dev, Vite serves the project root, so the server-side files are
        // denied explicitly. Without this the agent prompts and schemas the
        // catalog deliberately keeps private (see `/api/agents`) are readable
        // over HTTP, and so is the server source. Overriding `deny` replaces
        // Vite's defaults, so those are repeated here.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          // Server code and its libraries.
          '**/server.ts',
          '**/server/**',
          // Agent definitions: prompts, schemas and manifests are server only.
          '**/agent/**',
          // Run logs are exposed deliberately through the `/run_logs` mount.
          '**/run_logs/**',
          // Lockfiles and stray root scripts have no reason to be served.
          '**/package-lock.json',
          '**/bun.lock',
          '**/test_*.ts',
          '**/test_*.js',
        ],
      },
    },
  };
});
