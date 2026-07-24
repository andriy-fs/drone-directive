import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectStatus } from '../../store/selectors';
import { Button } from '../common/Button';
import { PauseIcon, PlayIcon } from '../common/icons';

/** Toggles the paused state. Only meaningful (enabled) while a match is running. */
export function PauseButton() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const paused = useGameStore((s) => s.paused);
  const togglePause = useGameStore((s) => s.togglePause);

  return (
    <Button
      className="sound-toggle"
      onClick={togglePause}
      disabled={status !== 'playing'}
      aria-label={paused ? t('aria', 'resume') : t('aria', 'pause')}
    >
      {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
    </Button>
  );
}
