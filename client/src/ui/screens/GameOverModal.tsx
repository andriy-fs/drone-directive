import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { GameStatus } from '../../store/enums';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { Button } from '../common/Button';

/**
 * Victory / defeat overlay. Shown when the loop sets a terminal status. Restart
 * flips `restartRequested`; the game loop observes it, rebuilds the world, and
 * resets the store back to `playing` — which hides this modal again.
 */
export function GameOverModal() {
  const t = useT();
  const status = useGameStore((s) => s.status);
  const requestRestart = useGameStore((s) => s.requestRestart);
  const requestMenu = useGameStore((s) => s.requestMenu);

  if (status !== GameStatus.Won && status !== GameStatus.Lost) return null;
  const won = status === GameStatus.Won;

  return (
    <Dialog open={true} onClose={() => requestMenu()}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
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
