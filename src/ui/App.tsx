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
import { useT } from '../i18n';
import { useGameStore } from '../store/gameStore';
import { selectBases, selectRobots, selectStatus } from '../store/selectors';

import './App.css';

const STATUS_KEYS = {
  menu: 'statusMenu',
  playing: 'statusPlaying',
  won: 'statusWon',
  lost: 'statusLost',
} as const;

const OWNER_KEYS = {
  player: 'ownerPlayer',
  ai: 'ownerAi',
  neutral: 'ownerNeutral',
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
                <span className={`dot dot--${base.owner}`} />
                <span className="hud__row-label">{t('hud', OWNER_KEYS[base.owner])}</span>
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
            <li className="hud__row">
              <span className="dot dot--player" />
              <span className="hud__row-label">{t('hud', 'player')}</span>
              <span className="hud__row-value">{playerCount}</span>
            </li>
            <li className="hud__row">
              <span className="dot dot--ai" />
              <span className="hud__row-label">{t('hud', 'ai')}</span>
              <span className="hud__row-value">{aiCount}</span>
            </li>
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
              {droneStatus.autoBuildSuppressed && ` · ${t('hud', 'autoBuildPaused')}`}
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
