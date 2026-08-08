/**
 * Bundles the Vercel serverless API functions with esbuild.
 *
 * Each file in api/*.ts is bundled into a self-contained .js file that Vercel
 * can run without resolving .ts imports at runtime.
 */
import { build } from 'esbuild';
import { readdirSync } from 'fs';
import path from 'path';

const apiSrcDir = path.resolve('api-src');
const entries = readdirSync(apiSrcDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => path.join(apiSrcDir, f));

await build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'api',
  outExtension: { '.js': '.mjs' },
  // Bundle all local .ts modules; keep npm packages external (Vercel installs them).
  packages: 'external',
  // Resolve .ts extension imports that the project uses everywhere.
  resolveExtensions: ['.ts', '.tsx', '.js', '.json'],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  sourcemap: false,
  minify: false,
});

console.log(`[build-api] Bundled ${entries.length} API functions.`);
