import { useEffect } from 'react';
import { GameCanvas } from './GameCanvas';
import { HourglassIcon, PauseIcon, Settings2Icon } from './common/icons';
import { ChatPanel } from './hud/ChatPanel';
import { PauseButton } from './hud/PauseButton';
import { SoundButton } from './hud/SoundButton';
import { StatusPanel } from './hud/StatusPanel';
import { ProgrammingPanel } from './hud/ProgrammingPanel';
import { sideLabel, sideTone } from './hud/sides';
import { GameOverModal } from './screens/GameOverModal';
import { MainMenu } from './screens/MainMenu';
import { useControlGroupHotkeys } from './hooks/useControlGroupHotkeys';
import { usePauseHotkey } from './hooks/usePauseHotkey';
import { useSelectAllHotkey } from './hooks/useSelectAllHotkey';
import { restoreChat } from '../chat/chatBridge';
import { useT } from '../i18n';
import { useGameStore } from '../store/gameStore';
import { selectBases, selectLocalSide, selectOnline, selectRobots, selectSides, selectStatus } from '../store/selectors';

import './App.css';

const STATUS_KEYS = {
  menu: 'statusMenu',
  playing: 'statusPlaying',
  won: 'statusWon',
  lost: 'statusLost',
} as const;

/**
 * Top-level layout: a fixed HUD sidebar (React) beside the game viewport that
 * hosts the Pixi canvas. The HUD reads store snapshots via narrowed selectors;
 * all gameplay lives in the Pixi/engine layers behind <GameCanvas/>.
 *
 * Before a match there is nothing to command, so the sidebar isn't rendered at
 * all — the title screen is just the splash art plus the menu. `<GameCanvas/>`
 * stays mounted throughout: unmounting it would tear down the whole GameApp
 * (with it the online session and the flags that start a match).
 */
function App() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const bases = useGameStore(selectBases);
  const robots = useGameStore(selectRobots);
  const sides = useGameStore(selectSides);
  const paused = useGameStore((s) => s.paused);
  const online = useGameStore(selectOnline);
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const droneStatus = useGameStore((s) => s.droneStatus);
  const localSide = useGameStore(selectLocalSide);
  usePauseHotkey();
  useSelectAllHotkey();
  useControlGroupHotkeys();
  // Re-attach to the last conversation this browser knows about. The server keeps
  // it for a week, so a reload — or a visit two days later — finds it still there.
  useEffect(restoreChat, []);

  // Sides are labelled and coloured from the local client's point of view — the
  // online guest plays Owner.AI but is "player" to itself (same rule as the
  // canvas `ownerColor`), with the local side listed first.
  const sideRows = [...sides].sort((a, b) => Number(b.owner === localSide) - Number(a.owner === localSide));
  // `won`/`lost` still count as in-match: the world (and the HUD) stay on screen
  // behind the game-over modal.
  const inMatch = status !== 'menu';
  // Lockstep froze the world waiting for input — the peer's, or our own once the
  // socket comes back. Not a pause, and not a crash either.
  const stalled = online.status === 'inMatch' && online.link !== 'ok';

  return (
    <div className={`app-shell ${inMatch ? '' : 'app-shell--menu'}`.trim()}>
      {inMatch && (
        <aside className="hud">
          <div className="hud__titlebar">
            <h1 className="hud__title">{t('hud', 'title')}</h1>
            <div className="hud__controls">
              <PauseButton />
              <SoundButton />
            </div>
          </div>
          <p className="hud__status">
            {t('hud', 'statusPrefix')}: {t('hud', STATUS_KEYS[status])} · {t('difficulty', difficulty)}
          </p>

          <div className="hud__section">
            <h2 className="hud__heading">{t('hud', 'command')}</h2>
            <StatusPanel />
          </div>

          <div className="hud__section">
            <h2 className="hud__heading">{t('hud', 'bases')}</h2>
            <ul className="hud__list">
              {bases.map((base) => (
                <li key={base.id} className="hud__row">
                  <span className={`dot dot--${sideTone(base.owner, localSide)}`} />
                  <span className="hud__row-label">{sideLabel(base.owner, sides, localSide, t)}</span>
                  {base.queueLength > 0 && (
                    <span className="hud__build" title={t('statusPanel', 'building')}>
                      <Settings2Icon size={14} /> {base.queueLength}
                    </span>
                  )}
                  <span className="hud__row-value">
                    {base.hp}/{base.maxHp}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="hud__section">
            <h2 className="hud__heading">{t('hud', 'units')}</h2>
            <ul className="hud__list">
              {sideRows.map((side) => (
                <li key={side.owner} className={`hud__row ${side.alive ? '' : 'hud__row--out'}`.trim()}>
                  <span className={`dot dot--${sideTone(side.owner, localSide)}`} />
                  <span className="hud__row-label">{sideLabel(side.owner, sides, localSide, t)}</span>
                  <span className="hud__row-value">{robots.filter((r) => r.owner === side.owner).length}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="hud__section">
            <h2 className="hud__heading">{t('hud', 'directive')}</h2>
            <ProgrammingPanel />
          </div>

          {status === 'playing' && (
            <div className="hud__section">
              <h2 className="hud__heading">{t('hud', 'drone')}</h2>
              <p className="hud__status">
                {droneStatus.mode === 'possessing' ? t('hud', 'piloting') : t('hud', 'observing')}
              </p>
            </div>
          )}

          <p className="hud__hint">{t('hud', 'hint')}</p>
        </aside>
      )}
      <main className="viewport">
        <GameCanvas />
        {/* Three ways for the world to be standing still, and the player is owed
            the difference: a pause someone asked for, versus a lockstep step that
            cannot run yet. The link takes precedence — it is the one that might
            end the match. */}
        {status === 'playing' && stalled && (
          <div className="pause-overlay">
            <span className="pause-overlay__label pause-overlay__label--link">
              <HourglassIcon size={32} /> {t('online', online.link === 'reconnecting' ? 'reconnecting' : 'waitingPeer')}
            </span>
          </div>
        )}
        {status === 'playing' && paused && !stalled && (
          <div className="pause-overlay">
            <span className="pause-overlay__label">
              <PauseIcon size={32} /> {t('hud', 'paused')}
            </span>
          </div>
        )}
      </main>
      {/* Mounted only on the title screen, so its dialog state (Base Setup, the
          online lobby, …) starts fresh every time — rendering it always and
          returning null inside would keep that state alive across a whole match. */}
      {!inMatch && <MainMenu />}
      <GameOverModal />
      {/* Outside the `inMatch` guard, unlike everything above it: the chat outlives
          the match, so the panel has to survive the return to the menu. It renders
          nothing until there is a conversation to show. */}
      <ChatPanel />
    </div>
  );
}

export default App;
