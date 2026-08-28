import { useState } from 'react';
import { useT } from '../../i18n';
import { Button } from '../common/Button';
import { KeyboardIcon } from '../common/icons';
import { ControlsModal } from '../screens/ControlsModal';

/**
 * The keys-and-clicks reference, in the match rather than only on the title
 * screen — which is where a player actually wonders what Ctrl+1-9 did.
 *
 * The same `ControlsModal` the menu's help button opens; it owns its dialog
 * state locally, like `SoundButton`, because the HUD has no modal slot to route
 * it through.
 */
export function ControlsButton() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        className="sound-toggle"
        onClick={() => setOpen(true)}
        aria-label={t('mainMenu', 'controls')}
        title={t('mainMenu', 'controls')}
      >
        <KeyboardIcon size={16} />
      </Button>
      {open && <ControlsModal onClose={() => setOpen(false)} />}
    </>
  );
}
