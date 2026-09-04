import { useEffect } from 'react';
import { DeviceNotice } from './features/device/DeviceNotice';
import { GameCanvas } from './GameCanvas';
import { ClipboardCheckIcon, HourglassIcon, PauseIcon, TerminalIcon } from './common/icons';
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
import { LoadingScreen } from './screens/LoadingScreen';
import { MainMenu } from './screens/MainMenu';
import { useControlGroupHotkeys } from './hooks/useControlGroupHotkeys';
import { usePauseHotkey } from './hooks/usePauseHotkey';
import { useSelectAllHotkey } from './hooks/useSelectAllHotkey';
import { restoreChat } from '../chat/chatBridge';
import { gameOverBackdropSrc } from '../config/sprites';
import { useT } from '../i18n';
import { useGameStore } from '../store/gameStore';
import { GameStatus, OnlineLink, OutcomePhase } from '../store/enums';
import { selectInMatch, selectOnlineLink, selectOutcomePhase, selectStatus } from '../store/selectors';

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

  // A selector rather than a line here: `ChatPanel` needs the same question
  // answered (it stands down in a solo match), and two copies of "which statuses
  // have a world" is exactly the kind of pair that drifts.
  const inMatch = useGameStore(selectInMatch);
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
          <HudCard icon={TerminalIcon} title={t('hud', 'command')}>
            <StatusPanel />
          </HudCard>

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
          returning null inside would keep that state alive across a whole match.
          It survives `loading` and is torn down at `playing`, exactly as before:
          the loading screen covers it, so there is nothing to be gained by
          dropping it a second earlier. */}
      {!inMatch && <MainMenu />}
      {/* Over the menu and over the canvas both — the world is being built behind
          it either way, and `GameApp` holds the simulation still until this comes
          down (see `revealMatch`). */}
      <LoadingScreen />
      <GameOverModal />
      {/* Outside the `inMatch` guard, unlike everything above it — but that is now
          only structural: the panel decides for itself, and it shows in a live
          online match and nowhere else (see its own note on what that costs). */}
      <ChatPanel />
      {/* Last, and outside the match guard too: a player arriving on a phone meets
          the title screen first, and a tablet turned upright mid-match is owed the
          same word. Renders nothing on a screen the game fits. */}
      <DeviceNotice />
    </div>
  );
}

export default App;
