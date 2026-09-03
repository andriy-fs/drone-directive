import { useState } from 'react';
import { useT } from '../../../i18n';
import { storage } from '../../../utils/storage';
import { Button } from '../../common/Button';
import { RotateDeviceIcon, SmallScreenIcon } from '../../common/icons';
import { DeviceFit } from './deviceFit';
import { useDeviceFit } from './useDeviceFit';

/**
 * What the player is told when the screen is not one the game was built for.
 * Two cases, and they are owed different things (see
 * `.docs/internal/tasks/support-tablets/README.md` § 4):
 *
 * - **Portrait, on a device big enough** — a full screen asking for a turn. It
 *   covers the game, and that is fine: it is undone by one motion, and there is
 *   no decision to offer.
 * - **Too small in any orientation** — a soft banner with a way past it, *never*
 *   a block. Rotating would not help, so it does not ask; and `index.html`
 *   carries the canonical/OG/JSON-LD `VideoGame` block while Google renders
 *   mobile-first, so a full-page refusal in a phone viewport is what the crawler
 *   would index as this page's content.
 *
 * Sits outside the match: mounted in `App` next to `MainMenu`, because a player
 * arriving on a phone meets the title screen first, and a tablet turned upright
 * mid-match needs telling just as much.
 */

/**
 * The dismissal is remembered, unlike most UI state here: the screen it is about
 * does not change between visits, so re-asking on every reload would be nagging
 * about a fact the player has already accepted. `dd:` prefixed like every other
 * key this game writes (see `utils/storage`).
 */
const ACCEPTED_KEY = 'dd:smallScreenAccepted';

const loadAccepted = (): boolean => storage.getItem(ACCEPTED_KEY) === '1';

export function DeviceNotice() {
  const t = useT();
  const fit = useDeviceFit();
  const [accepted, setAccepted] = useState(loadAccepted);

  const accept = () => {
    storage.setItem(ACCEPTED_KEY, '1');
    setAccepted(true);
  };

  if (fit === DeviceFit.Rotate) {
    return (
      // `alert` rather than `status`: it is the whole screen, and a viewer who
      // cannot see it is owed the reason the game stopped responding.
      <div className="device-notice device-notice--rotate" role="alert">
        <RotateDeviceIcon className="device-notice__mark" size={56} />
        <h2 className="device-notice__title">{t('device', 'rotateTitle')}</h2>
        <p className="device-notice__body">{t('device', 'rotateBody')}</p>
      </div>
    );
  }

  if (fit === DeviceFit.TooSmall && !accepted) {
    return (
      <div className="device-notice device-notice--small" role="status">
        <SmallScreenIcon className="device-notice__mark" size={24} />
        <div className="device-notice__text">
          <strong className="device-notice__title">{t('device', 'tooSmallTitle')}</strong>
          <span className="device-notice__body">{t('device', 'tooSmallBody')}</span>
        </div>
        <Button className="device-notice__accept" onClick={accept}>
          {t('device', 'playAnyway')}
        </Button>
      </div>
    );
  }

  return null;
}
