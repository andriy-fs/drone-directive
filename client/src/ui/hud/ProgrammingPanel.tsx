import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectLocalSide, selectRobots, selectSelectedIds } from '../../store/selectors';
import { Bar } from '../common/Bar';
import { TaskPicker } from './TaskPicker';

/**
 * Selection readout + programming. One own robot shows its live stats (weapon,
 * health); several show a count. Either way the directive is assigned through the
 * same button picker, and assignments flow through the command queue (AssignTask).
 */
export function ProgrammingPanel() {
  const t = useT();
  const robots = useGameStore(selectRobots);
  const selectedIds = useGameStore(selectSelectedIds);
  const localSide = useGameStore(selectLocalSide);

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
