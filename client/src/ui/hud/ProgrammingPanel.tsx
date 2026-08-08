import type { ReactNode } from 'react';
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
 * Selection readout + programming. Always the same four slots — a title, a health
 * bar, the directive grid, and a detail line — because this panel changes with
 * every click on the map, and anything that appears or disappears here shoves the
 * rest of the sidebar up and down under the cursor. Only the *contents* of the
 * slots vary:
 *
 * - own robots: named by chassis when there's one of them, counted when there are
 *   several, with health pooled over the lot — "how much fight is left in this
 *   group" reads the same for one unit and for twenty. The detail line carries the
 *   weapon of a lone robot.
 * - own base: its own name and hull, with its production program and rally point
 *   on the detail lines. Both are set by gesture, not from here — right-click
 *   plants the rally point, right-click on the base itself clears it.
 * - nothing of ours: a zero count over an inert grey bar, the grid disabled, and
 *   the detail line explaining why.
 *
 * Assignments flow through the command queue (AssignTask).
 */
export function ProgrammingPanel() {
  const t = useT();
  const robots = useGameStore(selectRobots);
  const selectedIds = useGameStore(selectSelectedIds);
  const selectedBaseId = useGameStore(selectSelectedBaseId);
  const bases = useGameStore(selectBases);
  const localSide = useGameStore(selectLocalSide);

  const base = selectedBaseId ? bases.find((b) => b.id === selectedBaseId) : undefined;
  const selected = robots.filter((r) => selectedIds.includes(r.id));
  // Commandable = owned by the local side (the online guest plays Owner.AI), so
  // a stray enemy in the selection can never be handed a directive.
  const mine = base ? [] : selected.filter((r) => r.owner === localSide);
  const single = mine.length === 1 ? mine[0] : null;
  // Nothing of ours under the cursor: the bar has no health to report, so it goes
  // inert — grey and full — rather than empty and green, which would read as a
  // selection that has just been wiped out.
  const inert = !base && mine.length === 0;
  const hp = base ? base.hp : mine.reduce((sum, r) => sum + r.hp, 0);
  const maxHp = base ? base.maxHp : mine.reduce((sum, r) => sum + r.maxHp, 0);

  let title: string;
  if (base) title = t('programming', 'baseSelected');
  // One robot is worth naming; a count of one would also have to be pluralised.
  else if (single) title = t('chassis', single.chassis);
  else title = `${mine.length} ${t('programming', 'robotsSelected')}`;

  let detail: ReactNode = null;
  if (base) {
    detail = (
      <>
        <div className="unit-field">
          <span className="unit-field__label">{t('programming', 'baseProgram')}</span>
          <span className="unit-field__value">{programLabel(base.defaultTask, t)}</span>
        </div>
        {/* The hint is a tooltip rather than a paragraph: three lines of standing
            instructions here would move everything below them on every click, and
            the same gesture is spelled out in the Controls dialog. */}
        <div className="unit-field" title={t('programming', 'rallyHint')}>
          <span className="unit-field__label">{t('programming', 'rallyPoint')}</span>
          <span className="unit-field__value">
            {base.rally
              ? `${Math.round(base.rally.x)}, ${Math.round(base.rally.y)}`
              : t('programming', 'rallyNone')}
          </span>
        </div>
      </>
    );
  } else if (single) {
    detail = (
      <div className="unit-field">
        <span className="unit-field__label">{t('programming', 'weapon')}</span>
        <span className="unit-field__value">{t('weapons', single.weapon)}</span>
      </div>
    );
  } else if (mine.length === 0) {
    detail = <p className="hud__muted">{t('programming', selected.length === 0 ? 'selectUnits' : 'enemyUnit')}</p>;
  }

  return (
    <div className="programming">
      <div className="selection-head">
        {/* Uppercased in CSS rather than in the string: `toUpperCase()` on a
            translated label is a per-language question we don't need to answer. */}
        <span className="selection-head__title">{title}</span>
        <span className="selection-head__hp">
          {Math.ceil(hp)} / {maxHp} {t('chassis', 'statsHp')}
        </span>
      </div>
      <Bar
        className={`bar--segments ${inert ? 'bar--idle' : ''}`.trim()}
        value={inert ? 1 : maxHp > 0 ? hp / maxHp : 0}
      />

      <TaskPicker robots={mine} />

      {/* Kept mounted and at a fixed height even when it has nothing to say — it
          holds two rows for a base and one for a robot. */}
      <div className="programming__detail">{detail}</div>
    </div>
  );
}
