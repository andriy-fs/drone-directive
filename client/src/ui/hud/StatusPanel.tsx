import { useT } from '../../i18n';
import { selectLocalSide, selectPlayerBase, selectResources, selectSides } from '../../store/selectors';
import { useGameStore } from '../../store/gameStore';
import { Bar } from '../common/Bar';
import { Button } from '../common/Button';
import { BuildRobotModal } from './BuildRobotModal';
import { programLabel } from './programOptions';
import { sideLabel, sideTone } from './sides';

/**
 * Resources per side, player production progress, and the entry point to the
 * build flow. Subscribes only to resources + the player base slice to avoid
 * re-rendering on unrelated world changes.
 */
export function StatusPanel() {
  const t = useT();
  const resources = useGameStore(selectResources);
  const localSide = useGameStore(selectLocalSide);
  const sides = useGameStore(selectSides);
  const playerBase = useGameStore(selectPlayerBase);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  // Dialog visibility lives in the store so a double-click on the base (canvas
  // side) opens the very same dialog as this panel's button.
  const buildOpen = useGameStore((s) => s.buildDialogOpen);
  const setBuildOpen = useGameStore((s) => s.setBuildDialogOpen);

  // One row per side, the local one first (the online guest plays Owner.AI).
  const rows = [...sides].sort((a, b) => Number(b.owner === localSide) - Number(a.owner === localSide));

  const queueLength = playerBase?.queueLength ?? 0;
  const auto = playerBase?.autoBuild ?? null;
  const stopAuto = () => {
    if (playerBase) enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: null });
  };

  return (
    <div className="status-panel">
      <ul className="hud__list">
        {rows.map((side) => (
          <li key={side.owner} className={`hud__row ${side.alive ? '' : 'hud__row--out'}`.trim()}>
            <span className={`dot dot--${sideTone(side.owner, localSide)}`} />
            <span className="hud__row-label">
              {side.owner === localSide ? t('statusPanel', 'resources') : sideLabel(side.owner, sides, localSide, t)}
            </span>
            <span className="hud__row-value">{Math.floor(resources[side.owner] ?? 0)}</span>
          </li>
        ))}
      </ul>

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
            {t('statusPanel', 'auto')}: {auto.chassis}/{auto.weapon}
            {auto.task !== undefined ? ` · ${programLabel(auto.task, t)}` : ''}
          </span>
          <Button className="auto-build__stop" onClick={stopAuto}>
            {t('statusPanel', 'stop')}
          </Button>
        </div>
      )}

      <Button onClick={() => setBuildOpen(true)} disabled={!playerBase}>
        {t('statusPanel', 'buildProgram')}
      </Button>

      {buildOpen && <BuildRobotModal onClose={() => setBuildOpen(false)} />}
    </div>
  );
}
