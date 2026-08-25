/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the multiplayer relay Worker (see `@drone-directive/server`). */
  readonly VITE_MULTIPLAYER_URL?: string;
}

/**
 * Identifies this bundle — a short git SHA, or `dev` when it was not built by
 * `vite build`. Compiled in by `define` in `vite.config.ts`; compared against the
 * deployed `version.json` by `config/version.ts`.
 */
declare const __BUILD_ID__: string;
