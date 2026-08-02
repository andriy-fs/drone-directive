import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import {
  selectBases,
  selectLocalSide,
  selectRobots,
  selectSelectedBaseId,
  selectSelectedIds,
} from '../../store/selectors';
import { Bar } from '../common/Bar';
import { programLabel } from './programOptions';
import { TaskPicker } from './TaskPicker';

/**
 * Selection readout + programming. One own robot shows its live stats (weapon,
 * health); several show a count. Either way the directive is assigned through the
 * same button picker, and assignments flow through the command queue (AssignTask).
 *
 * A selected base gets its own readout instead: the program its new units take
 * and where they gather. Both are set by gesture, not from here — right-click
 * plants the rally point, right-click on the base itself clears it.
 */
export function ProgrammingPanel() {
  const t = useT();
  const robots = useGameStore(selectRobots);
  const selectedIds = useGameStore(selectSelectedIds);
  const selectedBaseId = useGameStore(selectSelectedBaseId);
  const bases = useGameStore(selectBases);
  const localSide = useGameStore(selectLocalSide);

  const base = selectedBaseId ? bases.find((b) => b.id === selectedBaseId) : undefined;
  if (base) {
    return (
      <div className="programming">
        <div className="hud__selected">
          <span className="dot dot--player" />
          <span className="hud__row-label">{t('programming', 'baseSelected')}</span>
        </div>

        <div className="unit-field">
          <span className="unit-field__label">{t('programming', 'baseProgram')}</span>
          <span className="unit-field__value">{programLabel(base.defaultTask, t)}</span>
        </div>

        <div className="unit-field">
          <span className="unit-field__label">{t('programming', 'rallyPoint')}</span>
          <span className="unit-field__value">
            {base.rally
              ? `${Math.round(base.rally.x)}, ${Math.round(base.rally.y)}`
              : t('programming', 'rallyNone')}
          </span>
        </div>

        <p className="hud__muted">{t('programming', 'rallyHint')}</p>
      </div>
    );
  }

  const selected = robots.filter((r) => selectedIds.includes(r.id));
  // Commandable = owned by the local side (the online guest plays Owner.AI), so
  // a stray enemy in the selection can never be handed a directive.
  const mine = selected.filter((r) => r.owner === localSide);
  const single = mine.length === 1 ? mine[0] : null;

  if (selected.length === 0) {
    return <p className="hud__muted">{t('programming', 'selectUnits')}</p>;
  }
  if (mine.length === 0) {
    return <p className="hud__muted">{t('programming', 'enemyUnit')}</p>;
  }

  return (
    <div className="programming">
      {single ? (
        <div className="hud__selected">
          {/* Always own-side here, so the friendly colour — matching the canvas (see pixi ownerColor). */}
          <span className="dot dot--player" />
          <span className="hud__row-label">{t('chassis', single.chassis)}</span>
        </div>
      ) : (
        <p className="hud__muted">
          {mine.length} {t('programming', 'robotsSelected')}
        </p>
      )}

      <TaskPicker robots={mine} />

      {single && (
        <>
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
        </>
      )}
    </div>
  );
}
