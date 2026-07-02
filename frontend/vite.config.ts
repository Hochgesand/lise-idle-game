/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite config for the Phaser 4 + TypeScript frontend.
// `base: './'` keeps built asset URLs relative so the static bundle works
// behind Traefik at any routed path. Vitest runs in jsdom for DOM-free unit
// tests of the pure simulation core.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
  },
  // Phaser's 8.4 MB phaser.esm.js blows past the WASM memory ceiling of the
  // es-module-lexer pass in `vite dev` (RangeError: WebAssembly.Memory.grow →
  // reported as "invalid JS syntax"), killing the dev server at startup.
  // The pre-minified ESM build (1.3 MB) is the same module and parses fine, so
  // resolve to it and skip pointless prebundling of it. `vite build` and the
  // Phaser-free Vitest suite are unaffected.
  // (Absolute file path — phaser's `exports` field does not expose the dist
  // subpath, so a bare-specifier alias would be refused by vite-resolve.)
  resolve: {
    alias: {
      phaser: fileURLToPath(
        new URL('./node_modules/phaser/dist/phaser.esm.min.js', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    exclude: ['phaser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // No tests exist yet during setup; once T007+ land tests this is a no-op.
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
