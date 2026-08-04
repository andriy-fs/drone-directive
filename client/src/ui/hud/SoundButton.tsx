import { useState } from 'react';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { Button } from '../common/Button';
import { Volume2Icon, VolumeXIcon } from '../common/icons';
import { SoundSettingsModal } from '../screens/SoundSettingsModal';

/**
 * The HUD's sound control: one button that opens the sound settings, rather than
 * the mute switch and volume slider that used to sit side by side in the
 * titlebar. The icon still reports whether sound is on, which is the part of the
 * old control worth keeping at a glance.
 *
 * `sfx.isMuted()` is read during render rather than mirrored in state on purpose:
 * the dialog below is the only thing that can change it, and opening or closing
 * that dialog re-renders this component anyway.
 */
export function SoundButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const muted = sfx.isMuted();

  return (
    <>
      <Button className="sound-toggle" onClick={() => setOpen(true)} aria-label={t('aria', 'soundSettings')}>
        {muted ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />}
      </Button>
      {open && <SoundSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
