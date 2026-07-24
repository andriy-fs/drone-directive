import { useState } from 'react';
import { isTaskBlockedForWeapon } from '../../engine/tasks/taskDefinitions';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectRobots, selectSelectedIds } from '../../store/selectors';
import { TaskType } from '../../types/enums';
import { Bar } from '../common/Bar';
import { ASSIGNABLE_TASKS, taskLabels } from './programOptions';
import { TaskPicker } from './TaskPicker';

/**
 * Selection readout + programming. A single player robot shows its live stats
 * (program as an editable dropdown, weapon, health); several show a count plus a
 * group task picker. Assignments flow through the command queue (AssignTask).
 */
export function ProgrammingPanel() {
  const t = useT();
  const robots = useGameStore(selectRobots);
  const selectedIds = useGameStore(selectSelectedIds);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  // Optimistic program pick: the store snapshot is throttled (~0.2s), so echo the
  // choice locally until the world moves off the original task, so the select
  // doesn't snap back. Reconciled during render (no effect needed).
  const [pick, setPick] = useState<{ id: string; from: TaskType; to: TaskType } | null>(null);

  const selected = robots.filter((r) => selectedIds.includes(r.id));
  const players = selected.filter((r) => r.owner === 'player');
  const single = players.length === 1 ? players[0] : null;

  // The pick is still "in flight" only while it targets the current unit and its
  // task hasn't changed yet; otherwise it has applied (or been overridden) — drop it.
  const activePick = pick && single && single.id === pick.id && single.task === pick.from ? pick : null;
  if (pick && !activePick) setPick(null);

  if (selected.length === 0) {
    return <p className="hud__muted">{t('programming', 'selectUnits')}</p>;
  }
  if (players.length === 0) {
    return <p className="hud__muted">{t('programming', 'enemyUnit')}</p>;
  }

  // Group: just the count + a task picker that applies to all selected units.
  if (!single) {
    return (
      <div className="programming">
        <p className="hud__muted">
          {players.length} {t('programming', 'robotsSelected')}
        </p>
        <TaskPicker robotIds={players.map((r) => r.id)} />
      </div>
    );
  }

  // Single unit: live stats. Keep the current program visible even if it isn't
  // normally assignable (e.g. Idle after a manual move order).
  const current = activePick ? activePick.to : single.task;
  // Hide directives this robot's weapon can't act on (e.g. "Attack Robots" for
  // a radar) — offering a choice that silently no-ops would just confuse.
  const assignable = ASSIGNABLE_TASKS.filter((task) => !isTaskBlockedForWeapon(single.weapon, task));
  const options = assignable.includes(current) ? assignable : [current, ...assignable];
  const labels = taskLabels(t);
  const assign = (task: TaskType) => {
    setPick({ id: single.id, from: single.task, to: task });
    enqueueCommand({ kind: 'AssignTask', robotId: single.id, task });
  };

  return (
    <div className="programming">
      <div className="hud__selected">
        <span className={`dot dot--${single.owner}`} />
        <span className="hud__row-label">{t('chassis', single.chassis)}</span>
      </div>

      <label className="unit-field">
        <span className="unit-field__label">{t('programming', 'directive')}</span>
        <select className="unit-select" value={current} onChange={(e) => assign(e.target.value as TaskType)}>
          {options.map((task) => (
            <option key={task} value={task}>
              {labels[task]}
            </option>
          ))}
        </select>
      </label>

      <div className="unit-field">
        <span className="unit-field__label">{t('programming', 'weapon')}</span>
        <span className="unit-field__value">{t('weapons', single.weapon)}</span>
      </div>

      <div className="unit-field">
        <span className="unit-field__label">{t('programming', 'health')}</span>
        <span className="unit-field__value">
          {Math.ceil(single.hp)} / {single.maxHp}
        </span>
      </div>
      <Bar value={single.hp / single.maxHp} />
    </div>
  );
}
