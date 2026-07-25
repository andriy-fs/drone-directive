/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the multiplayer relay Worker (see `@drone-directive/server`). */
  readonly VITE_MULTIPLAYER_URL?: string;
}
