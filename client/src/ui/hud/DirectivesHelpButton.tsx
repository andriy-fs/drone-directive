import { useState } from 'react';
import { useT } from '../../i18n';
import { Button } from '../common/Button';
import { HelpCircleIcon } from '../common/icons';
import { DirectivesModal } from '../screens/DirectivesModal';

/**
 * The Directives card's header button: what each order actually makes a unit do,
 * on demand. Owns its own dialog state — like `SoundButton` — so the card it sits
 * in stays a dumb frame.
 */
export function DirectivesHelpButton() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button className="hud-card__help" onClick={() => setOpen(true)} aria-label={t('aria', 'directivesHelp')}>
        <HelpCircleIcon size={14} />
      </Button>
      {open && <DirectivesModal onClose={() => setOpen(false)} />}
    </>
  );
}
