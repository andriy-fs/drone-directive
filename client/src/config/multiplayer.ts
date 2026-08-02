import type { LockstepConfig } from '@drone-directive/net';
import { gameConfig, worldPixelSize } from './gameConfig';

/**
 * Everything `@drone-directive/net` needs to know about *this* application. The
 * net package deliberately depends on neither the game config nor a bundler, so
 * the two things that are specific to us — where the relay lives and what counts
 * as a plausible order — are supplied from here.
 */

/**
 * WebSocket URL of the relay Worker. Baked at build time (the UI is a static site)
 * via `VITE_MULTIPLAYER_URL`; falls back to a local `wrangler dev` for development.
 */
// `||` (not `??`): CI expands an unset `${{ vars.VITE_MULTIPLAYER_URL }}` to an
// empty string, which must also fall back — otherwise `new URL('')` throws.
export const MULTIPLAYER_URL: string = import.meta.env.VITE_MULTIPLAYER_URL?.trim() || 'ws://localhost:8787';

export const lockstepConfig: LockstepConfig = {
  relayUrl: MULTIPLAYER_URL,
  // A thunk, not a value: `applyMapSize` rewrites `worldPixelSize` for every
  // match, and a bound captured at module load would validate against whichever
  // map happened to load first.
  limits: () => ({
    worldWidth: worldPixelSize.width,
    worldHeight: worldPixelSize.height,
    maxRobots: gameConfig.production.maxRobots,
  }),
};
