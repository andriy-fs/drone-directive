import { useEffect } from 'react';
import { GameCanvas } from './GameCanvas';
import { ClipboardCheckIcon, HourglassIcon, PauseIcon } from './common/icons';
import { HudCard } from './common/HudCard';
import { ChatPanel } from './hud/ChatPanel';
import { ControlsButton } from './hud/ControlsButton';
import { DirectivesHelpButton } from './hud/DirectivesHelpButton';
import { DroneReadyToast } from './hud/DroneReadyToast';
import { ExitToMenuButton } from './hud/ExitToMenuButton';
import { FullscreenButton } from './hud/FullscreenButton';
import { RadioLog } from './hud/RadioLog';
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
import { gameOverBackdropSrc } from '../config/sprites';
import { useT } from '../i18n';
import { useGameStore } from '../store/gameStore';
import { GameStatus, OnlineLink, OutcomePhase } from '../store/enums';
import { selectOnlineLink, selectOutcomePhase, selectStatus } from '../store/selectors';

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
  const outcomePhase = useGameStore(selectOutcomePhase);
  usePauseHotkey();
  useSelectAllHotkey();
  useControlGroupHotkeys();
  // Re-attach to the last conversation this browser knows about. The server keeps
  // it for a week, so a reload — or a visit two days later — finds it still there.
  useEffect(restoreChat, []);
  // Fetch the outcome key art while the match runs, so the game-over modal does
  // not open onto an empty backdrop half an hour later. Deliberately not an
  // index.html preload: it is nowhere near the first paint and would only
  // compete with the bundle and the menu splash there.
  useEffect(() => {
    if (status !== GameStatus.Playing) return;
    for (const src of [gameOverBackdropSrc.victory, gameOverBackdropSrc.defeat]) new Image().src = src;
  }, [status]);

  // `won`/`lost` still count as in-match: the world (and the HUD) stay on screen
  // behind the game-over modal.
  const inMatch = status !== GameStatus.Menu;
  // Lockstep froze the world waiting for input — the peer's, or our own once the
  // socket comes back. Not a pause, and not a crash either. Only a running match
  // has a link at all, so anything but `ok` already means there is one.
  const stalled = link !== OnlineLink.Ok;
  // The match is decided: the field is a picture from here on, so it stops taking
  // clicks. Without this the player can still drag a selection box and set off
  // cues under a veil that is already fading them out.
  const settling = outcomePhase !== OutcomePhase.None;

  return (
    <div className={`app-shell ${inMatch ? '' : 'app-shell--menu'}`.trim()}>
      {inMatch && (
        <aside className="hud">
          <div className="hud__titlebar">
            <h1 className="hud__title">{t('hud', 'title')}</h1>
            <div className="hud__controls">
              <PauseButton />
              <SoundButton />
              {/* What the game sounds like, then what it is played with, then the
                  two that change the frame around it — destructive one last. */}
              <ControlsButton />
              <FullscreenButton />
              <ExitToMenuButton />
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
        </aside>
      )}
      <main className={`viewport ${settling ? 'viewport--settling' : ''}`.trim()}>
        <GameCanvas />
        {/* Over the world rather than in the sidebar: it announces something the
            player is *not* being shown, so it has to reach eyes that are on the
            fight. It renders nothing unless there is a drone to announce. */}
        {inMatch && <DroneReadyToast />}
        {/* Flavour over the scene, top-right — the one corner nothing else claims.
            Mounted with the match and gone with it: unlike the chat, there is
            nothing here worth keeping once the fighting stops. */}
        {inMatch && <RadioLog />}
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
      {/* The fade to black between the last explosion and the outcome card. Fixed
          rather than inside the viewport: it has to take the HUD with it, since a
          live sidebar behind a result screen is half of what made the old cut
          feel abrupt. It never fades back out — the art comes up on top of it. */}
      {(outcomePhase === OutcomePhase.Veil || outcomePhase === OutcomePhase.Reveal) && (
        <div className="outcome-veil" />
      )}
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
