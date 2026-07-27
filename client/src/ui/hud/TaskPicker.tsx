import { isTaskBlockedForWeapon } from '../../engine/tasks/taskDefinitions';
import { useT } from '../../i18n';
import { useGameStore, type RobotSnapshot } from '../../store/gameStore';
import type { TaskType } from '../../types/enums';
import { Button } from '../common/Button';
import { ASSIGNABLE_TASKS, taskLabels } from './programOptions';

/**
 * Buttons that assign a task to every selected robot by enqueuing one AssignTask
 * command per id — the same control for one unit or many. The engine resolves the
 * concrete script (guard post / nearest enemy) at apply time from each robot's
 * live world state.
 */
export function TaskPicker({ robots }: { robots: RobotSnapshot[] }) {
  const t = useT();
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const labels = taskLabels(t);

  // Offer a directive when at least one selected robot can act on it: a lone radar
  // hides the attack orders, a mixed selection keeps them for its gunners.
  const options = ASSIGNABLE_TASKS.filter((task) => robots.some((r) => !isTaskBlockedForWeapon(r.weapon, task)));
  // Highlight only when the whole selection already agrees on one directive. The
  // store snapshot is throttled (~0.2s), so the highlight lands a beat after the
  // click — it always shows the world's real state rather than an optimistic guess.
  const current = robots.every((r) => r.task === robots[0].task) ? robots[0].task : null;

  const assign = (task: TaskType) => {
    for (const robot of robots) enqueueCommand({ kind: 'AssignTask', robotId: robot.id, task });
  };

  return (
    <div className="task-picker">
      {options.map((task) => (
        <Button
          key={task}
          className={`chip ${task === current ? 'chip--on' : ''}`.trim()}
          onClick={() => assign(task)}
        >
          {labels[task]}
        </Button>
      ))}
    </div>
  );
}
