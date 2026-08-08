import { useT } from '../../i18n';
import { selectLocalSide, selectPlayerBase, selectResources, selectRobots } from '../../store/selectors';
import { useGameStore } from '../../store/gameStore';
import { Bar } from '../common/Bar';
import { Button } from '../common/Button';
import { FactoryIcon, SelectAllIcon } from '../common/icons';
import { selectAllOwnRobots } from '../hooks/useSelectAllHotkey';
import { BuildRobotModal } from './BuildRobotModal';
import { programLabel } from './programOptions';

/**
 * Everything the local side has and can spend: its bank, its base, its army's
 * size, what the base is currently building, and the two actions that start from
 * here. The base and unit tallies used to be sections of their own listing every
 * side in the match — with the opponents' rows gone they were one number each,
 * and belong next to the resources they compete for.
 *
 * Deliberately says nothing about anyone else: an opponent's bank is intelligence
 * the map never gives up, and reading it off the HUD — against an AI or against a
 * person online — would be reading their hand.
 */
export function StatusPanel() {
  const t = useT();
  const resources = useGameStore(selectResources);
  const localSide = useGameStore(selectLocalSide);
  const playerBase = useGameStore(selectPlayerBase);
  const robots = useGameStore(selectRobots);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  // Dialog visibility lives in the store so a double-click on the base (canvas
  // side) opens the very same dialog as this panel's button.
  const buildOpen = useGameStore((s) => s.buildDialogOpen);
  const setBuildOpen = useGameStore((s) => s.setBuildDialogOpen);

  const myRobotCount = robots.filter((r) => r.owner === localSide).length;
  const queueLength = playerBase?.queueLength ?? 0;
  const auto = playerBase?.autoBuild ?? null;
  const stopAuto = () => {
    if (playerBase) enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: null });
  };

  return (
    <div className="status-panel">
      <div className="hud__row">
        <span className="hud__row-label">{t('statusPanel', 'resources')}</span>
        <span className="hud__row-value">{Math.floor(resources[localSide] ?? 0)}</span>
      </div>

      <div className="hud__row">
        <span className="hud__row-label">{t('programming', 'baseSelected')}</span>
        <span className="hud__row-value">
          {playerBase ? `${Math.ceil(playerBase.hp)}/${playerBase.maxHp}` : '—'}
        </span>
      </div>

      <div className="hud__row">
        <span className="hud__row-label">{t('hud', 'units')}</span>
        <span className="hud__row-value">{myRobotCount}</span>
      </div>

      <div className={`build-progress ${!queueLength ? 'build-progress--idle' : ''}`.trim()}>
        <span className="hud__muted">
          {queueLength > 0
            ? `${t('statusPanel', 'building')} · ${queueLength} ${t('statusPanel', 'queued')}`
            : t('statusPanel', 'idle')}
        </span>
        <Bar value={playerBase?.buildProgress ?? 0} />
      </div>

      {auto && (
        <div className="auto-build">
          <span className="hud__muted">
            {t('statusPanel', 'auto')}: {t('chassis', auto.chassis)}/{t('weapons', auto.weapon)}
            {auto.task !== undefined ? ` · ${programLabel(auto.task, t)}` : ''}
          </span>
          <Button className="auto-build__stop" onClick={stopAuto}>
            {t('statusPanel', 'stop')}
          </Button>
        </div>
      )}

      {/* The same tiles as the directive grid: the two things a player starts from
          this section, one of which (select-all) is otherwise a shortcut they have
          to know about before they can use it. */}
      <div className="tile-grid">
        <Button className="tile" onClick={() => setBuildOpen(true)} disabled={!playerBase}>
          <FactoryIcon className="tile__icon" size={22} />
          <span>{t('statusPanel', 'buildProgram')}</span>
        </Button>
        <Button className="tile" onClick={selectAllOwnRobots} disabled={myRobotCount === 0}>
          <SelectAllIcon className="tile__icon" size={22} />
          <span>{t('statusPanel', 'selectAll')}</span>
        </Button>
      </div>

      {buildOpen && <BuildRobotModal onClose={() => setBuildOpen(false)} />}
    </div>
  );
}
