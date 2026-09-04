import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { commandableRobots } from '../../store/selection';
import { selectLocalSide, selectRobots, selectSelectedBaseId, selectSelectedIds } from '../../store/selectors';
import { Button } from '../common/Button';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, DialogFrame } from '../common/Dialog';
import { FormationPicker } from './FormationPicker';

/**
 * The formation shapes, moved out of the Directive card and behind a Command tile.
 *
 * They left the sidebar for the reason the selection manoeuvres did: the rail was
 * carrying twelve tiles in two grids, and a shape is picked far less often than a
 * directive is — it is the kind of choice worth a moment's attention rather than a
 * permanent quarter of the panel. The tiles themselves are unchanged, tooltips and
 * all (`FormationPicker`), so what a shape costs still reads under the cursor at
 * the moment of choosing.
 *
 * The selection is re-derived here rather than passed in: this dialog has no
 * parent that already knows it, and `commandableRobots` is what keeps its answer
 * identical to the Directive card's.
 */
export function FormationModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const robots = useGameStore(selectRobots);
  const selectedIds = useGameStore(selectSelectedIds);
  const selectedBaseId = useGameStore(selectSelectedBaseId);
  const localSide = useGameStore(selectLocalSide);
  const mine = commandableRobots(robots, selectedIds, localSide, selectedBaseId);

  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <DialogFrame>
        <DialogPanel className="modal modal--formation">
          <DialogTitle className="modal__title">{t('programming', 'formationHeading')}</DialogTitle>

          {/* Closing on a pick, like the selection dialog: the result of a shape is
              on the battlefield, and the tile's own highlight comes off a throttled
              snapshot that would still be showing the old one for a few frames. */}
          <FormationPicker robots={mine} onPicked={onClose} />

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </DialogFrame>
    </Dialog>
  );
}
