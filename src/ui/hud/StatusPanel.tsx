import { useState } from 'react';
import { useT } from '../../i18n';
import { selectPlayerBase, selectResources } from '../../store/selectors';
import { useGameStore } from '../../store/gameStore';
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
  const playerBase = useGameStore(selectPlayerBase);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const [buildOpen, setBuildOpen] = useState(false);

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
          <span className="hud__row-value">{Math.floor(resources.player)}</span>
        </li>
        <li className="hud__row">
          <span className="dot dot--ai" />
          <span className="hud__row-label">{t('statusPanel', 'ai')}</span>
          <span className="hud__row-value">{Math.floor(resources.ai)}</span>
        </li>
      </ul>

      {playerBase && playerBase.queueLength > 0 && (
        <div className="build-progress">
          <span className="hud__muted">
            {t('statusPanel', 'building')} · {playerBase.queueLength} {t('statusPanel', 'queued')}
          </span>
          <Bar value={playerBase.buildProgress} />
        </div>
      )}

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
