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
    // Staging tree for `npm run publish:client`; a copy of client/dist plus a manifest.
    'client/.pack',
    // Staging tree and uploadable archives for `npm run pack:itch`; a build of client/, not source.
    'client/.itch',
    'itch.io',
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
    /**
     * The ratchet on the ECS archetype layer. `engine/ecs/archetypes.ts` gives
     * every entity kind a named shape and `engine/ecs/queries.ts` hands each
     * query back already narrowed, so a system reading `e.position` needs no
     * assertion — the query it came from established that. Before that layer
     * existed there were 213 `!` in these two directories, and the ones hiding a
     * real risk (an id lookup that could return anything) were indistinguishable
     * from the ~180 that were pure noise. This rule is what keeps them apart.
     *
     * Tests are exempt: they poke fields on deliberately wide `Entity` handles so
     * a broken schema can't hide behind an archetype. Not on by default — the
     * rule lives in typescript-eslint's `strict` preset, not `recommended`.
     */
    files: ['client/src/engine/**/*.ts', 'client/src/pixi/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
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
