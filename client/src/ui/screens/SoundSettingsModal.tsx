import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { Button } from '../common/Button';
import { PickerGroup } from '../common/Picker';
import { Slider } from '../common/Slider';

/**
 * Everything the player can change about the game's sound, in one place —
 * reachable from the HUD's speaker button during a match and from the title
 * screen's Sound row before one. Two entry points, one dialog: the volume slider
 * used to live in the HUD titlebar, where it was a 68px target squeezed next to
 * the pause button and invisible from the menu.
 *
 * Local state mirrors the sfx module, which owns both values and persists them —
 * so these seeds are the player's stored settings rather than defaults, and the
 * writes go straight through rather than through the store (sound is not part of
 * the world, and nothing renders off it).
 */
export function SoundSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [muted, setMuted] = useState(sfx.isMuted());
  const [volume, setVolume] = useState(sfx.getVolume());

  const mute = (next: boolean) => {
    sfx.setMuted(next);
    setMuted(next);
  };

  const changeVolume = (next: number) => {
    sfx.setVolume(next);
    setVolume(next);
  };

  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
          <DialogTitle className="modal__title">{t('sound', 'title')}</DialogTitle>

          <PickerGroup label={t('sound', 'effects')}>
            <div className="picker">
              <Button className={`chip ${muted ? 'chip--on' : ''}`.trim()} onClick={() => mute(true)}>
                {t('sound', 'off')}
              </Button>
              <Button className={`chip ${!muted ? 'chip--on' : ''}`.trim()} onClick={() => mute(false)}>
                {t('sound', 'on')}
              </Button>
            </div>
          </PickerGroup>

          <PickerGroup label={t('sound', 'volume')}>
            <div className="sound-volume">
              <Slider
                value={volume}
                onValueChange={changeVolume}
                disabled={muted}
                aria-label={t('aria', 'volume')}
                title={t('aria', 'volume')}
              />
              <span className="sound-volume__value">{Math.round(volume * 100)}%</span>
            </div>
          </PickerGroup>

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
