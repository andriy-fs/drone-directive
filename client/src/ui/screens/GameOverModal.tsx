import type { CSSProperties } from 'react';
import { gameOverBackdropSrc } from '../../config/sprites';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { GameStatus, OutcomePhase } from '../../store/enums';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { Button } from '../common/Button';

/**
 * Victory / defeat overlay. Shown when the loop sets a terminal status. Restart
 * flips `restartRequested`; the game loop observes it, rebuilds the world, and
 * resets the store back to `playing` — which hides this modal again.
 *
 * The backdrop is outcome key art (`.docs/sprites/game-over.md`), painted the way
 * the title screen paints its splash: a CSS background fed an inline
 * `--splash-image`, never a Pixi texture. `App` warms both images when a match
 * starts, so this does not open onto an empty frame after a long game.
 */
export function GameOverModal() {
  const t = useT();
  const status = useGameStore((s) => s.status);
  const outcomePhase = useGameStore((s) => s.outcomePhase);
  const requestRestart = useGameStore((s) => s.requestRestart);
  const requestMenu = useGameStore((s) => s.requestMenu);

  if (status !== GameStatus.Won && status !== GameStatus.Lost) return null;
  // The engine knows the outcome the instant the last base falls; this waits for
  // the reveal to reach the card, ~2.3 s later, so the player watches the blast
  // and the fade first. See `.docs/tasks/outcome-transition.md`.
  if (outcomePhase !== OutcomePhase.Reveal) return null;
  const won = status === GameStatus.Won;

  return (
    <Dialog open={true} onClose={() => requestMenu()}>
      <DialogBackdrop
        className="dialog-backdrop dialog-backdrop--outcome"
        style={
          {
            '--splash-image': `url(${won ? gameOverBackdropSrc.victory : gameOverBackdropSrc.defeat})`,
          } as CSSProperties
        }
      />
      <div className="dialog-frame">
        <DialogPanel className="modal modal--outcome">
          <DialogTitle className={`modal__title modal__title--${won ? 'win' : 'lose'}`}>
            {won ? t('gameOver', 'victory') : t('gameOver', 'defeat')}
          </DialogTitle>
          <p className="modal__body">{won ? t('gameOver', 'victoryBody') : t('gameOver', 'defeatBody')}</p>
          <div className="modal__buttons">
            <Button onClick={() => requestMenu()}>{t('gameOver', 'mainMenu')}</Button>
            <Button onClick={() => requestRestart()}>{t('gameOver', 'playAgain')}</Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
