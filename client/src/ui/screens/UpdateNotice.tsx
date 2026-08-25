import { useState } from 'react';
import { DESKTOP_RELEASES_URL, isDesktopApp } from '../../config/platform';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { ClientVersion } from '../../store/enums';
import { selectClientVersion } from '../../store/selectors';
import { Button } from '../common/Button';
import { DownloadIcon } from '../common/icons';

/**
 * "Your copy of the game has fallen behind." A strip under the title, on the
 * title screen only — so it can never appear over a running match, and an
 * offline game is never interrupted by it.
 *
 * Two severities, one component, because they are the same news:
 *  - `UpdateAvailable` — dismissible; the player may reload whenever they like.
 *  - `OnlineBlocked` — not dismissible: the lobby below is refusing to connect,
 *    and a bar the player can wave away would leave that unexplained.
 *
 * The action differs by shell, not by severity. In a browser the update *is* a
 * reload (`index.html` is served `max-age=0, must-revalidate`, so the next load
 * gets the new bundle). In the desktop app a reload would change nothing — the
 * bundle is frozen at install — so it links to the installers instead.
 */
export function UpdateNotice() {
  const t = useT();
  const clientVersion = useGameStore(selectClientVersion);
  const [dismissed, setDismissed] = useState(false);

  if (clientVersion === ClientVersion.Current) return null;
  const blocked = clientVersion === ClientVersion.OnlineBlocked;
  if (dismissed && !blocked) return null;

  return (
    <div className={`update-notice ${blocked ? 'update-notice--blocking' : ''}`.trim()} role="status">
      <DownloadIcon size={16} aria-hidden />
      <span className="update-notice__text">{blocked ? t('online', 'outdatedTitle') : t('update', 'available')}</span>

      {isDesktopApp ? (
        <a className="btn update-notice__action" href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">
          {t('update', 'download')}
        </a>
      ) : (
        <Button className="update-notice__action" onClick={() => window.location.reload()}>
          {t('update', 'reload')}
        </Button>
      )}

      {!blocked && <Button onClick={() => setDismissed(true)}>{t('update', 'later')}</Button>}
    </div>
  );
}
