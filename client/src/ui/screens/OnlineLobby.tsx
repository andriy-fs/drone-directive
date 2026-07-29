import { useState } from 'react';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { useGameStore } from '../../store/gameStore';
import { selectOnline } from '../../store/selectors';
import { maxAiOpponents } from '../../config/gameSettings';
import { MapSize } from '../../types/enums';
import { Button } from '../common/Button';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';

const MAP_SIZES: { value: MapSize; label: 'small' | 'medium' | 'large' }[] = [
  { value: MapSize.Small, label: 'small' },
  { value: MapSize.Medium, label: 'medium' },
  { value: MapSize.Large, label: 'large' },
];

/** Bot counts a networked match can seat — the two humans already hold two corners. */
const OPPONENT_COUNTS = Array.from({ length: maxAiOpponents(true) + 1 }, (_, i) => i);

/**
 * Online 2-player lobby: host a room (and share the generated code) or join one
 * by code. Reads the connection status the app bridge maintains and renders the
 * matching step; when the match starts, the menu (and this modal) unmounts.
 */
export function OnlineLobby({ onClose }: { onClose: () => void }) {
  const t = useT();
  const online = useGameStore(selectOnline);
  const hostMatch = useGameStore((s) => s.hostMatch);
  const joinMatch = useGameStore((s) => s.joinMatch);
  const leaveOnline = useGameStore((s) => s.leaveOnline);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.Medium);
  const [aiOpponents, setAiOpponents] = useState(0);
  const [code, setCode] = useState('');

  const host = () => {
    sfx.resume();
    hostMatch(mapSize, aiOpponents);
  };
  const join = () => {
    if (code.trim().length === 0) return;
    sfx.resume();
    joinMatch(code.trim());
  };
  const back = () => leaveOnline(); // reset to the chooser (also disconnects)
  const close = () => {
    if (online.status !== 'offline') leaveOnline();
    onClose();
  };

  const busy = online.status === 'connecting' || online.status === 'hosting';
  const failed = online.status === 'error' || online.status === 'ended';

  return (
    <Dialog open onClose={close}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
          <DialogTitle className="modal__title">{t('online', 'title')}</DialogTitle>
          <div className="modal__body modal__body--stack">
            {online.status === 'connecting' && <p>{t('online', 'connecting')}</p>}

            {online.status === 'hosting' && (
              <>
                <p>{t('online', 'shareCode')}</p>
                <p className="menu__title" style={{ letterSpacing: '0.25em' }}>
                  {online.roomCode}
                </p>
                <p className="hud__muted">{t('online', 'waitingOpponent')}</p>
              </>
            )}

            {failed && <p>{online.error ?? t('online', 'matchEnded')}</p>}

            {online.status === 'offline' && (
              <>
                <div className="picker-group">
                  <span className="picker__label">{t('online', 'hostGame')}</span>
                  <div className="picker">
                    {MAP_SIZES.map((o) => (
                      <Button
                        key={o.value}
                        className={`chip ${o.value === mapSize ? 'chip--on' : ''}`.trim()}
                        onClick={() => setMapSize(o.value)}
                      >
                        {t('mapSize', o.label)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="picker-group">
                  <span className="picker__label">{t('mainMenu', 'opponents')}</span>
                  <div className="picker">
                    {OPPONENT_COUNTS.map((n) => (
                      <Button
                        key={n}
                        className={`chip ${n === aiOpponents ? 'chip--on' : ''}`.trim()}
                        onClick={() => setAiOpponents(n)}
                        aria-label={t('mainMenu', 'opponentsHint')}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button className="modal__action" onClick={host}>
                  {t('online', 'createRoom')}
                </Button>

                <div className="picker-group">
                  <span className="picker__label">{t('online', 'joinGame')}</span>
                  <input
                    value={code}
                    maxLength={8}
                    placeholder={t('online', 'roomCodePlaceholder')}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    style={{ width: '100%', padding: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.15em' }}
                  />
                </div>
                <Button className="modal__action" onClick={join} disabled={code.trim().length === 0}>
                  {t('online', 'joinRoom')}
                </Button>
              </>
            )}
          </div>

          {busy && (
            <Button className="modal__action" onClick={back}>
              {t('online', 'cancel')}
            </Button>
          )}
          {failed && (
            <Button className="modal__action" onClick={back}>
              {t('online', 'back')}
            </Button>
          )}
          <Button onClick={close}>{t('mainMenu', 'close')}</Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
