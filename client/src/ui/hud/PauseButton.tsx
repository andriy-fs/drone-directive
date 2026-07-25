import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectOnline, selectStatus } from '../../store/selectors';
import { Button } from '../common/Button';
import { PauseIcon, PlayIcon } from '../common/icons';

/** Toggles the paused state. Enabled only while a solo match is running (no pause online). */
export function PauseButton() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const online = useGameStore(selectOnline);
  const paused = useGameStore((s) => s.paused);
  const togglePause = useGameStore((s) => s.togglePause);

  return (
    <Button
      className="sound-toggle"
      onClick={togglePause}
      disabled={status !== 'playing' || online.status === 'inMatch'}
      aria-label={paused ? t('aria', 'resume') : t('aria', 'pause')}
    >
      {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
    </Button>
  );
}
