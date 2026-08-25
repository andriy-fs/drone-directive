import { PROTOCOL_VERSION } from '@drone-directive/protocol';
import { ClientVersion } from '../store/enums';

/**
 * Is this bundle still the one the site is serving?
 *
 * The answer comes from `version.json`, emitted at the dist root by the build
 * (`vite.config.ts`) and served uncached. Comparing it to what was compiled in is
 * the whole mechanism — there is no version endpoint and no GitHub API call.
 *
 * The relay remains the authority on the protocol: this check only lets the lobby
 * refuse before the first attempt instead of after it. The two can disagree for
 * the minute a deploy has shipped one half and not the other, which is exactly
 * why `GameApp` also escalates on the relay's own `VersionMismatch`.
 */

/** What `version.json` holds. Both fields are written by the build, never by hand. */
export interface VersionManifest {
  /** Short git SHA of the deployed build — compare against `__BUILD_ID__`. */
  build: string;
  /** `PROTOCOL_VERSION` the deployed client speaks, and therefore the relay too. */
  protocol: number;
}

/** Where the manifest is served from, relative to the page. */
export const VERSION_MANIFEST_PATH = '/version.json';

/**
 * The bundle's own identity, as `vite.config.ts` compiled it in.
 *
 * The `typeof` guard is for the two places the define does not reach — the unit
 * tests (`vitest.config.ts` is a separate config) and any consumer that bundles
 * this module itself. Both land on `dev`, which is precisely the value that turns
 * the check off, so an environment without a build id simply has no opinion about
 * whether it is stale.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * True when this bundle was not produced by `vite build` — the dev server emits
 * no manifest, so there is nothing to compare against and the check stays off.
 */
export const IS_DEV_BUILD = BUILD_ID === 'dev';

function isManifest(value: unknown): value is VersionManifest {
  if (typeof value !== 'object' || value === null) return false;
  const { build, protocol } = value as Partial<VersionManifest>;
  return typeof build === 'string' && build.length > 0 && typeof protocol === 'number';
}

/**
 * What the deployed manifest says about the running bundle.
 *
 * Anything unreadable answers `Current`: a manifest that fails to parse is a
 * broken deploy or a captive-portal login page, and neither is a reason to take
 * multiplayer away from someone whose client is fine.
 */
export function evaluateManifest(
  manifest: unknown,
  local: { build: string; protocol: number } = { build: BUILD_ID, protocol: PROTOCOL_VERSION },
): ClientVersion {
  if (!isManifest(manifest)) return ClientVersion.Current;
  // `!==`, not `>`: this mirrors the relay's own rule (`Room.ts`), and a client
  // that is somehow *ahead* of the relay cannot connect either.
  if (manifest.protocol !== local.protocol) return ClientVersion.OnlineBlocked;
  return manifest.build !== local.build ? ClientVersion.UpdateAvailable : ClientVersion.Current;
}
