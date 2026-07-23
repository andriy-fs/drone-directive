import type { TaskType } from '../../types/enums';
import { Button } from '../common/Button';
import { PROGRAM_OPTIONS } from './programOptions';

/** Single-select program/task chooser, shared by build-time and pre-game setup flows. */
export function ProgramPicker({
  value,
  onChange,
}: {
  value: TaskType | null;
  onChange: (task: TaskType | null) => void;
}) {
  return (
    <div className="picker">
      {PROGRAM_OPTIONS.map((p) => (
        <Button
          key={p.label}
          className={`chip ${p.value === value ? 'chip--on' : ''}`.trim()}
          onClick={() => onChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
