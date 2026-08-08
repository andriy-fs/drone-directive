import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { useGameStore } from '../../store/gameStore';
import { selectOnline } from '../../store/selectors';
import { maxAiOpponents } from '../../config/gameSettings';
import { copyText } from '../../utils/clipboard';
import { MapSize } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { CheckIcon, CopyIcon } from '../common/icons';
import { ChipPicker, PickerGroup, type ChipOption } from '../common/Picker';
import { BaseSetupRow } from './BaseSetupRow';

const MAP_SIZES: { value: MapSize; label: 'small' | 'medium' | 'large' }[] = [
  { value: MapSize.Small, label: 'small' },
  { value: MapSize.Medium, label: 'medium' },
  { value: MapSize.Large, label: 'large' },
];

/** Bot counts a networked match can seat — the two humans already hold two corners. */
const OPPONENT_COUNTS: ChipOption<number>[] = Array.from({ length: maxAiOpponents(true) + 1 }, (_, i) => ({
  value: i,
  label: i,
}));

/** How long the copy button shows its "copied" tick before reverting. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * The generated room code with a copy button. The code itself is `user-select:
 * none` (the whole title screen is), so this button is the only way to get it
 * out of the page and into a chat window.
 */
function RoomCode({ code }: { code: string | null }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  if (!code) return null;

  return (
    <div className="room-code">
      <p className="menu__title room-code__value">{code}</p>
      <Button
        className="room-code__copy"
        onClick={() => void copyText(code).then(setCopied)}
        aria-label={t('online', copied ? 'codeCopied' : 'copyCode')}
        title={t('online', copied ? 'codeCopied' : 'copyCode')}
      >
        {copied ? <CheckIcon size={18} aria-hidden /> : <CopyIcon size={18} aria-hidden />}
      </Button>
    </div>
  );
}

/**
 * Online 2-player setup: host a room (and share the generated code) or join one
 * by code. Sits in the title screen's right column as the Multiplayer mode's
 * content — the sibling of `MatchSetupPanel`, not a dialog over it.
 *
 * That is deliberate. As a dialog it had to force itself open whenever the
 * session was anything but `offline`, so a finished or failed match could still
 * report itself; that put a second Headless UI layer over a menu that mounts in
 * the same commit, which is exactly the nesting `MainMenu` warns about. As a
 * panel the same rule is just "a live session pins the Multiplayer tab", with no
 * layering involved at all — see `MainMenu`.
 *
 * The map size and roster here are the *host's* and separate from the solo
 * settings in `MatchSetupPanel`: they are sent to the peer, not read back out of
 * the store. Base setup is the opposite — it is per-player, so it is the shared
 * store setting, and it reaches the world as a lockstep command rather than as
 * part of the handshake (see `GameApp.beginOnlineMatch`).
 */
export function OnlinePanel({ onOpenBaseSetup }: { onOpenBaseSetup: () => void }) {
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

  const busy = online.status === 'connecting' || online.status === 'hosting';
  const failed = online.status === 'error' || online.status === 'ended';

  const mapSizeOptions: ChipOption<MapSize>[] = MAP_SIZES.map((o) => ({
    value: o.value,
    label: t('mapSize', o.label),
  }));

  return (
    <section className="menu-panel">
      <h2 className="menu-panel__heading">{t('online', 'title')}</h2>

      {online.status === 'connecting' && <p className="modal__body">{t('online', 'connecting')}</p>}

      {online.status === 'hosting' && (
        <>
          <p className="modal__body">{t('online', 'shareCode')}</p>
          <RoomCode code={online.roomCode} />
          <p className="modal__body">{t('online', 'waitingOpponent')}</p>
        </>
      )}

      {failed && <p className="modal__body">{online.error ?? t('online', 'matchEnded')}</p>}

      {online.status === 'offline' && (
        <>
          {/* Same rows in the same order as the solo panel, so switching tabs
              moves as little as possible. Difficulty is the one absent row: the
              engine forces Normal for every online match (see `gameScene`), and
              the host has no way to tell the guest otherwise — `StartMessage`
              carries no difficulty. A picker here would set nothing. */}
          <PickerGroup label={t('mainMenu', 'opponents')}>
            <ChipPicker
              className="picker--segmented"
              options={OPPONENT_COUNTS}
              value={aiOpponents}
              onChange={setAiOpponents}
            />
          </PickerGroup>

          <PickerGroup label={t('mapSize', 'label')}>
            <ChipPicker className="picker--segmented" options={mapSizeOptions} value={mapSize} onChange={setMapSize} />
          </PickerGroup>

          <BaseSetupRow onOpenBaseSetup={onOpenBaseSetup} />

          <Button className="btn--primary" onClick={host}>
            {t('online', 'createRoom')}
          </Button>

          {/* Joining is the alternative to hosting, not a step after it — ruled
              off so the two don't read as one form with two buttons. */}
          <PickerGroup label={t('online', 'joinGame')}>
            <div className="join-row">
              <input
                className="join-row__code"
                value={code}
                maxLength={8}
                placeholder={t('online', 'roomCodePlaceholder')}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <Button onClick={join} disabled={code.trim().length === 0}>
                {t('online', 'joinRoom')}
              </Button>
            </div>
          </PickerGroup>
        </>
      )}

      {/* One button for two jobs, because they are the same one: drop whatever
          the session is currently doing and come back to the chooser. Mid-connect
          that is a cancel; after a match it is dismissing the outcome. */}
      {(busy || failed) && (
        <Button className="menu-panel__cta" onClick={() => leaveOnline()}>
          {busy ? t('online', 'cancel') : t('mainMenu', 'close')}
        </Button>
      )}
    </section>
  );
}
