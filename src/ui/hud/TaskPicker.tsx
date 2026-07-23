import { useGameStore } from '../../store/gameStore';
import type { TaskType } from '../../types/enums';
import { Button } from '../common/Button';
import { ASSIGNABLE_TASKS, TASK_LABELS } from './programOptions';

/**
 * Buttons that assign a task to every selected robot by enqueuing one AssignTask
 * command per id. The engine resolves the concrete script (guard post / nearest
 * enemy) at apply time from each robot's live world state.
 */
export function TaskPicker({ robotIds }: { robotIds: string[] }) {
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const assign = (task: TaskType) => {
    for (const robotId of robotIds) enqueueCommand({ kind: 'AssignTask', robotId, task });
  };
  return (
    <div className="task-picker">
      {ASSIGNABLE_TASKS.map((task) => (
        <Button key={task} onClick={() => assign(task)}>
          {TASK_LABELS[task]}
        </Button>
      ))}
    </div>
  );
}
