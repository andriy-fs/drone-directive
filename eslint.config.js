import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * One config at the repo root so every workspace is linted, not just `client`.
 * The React rules are scoped to `client/` — nothing else in the monorepo has a
 * component in it, and applying them elsewhere would only produce noise.
 */
export default defineConfig([
  globalIgnores([
    '**/dist',
    // Emitted by `npm run codegen -w protocol`; its style is the generator's.
    'protocol/src/generated',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    // The relay runs on Cloudflare Workers, not in a browser tab.
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.worker, WebSocketPair: 'readonly', DurableObject: 'readonly' },
    },
  },
  {
    files: ['**/*.mjs', '**/*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
