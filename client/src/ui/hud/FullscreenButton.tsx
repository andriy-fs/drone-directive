import { useT } from '../../i18n';
import { Button } from '../common/Button';
import { MaximizeIcon, MinimizeIcon } from '../common/icons';
import { useFullscreen } from '../hooks/useFullscreen';

/**
 * Fills the screen with the game, and gives it back.
 *
 * Shown in both shells. The desktop app already has F11 and a View menu entry,
 * but they are the *window's* fullscreen and this is the page's — see
 * `useFullscreen` for why the two cannot be merged from here, and why the icon
 * follows the DOM rather than the last click.
 */
export function FullscreenButton() {
  const t = useT();
  const { active, supported, toggle } = useFullscreen();

  // Nothing to offer where the embedder refuses fullscreen outright; a button
  // whose only possible outcome is silence is worse than no button.
  if (!supported) return null;

  return (
    <Button
      className="sound-toggle"
      onClick={toggle}
      aria-label={active ? t('aria', 'exitFullscreen') : t('aria', 'enterFullscreen')}
      title={active ? t('aria', 'exitFullscreen') : t('aria', 'enterFullscreen')}
    >
      {active ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
    </Button>
  );
}
