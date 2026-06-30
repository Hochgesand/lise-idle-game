/// <reference types="vitest/config" />
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
