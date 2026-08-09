import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT } from '../../i18n';
import { Button } from '../common/Button';
import { ASSIGNABLE_TASKS, TASK_ICONS, taskHint, taskLabels } from '../hud/programOptions';

/**
 * Reference modal for the directive tiles, opened from the Directives card's
 * header. These descriptions used to be tooltips on the tiles themselves, which
 * served the first match and got in the way of every one after it — a player who
 * has learned the five orders shouldn't have text popping up every time the
 * cursor crosses the grid.
 */
export function DirectivesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const labels = taskLabels(t);

  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
          <DialogTitle className="modal__title">{t('hud', 'directive')}</DialogTitle>
          <p className="modal__body">{t('programs', 'intro')}</p>

          <div className="directive-guide">
            {ASSIGNABLE_TASKS.map((task) => {
              const Icon = TASK_ICONS[task];
              return (
                <div className="directive-guide__item" key={task}>
                  <Icon className="directive-guide__icon" size={20} />
                  <div>
                    <span className="unit-guide__name">{labels[task]}</span>
                    <p className="unit-guide__note">{taskHint(task, t)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
