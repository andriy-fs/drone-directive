import { useRef } from 'react';
import { useGameApp } from './hooks/useGameApp';

/**
 * The React boundary for the Pixi world: a plain host div that useGameApp mounts
 * the PIXI.Application into. React never renders game entities — it only owns
 * this container element.
 */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  useGameApp(hostRef);
  return <div ref={hostRef} className="game-canvas" />;
}
