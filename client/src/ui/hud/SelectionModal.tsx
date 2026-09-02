import type { WeaponType } from '@drone-directive/types/enums';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { ownWeaponCounts, selectAllOwnRobots, selectOwnRobotsByWeapon } from '../../store/selection';
import { selectLocalSide, selectRobots, selectSelectedIds } from '../../store/selectors';
import { Button } from '../common/Button';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { ClearSelectionIcon, SelectAllIcon } from '../common/icons';
import { PickerGroup } from '../common/Picker';
import { WEAPON_ICONS, WEAPON_OPTIONS } from './unitOptions';

/**
 * Every way of picking an army, in one dialog behind a single HUD tile.
 *
 * It replaced two tiles — "select all" and "clear selection" — that were already
 * crowding the Command section, and it is what makes the per-weapon manoeuvres
 * reachable at all: pulling together every cannon used to be a double-click on one
 * of them, which is a shortcut a player has to be told about and a gesture a finger
 * cannot make reliably.
 *
 * **Only the weapons the player is actually fielding get a button.** The roster is
 * built from the live snapshot rather than from `WeaponType`, so the dialog is a
 * readout of the army as much as a set of actions — a button here always selects
 * something, and its count says how much.
 *
 * Every action closes the dialog: each one is a single choice whose result is on
 * the battlefield, not in here, and leaving it open would hide what was just picked.
 */
export function SelectionModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const robots = useGameStore(selectRobots);
  const localSide = useGameStore(selectLocalSide);
  const selectedIds = useGameStore(selectSelectedIds);
  const clearSelection = useGameStore((s) => s.clearSelection);

  const mine = robots.filter((r) => r.owner === localSide);
  const counts = ownWeaponCounts(robots, localSide);
  // The build menu's order rather than the snapshot's, so the buttons do not
  // reshuffle as units are built and lost. Anything the roster somehow holds that
  // the build menu does not list is appended rather than dropped — a unit the
  // player owns must never be unreachable from here.
  const listed = WEAPON_OPTIONS.filter((w) => counts.has(w));
  const rest = [...counts.keys()].filter((w) => !WEAPON_OPTIONS.includes(w));
  const weapons: WeaponType[] = [...listed, ...rest];

  /** Every button here picks once and hands the field back. */
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal modal--selection">
          <DialogTitle className="modal__title">{t('selection', 'title')}</DialogTitle>

          <div className="tile-grid">
            <Button className="tile" onClick={() => run(selectAllOwnRobots)} disabled={mine.length === 0}>
              <SelectAllIcon className="tile__icon" size={22} />
              <span>{t('selection', 'all')}</span>
              <span className="tile__count">{mine.length}</span>
            </Button>
            <Button className="tile" onClick={() => run(clearSelection)} disabled={selectedIds.length === 0}>
              <ClearSelectionIcon className="tile__icon" size={22} />
              <span>{t('selection', 'clear')}</span>
              <span className="tile__count">{selectedIds.length}</span>
            </Button>
          </div>

          {weapons.length > 0 && (
            <PickerGroup label={t('selection', 'byWeapon')}>
              <div className="tile-grid">
                {weapons.map((weapon) => {
                  const Icon = WEAPON_ICONS[weapon];
                  return (
                    <Button
                      key={weapon}
                      className="tile"
                      onClick={() => run(() => selectOwnRobotsByWeapon(weapon))}
                    >
                      <Icon className="tile__icon" size={22} />
                      <span>{t('weapons', weapon)}</span>
                      <span className="tile__count">{counts.get(weapon)}</span>
                    </Button>
                  );
                })}
              </div>
            </PickerGroup>
          )}

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
