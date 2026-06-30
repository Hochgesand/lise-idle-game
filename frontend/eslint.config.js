// ESLint flat config (v9+ style) for the Phaser 4 + TypeScript frontend.
//
// Phaser is browser code, so the TS files run with browser globals. The
// prettier config is applied LAST so it disables all formatting-related
// rules that would conflict with `npm run format` (Prettier is authoritative
// for formatting). `@typescript-eslint/no-explicit-any` is relaxed to 'warn'
// because the pure sim and game code may lean on `any` early in development.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores — no separate .eslintignore in flat config.
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '**/*.d.ts', 'src/vite-env.d.ts'],
  },

  // Base JS + TS recommended rule sets.
  js.configs.recommended,
  tseslint.configs.recommended,

  // Browser code (Phaser runs in the DOM).
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Game/sim code may use `any` early; surface it as a warning, not an error.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Let the TS-aware rule handle unused vars; ignore underscore-prefixed args.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Prettier compatibility — must be LAST to turn off conflicting formatting rules.
  prettierConfig,
);
