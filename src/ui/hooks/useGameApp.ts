import { useEffect } from 'react';
import type { RefObject } from 'react';
import { GameApp } from '../../pixi/GameApp';

/**
 * Mounts a GameApp into the given host element for the component's lifetime and
 * tears it down on unmount.
 *
 * StrictMode-safe: `init()` is async, so cleanup may fire before it resolves. We
 * key the teardown off the init promise so destroy always runs exactly once,
 * whichever order mount/unmount interleave in. GameApp.destroy() is also
 * idempotent as a backstop.
 */
export function useGameApp(hostRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const gameApp = new GameApp();
    const ready = gameApp
      .init(host)
      .then(() => gameApp)
      .catch((err: unknown) => {
        console.error('Failed to initialise GameApp', err);
        return null;
      });

    return () => {
      void ready.then((app) => app?.destroy());
    };
  }, [hostRef]);
}
