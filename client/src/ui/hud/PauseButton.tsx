import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { GameStatus, OnlineLink } from '../../store/enums';
import { selectOnlineLink, selectStatus } from '../../store/selectors';
import { Button } from '../common/Button';
import { PauseIcon, PlayIcon } from '../common/icons';

/**
 * Toggles the paused state. Online it toggles the *shared* one — either player
 * may stop the match and either may start it again — which takes a few ticks to
 * come back, so the icon follows the simulation rather than the click.
 */
export function PauseButton() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const link = useGameStore(selectOnlineLink);
  const paused = useGameStore((s) => s.paused);
  const togglePause = useGameStore((s) => s.togglePause);

  return (
    <Button
      className="sound-toggle"
      onClick={togglePause}
      // Not while the link is down: the request travels as tick input, so with
      // nothing flowing it would sit unsent and then fire on reconnect.
      disabled={status !== GameStatus.Playing || link !== OnlineLink.Ok}
      aria-label={paused ? t('aria', 'resume') : t('aria', 'pause')}
      title={paused ? t('aria', 'resume') : t('aria', 'pause')}
    >
      {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
    </Button>
  );
}
