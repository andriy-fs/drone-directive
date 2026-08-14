import { useEffect } from 'react';
import { GameCanvas } from './GameCanvas';
import { ClipboardCheckIcon, HourglassIcon, PauseIcon } from './common/icons';
import { HudCard } from './common/HudCard';
import { ChatPanel } from './hud/ChatPanel';
import { DirectivesHelpButton } from './hud/DirectivesHelpButton';
import { DronePanel } from './hud/DronePanel';
import { DroneReadyToast } from './hud/DroneReadyToast';
import { PauseButton } from './hud/PauseButton';
import { SoundButton } from './hud/SoundButton';
import { StatusPanel } from './hud/StatusPanel';
import { ProgrammingPanel } from './hud/ProgrammingPanel';
import { GameOverModal } from './screens/GameOverModal';
import { MainMenu } from './screens/MainMenu';
import { useControlGroupHotkeys } from './hooks/useControlGroupHotkeys';
import { usePauseHotkey } from './hooks/usePauseHotkey';
import { useSelectAllHotkey } from './hooks/useSelectAllHotkey';
import { restoreChat } from '../chat/chatBridge';
import { useT } from '../i18n';
import { useGameStore } from '../store/gameStore';
import { GameStatus, OnlineLink } from '../store/enums';
import { selectOnlineLink, selectStatus } from '../store/selectors';

import './App.css';

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
  const paused = useGameStore((s) => s.paused);
  const link = useGameStore(selectOnlineLink);
  usePauseHotkey();
  useSelectAllHotkey();
  useControlGroupHotkeys();
  // Re-attach to the last conversation this browser knows about. The server keeps
  // it for a week, so a reload — or a visit two days later — finds it still there.
  useEffect(restoreChat, []);

  // `won`/`lost` still count as in-match: the world (and the HUD) stay on screen
  // behind the game-over modal.
  const inMatch = status !== GameStatus.Menu;
  // Lockstep froze the world waiting for input — the peer's, or our own once the
  // socket comes back. Not a pause, and not a crash either. Only a running match
  // has a link at all, so anything but `ok` already means there is one.
  const stalled = link !== OnlineLink.Ok;

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
          <div className="hud__section">
            <h2 className="hud__heading">{t('hud', 'command')}</h2>
            <StatusPanel />
          </div>

          {/* The first section on the new card chrome; the rest follow one by one. */}
          <HudCard
            icon={ClipboardCheckIcon}
            title={t('hud', 'directive')}
            action={<DirectivesHelpButton />}
            className="hud-card--directives"
          >
            <ProgrammingPanel />
          </HudCard>

          <div className="hud__section">
            <h2 className="hud__heading">{t('hud', 'drone')}</h2>
            <DronePanel />
          </div>
        </aside>
      )}
      <main className="viewport">
        <GameCanvas />
        {/* Over the world rather than in the sidebar: it announces something the
            player is *not* being shown, so it has to reach eyes that are on the
            fight. It renders nothing unless there is a drone to announce. */}
        {inMatch && <DroneReadyToast />}
        {/* Three ways for the world to be standing still, and the player is owed
            the difference: a pause someone asked for, versus a lockstep step that
            cannot run yet. The link takes precedence — it is the one that might
            end the match. */}
        {status === GameStatus.Playing && stalled && (
          <div className="pause-overlay">
            <span className="pause-overlay__label pause-overlay__label--link">
              <HourglassIcon size={32} /> {t('online', link === OnlineLink.Reconnecting ? 'reconnecting' : 'waitingPeer')}
            </span>
          </div>
        )}
        {status === GameStatus.Playing && paused && !stalled && (
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
