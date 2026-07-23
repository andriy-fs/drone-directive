import { useState } from 'react';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { Switch } from '../common/Switch';
import { Volume2Icon, VolumeXIcon } from '../common/icons';

/** Mute/unmute switch. Local state mirrors the sfx module's mute flag. */
export function SoundToggle() {
  const t = useT();
  const [muted, setMuted] = useState(sfx.isMuted());

  const toggle = (next: boolean) => {
    sfx.setMuted(next);
    setMuted(next);
  };

  return (
    <Switch
      checked={muted}
      onChange={toggle}
      className="sound-toggle"
      aria-label={muted ? t('aria', 'unmute') : t('aria', 'mute')}
    >
      {muted ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />}
    </Switch>
  );
}
