import { useT } from '../../i18n';
import { selectLocalSide, selectPlayerBase, selectResources } from '../../store/selectors';
import { useGameStore } from '../../store/gameStore';
import { Owner } from '../../types/enums';
import { Bar } from '../common/Bar';
import { Button } from '../common/Button';
import { BuildRobotModal } from './BuildRobotModal';
import { programLabel } from './programOptions';

/**
 * Resources per side, player production progress, and the entry point to the
 * build flow. Subscribes only to resources + the player base slice to avoid
 * re-rendering on unrelated world changes.
 */
export function StatusPanel() {
  const t = useT();
  const resources = useGameStore(selectResources);
  const localSide = useGameStore(selectLocalSide);
  const playerBase = useGameStore(selectPlayerBase);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  // Dialog visibility lives in the store so a double-click on the base (canvas
  // side) opens the very same dialog as this panel's button.
  const buildOpen = useGameStore((s) => s.buildDialogOpen);
  const setBuildOpen = useGameStore((s) => s.setBuildDialogOpen);

  // Show the local side's resources first (the online guest plays Owner.AI).
  const myResources = localSide === Owner.Player ? resources.player : resources.ai;
  const foeResources = localSide === Owner.Player ? resources.ai : resources.player;

  const queueLength = playerBase?.queueLength ?? 0;
  const auto = playerBase?.autoBuild ?? null;
  const stopAuto = () => {
    if (playerBase) enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: null });
  };

  return (
    <div className="status-panel">
      <ul className="hud__list">
        <li className="hud__row">
          <span className="dot dot--player" />
          <span className="hud__row-label">{t('statusPanel', 'resources')}</span>
          <span className="hud__row-value">{Math.floor(myResources)}</span>
        </li>
        <li className="hud__row">
          <span className="dot dot--ai" />
          <span className="hud__row-label">{t('statusPanel', 'ai')}</span>
          <span className="hud__row-value">{Math.floor(foeResources)}</span>
        </li>
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
