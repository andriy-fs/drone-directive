import { isTaskBlockedForWeapon } from '../../engine/tasks/taskDefinitions';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import type { RobotSnapshot } from '../../store/types';
import type { TaskType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { ASSIGNABLE_TASKS, TASK_ICONS, taskLabels } from './programOptions';

/**
 * Buttons that assign a task to every selected robot by enqueuing one AssignTask
 * command per id — the same control for one unit or many. The engine resolves the
 * concrete script (guard post / nearest enemy) at apply time from each robot's
 * live world state.
 *
 * Two columns of icon tiles: at a glance the icons carry the meaning, the labels
 * only confirm it. An odd number of offered directives leaves a hole in the last
 * row, so the final tile widens across both columns instead.
 *
 * With nothing commandable selected the grid stays put and greys out rather than
 * unmounting: the orders a unit can be given are worth seeing before there is a
 * unit to give them to, and the panel below never shifts under the cursor.
 *
 * The tiles carry no tooltip on purpose — what each directive does is one click
 * away in the card header (see `DirectivesHelpButton`), where it can be read once
 * instead of interrupting every pass of the cursor across the grid.
 */
export function TaskPicker({ robots }: { robots: RobotSnapshot[] }) {
  const t = useT();
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const labels = taskLabels(t);

  const idle = robots.length === 0;
  // Offer a directive when at least one selected robot can act on it: a lone radar
  // hides the attack orders, a mixed selection keeps them for its gunners. With no
  // selection there is no weapon to filter by, so the full set is shown, disabled.
  const options = idle
    ? ASSIGNABLE_TASKS
    : ASSIGNABLE_TASKS.filter((task) => robots.some((r) => !isTaskBlockedForWeapon(r.weapon, task)));
  // Highlight only when the whole selection already agrees on one directive. The
  // store snapshot is throttled (~0.2s), so the highlight lands a beat after the
  // click — it always shows the world's real state rather than an optimistic guess.
  const current = !idle && robots.every((r) => r.task === robots[0].task) ? robots[0].task : null;

  const assign = (task: TaskType) => {
    for (const robot of robots) enqueueCommand({ kind: 'AssignTask', robotId: robot.id, task });
  };

  // Read off `options`, not the five of ASSIGNABLE_TASKS: a lone radar hides the
  // attack orders and leaves an even two, with nothing to widen.
  const oddCount = options.length % 2 === 1;

  return (
    <div className="tile-grid">
      {options.map((task, i) => {
        const Icon = TASK_ICONS[task];
        const wide = oddCount && i === options.length - 1;
        return (
          <Button
            key={task}
            className={`tile ${task === current ? 'tile--on' : ''} ${wide ? 'tile--wide' : ''}`.trim()}
            aria-pressed={task === current}
            disabled={idle}
            onClick={() => assign(task)}
          >
            <Icon className="tile__icon" size={22} />
            <span>{labels[task]}</span>
          </Button>
        );
      })}
    </div>
  );
}
