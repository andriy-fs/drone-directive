import { useState } from 'react';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../common/Button';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { LogOutIcon } from '../common/icons';

/**
 * Abandons the match and goes back to the title screen.
 *
 * Behind a confirmation, unlike every other titlebar control: this is the one
 * button up there that destroys something. `requestMenu` raises a one-shot flag
 * the bridge consumes in `GameApp.step()`, which drops the online session and
 * calls `engine.toMenu()` — there is no half-way state to come back from, and
 * online it also ends the match for the other player.
 */
export function ExitToMenuButton() {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const requestMenu = useGameStore((s) => s.requestMenu);

  return (
    <>
      <Button
        className="sound-toggle"
        onClick={() => setConfirming(true)}
        aria-label={t('aria', 'exitToMenu')}
        title={t('aria', 'exitToMenu')}
      >
        <LogOutIcon size={16} />
      </Button>
      {confirming && (
        <Dialog open onClose={() => setConfirming(false)}>
          <DialogBackdrop className="dialog-backdrop" />
          <div className="dialog-frame">
            <DialogPanel className="modal">
              <DialogTitle className="modal__title">{t('confirmExit', 'title')}</DialogTitle>
              <p className="modal__body">{t('confirmExit', 'body')}</p>
              <div className="modal__buttons">
                <Button className="btn--ghost" onClick={() => setConfirming(false)}>
                  {t('confirmExit', 'cancel')}
                </Button>
                <Button onClick={requestMenu}>{t('confirmExit', 'confirm')}</Button>
              </div>
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </>
  );
}
