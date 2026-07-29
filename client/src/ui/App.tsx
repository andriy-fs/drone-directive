import { GameCanvas } from './GameCanvas';
import { PauseIcon, Settings2Icon } from './common/icons';
import { PauseButton } from './hud/PauseButton';
import { SoundToggle } from './hud/SoundToggle';
import { StatusPanel } from './hud/StatusPanel';
import { ProgrammingPanel } from './hud/ProgrammingPanel';
import { sideLabel, sideTone } from './hud/sides';
import { GameOverModal } from './screens/GameOverModal';
import { MainMenu } from './screens/MainMenu';
import { useControlGroupHotkeys } from './hooks/useControlGroupHotkeys';
import { usePauseHotkey } from './hooks/usePauseHotkey';
import { useSelectAllHotkey } from './hooks/useSelectAllHotkey';
import { useT } from '../i18n';
import { useGameStore } from '../store/gameStore';
import { selectBases, selectLocalSide, selectRobots, selectSides, selectStatus } from '../store/selectors';

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
 */
function App() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const bases = useGameStore(selectBases);
  const robots = useGameStore(selectRobots);
  const sides = useGameStore(selectSides);
  const paused = useGameStore((s) => s.paused);
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const droneStatus = useGameStore((s) => s.droneStatus);
  const localSide = useGameStore(selectLocalSide);
  usePauseHotkey();
  useSelectAllHotkey();
  useControlGroupHotkeys();

  // Sides are labelled and coloured from the local client's point of view — the
  // online guest plays Owner.AI but is "player" to itself (same rule as the
  // canvas `ownerColor`), with the local side listed first.
  const sideRows = [...sides].sort((a, b) => Number(b.owner === localSide) - Number(a.owner === localSide));

  return (
    <div className="app-shell">
      <aside className="hud">
        <div className="hud__titlebar">
          <h1 className="hud__title">{t('hud', 'title')}</h1>
          <div className="hud__controls">
            <PauseButton />
            <SoundToggle />
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
      <main className="viewport">
        <GameCanvas />
        {status === 'playing' && paused && (
          <div className="pause-overlay">
            <span className="pause-overlay__label">
              <PauseIcon size={32} /> {t('hud', 'paused')}
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
