import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { music } from '../../pixi/audio/music';
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
 * Two channels, because they are turned off at completely different rates: the
 * effects are what the game says and are rarely silenced, the music is a bed
 * many players kill on the first day. They are separate all the way down — see
 * the headers of `sfx.ts` and `music.ts` — and switching the music off is what
 * stops its megabytes ever being fetched.
 *
 * Local state mirrors those two modules, which own the values and persist them —
 * so these seeds are the player's stored settings rather than defaults, and the
 * writes go straight through rather than through the store (sound is not part of
 * the world, and nothing renders off it).
 */
export function SoundSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [muted, setMuted] = useState(sfx.isMuted());
  const [volume, setVolume] = useState(sfx.getVolume());
  const [musicOn, setMusicOn] = useState(music.isEnabled());
  const [musicVolume, setMusicVolume] = useState(music.getVolume());

  const mute = (next: boolean) => {
    sfx.setMuted(next);
    setMuted(next);
  };

  const changeVolume = (next: number) => {
    sfx.setVolume(next);
    setVolume(next);
  };

  const enableMusic = (next: boolean) => {
    music.setEnabled(next);
    setMusicOn(next);
  };

  const changeMusicVolume = (next: number) => {
    music.setVolume(next);
    setMusicVolume(next);
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

          <PickerGroup label={t('sound', 'music')}>
            <div className="picker">
              <Button
                className={`chip ${!musicOn ? 'chip--on' : ''}`.trim()}
                onClick={() => enableMusic(false)}
              >
                {t('sound', 'off')}
              </Button>
              <Button
                className={`chip ${musicOn ? 'chip--on' : ''}`.trim()}
                onClick={() => enableMusic(true)}
              >
                {t('sound', 'on')}
              </Button>
            </div>
          </PickerGroup>

          <PickerGroup label={t('sound', 'musicVolume')}>
            <div className="sound-volume">
              <Slider
                value={musicVolume}
                onValueChange={changeMusicVolume}
                disabled={!musicOn}
                aria-label={t('aria', 'musicVolume')}
                title={t('aria', 'musicVolume')}
              />
              <span className="sound-volume__value">{Math.round(musicVolume * 100)}%</span>
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
