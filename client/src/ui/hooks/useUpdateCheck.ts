import { useEffect } from 'react';
import { evaluateManifest, IS_DEV_BUILD, VERSION_MANIFEST_PATH } from '../../config/version';
import { useGameStore } from '../../store/gameStore';

/** Floor between two fetches, so returning to the tab repeatedly costs nothing. */
const RECHECK_AFTER_MS = 5 * 60 * 1000;

let lastCheckedAt = 0;

/**
 * Asks the site whether this bundle is still current, and reports the answer to
 * the store (`clientVersion`). Runs on the title screen only — mounted by
 * `MainMenu` — and again when the tab comes back into view, which is what catches
 * the case this exists for: a tab left open across a deploy.
 *
 * Every failure is swallowed. Offline, a 404, a proxy serving HTML — none of them
 * are news about the client, and `evaluateManifest` reads unparseable input as
 * "current" for the same reason.
 *
 * Inside the desktop shell this is self-referential and silent: the packaged
 * bundle carries its own `version.json`, so it always compares equal. A desktop
 * client learns it is stale from the relay instead (`GameApp`), which is the
 * right answer there — reloading the page would fix nothing.
 */
export function useUpdateCheck(): void {
  useEffect(() => {
    if (IS_DEV_BUILD) return; // no manifest on the dev server — see config/version.ts

    let cancelled = false;

    const check = () => {
      const now = Date.now();
      if (now - lastCheckedAt < RECHECK_AFTER_MS) return;
      lastCheckedAt = now;
      void fetch(VERSION_MANIFEST_PATH, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((manifest: unknown) => {
          if (!cancelled) useGameStore.getState().reportClientVersion(evaluateManifest(manifest));
        })
        .catch(() => {});
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
