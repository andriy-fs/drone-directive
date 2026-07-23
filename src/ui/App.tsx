import { GameCanvas } from './GameCanvas';
import { PauseIcon, Settings2Icon } from './common/icons';
import { PauseButton } from './hud/PauseButton';
import { SoundToggle } from './hud/SoundToggle';
import { StatusPanel } from './hud/StatusPanel';
import { ProgrammingPanel } from './hud/ProgrammingPanel';
import { GameOverModal } from './screens/GameOverModal';
import { MainMenu } from './screens/MainMenu';
import { usePauseHotkey } from './hooks/usePauseHotkey';
import { useSelectAllHotkey } from './hooks/useSelectAllHotkey';
import { useGameStore } from '../store/gameStore';
import { selectBases, selectRobots, selectStatus } from '../store/selectors';

import './App.css';

/**
 * Top-level layout: a fixed HUD sidebar (React) beside the game viewport that
 * hosts the Pixi canvas. The HUD reads store snapshots via narrowed selectors;
 * all gameplay lives in the Pixi/engine layers behind <GameCanvas/>.
 */
function App() {
  const status = useGameStore(selectStatus);
  const bases = useGameStore(selectBases);
  const robots = useGameStore(selectRobots);
  const paused = useGameStore((s) => s.paused);
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const droneStatus = useGameStore((s) => s.droneStatus);
  usePauseHotkey();
  useSelectAllHotkey();

  const playerCount = robots.filter((r) => r.owner === 'player').length;
  const aiCount = robots.filter((r) => r.owner === 'ai').length;

  return (
    <div className="app-shell">
      <aside className="hud">
        <div className="hud__titlebar">
          <h1 className="hud__title">Drone Directive</h1>
          <div className="hud__controls">
            <PauseButton />
            <SoundToggle />
          </div>
        </div>
        <p className="hud__status">
          Status: {status} · {difficulty}
        </p>

        <div className="hud__section">
          <h2 className="hud__heading">Command</h2>
          <StatusPanel />
        </div>

        <div className="hud__section">
          <h2 className="hud__heading">Bases</h2>
          <ul className="hud__list">
            {bases.map((base) => (
              <li key={base.id} className="hud__row">
                <span className={`dot dot--${base.owner}`} />
                <span className="hud__row-label">{base.owner}</span>
                {base.queueLength > 0 && (
                  <span className="hud__build" title="Building">
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
          <h2 className="hud__heading">Units</h2>
          <ul className="hud__list">
            <li className="hud__row">
              <span className="dot dot--player" />
              <span className="hud__row-label">Player</span>
              <span className="hud__row-value">{playerCount}</span>
            </li>
            <li className="hud__row">
              <span className="dot dot--ai" />
              <span className="hud__row-label">AI</span>
              <span className="hud__row-value">{aiCount}</span>
            </li>
          </ul>
        </div>

        <div className="hud__section">
          <h2 className="hud__heading">Program</h2>
          <ProgrammingPanel />
        </div>

        {status === 'playing' && (
          <div className="hud__section">
            <h2 className="hud__heading">Drone</h2>
            <p className="hud__status">
              {droneStatus.mode === 'possessing'
                ? 'Piloting a robot'
                : 'Observing'}
              {droneStatus.autoBuildSuppressed &&
                ' · auto-build paused (drone away)'}
            </p>
          </div>
        )}

        <p className="hud__hint">
          Drag to box-select · click a robot to select · Shift+click/drag to add
          · Ctrl+A all · right-click to move · WASD/arrows fly the drone · F
          land/take off · E fire/detonate · Esc/Space to pause.
        </p>
      </aside>
      <main className="viewport">
        <GameCanvas />
        {status === 'playing' && paused && (
          <div className="pause-overlay">
            <span className="pause-overlay__label">
              <PauseIcon size={32} /> Paused
            </span>
          </div>
        )}
      </main>
      <MainMenu />
      <GameOverModal />
    </div>
  );
}

export default App;
