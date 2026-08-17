import { defaultBuildOrder } from '../../config/gameSettings';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../common/Button';
import { Settings2Icon } from '../common/icons';
import { PickerGroup } from '../common/Picker';
import { Switch } from '../common/Switch';

/**
 * Pre-game base setup, as one row: on/off inline, everything behind it — model
 * and new-robot directive — behind the gear.
 *
 * Shared by both title-screen modes rather than owned by the solo panel, because
 * the setting means the same thing in both: online it reaches the world at the
 * first networked tick as `SetDefaultTask` + `SetAutoBuild` commands (see
 * `GameApp`), which is the same route the in-match build dialog uses.
 */
export function BaseSetupRow({ onOpenBaseSetup }: { onOpenBaseSetup: () => void }) {
  const t = useT();
  const autoBuild = useGameStore((s) => s.settings.base.autoBuild);
  const updateSettings = useGameStore((s) => s.updateSettings);

  return (
    <PickerGroup label={t('mainMenu', 'baseSetup')}>
      <div className="setup-row">
        <span className="setup-row__label">{t('baseSetup', 'autoProduce')}</span>
        {/* Turning it back on restores the default model, not the last one:
            `autoBuild` is null while off, so the previous value is already gone
            — only the dialog remembers it, which is why it re-seeds from the
            store rather than from here. */}
        <Switch
          className="switch"
          checked={autoBuild !== null}
          onChange={(on: boolean) => updateSettings({ base: { autoBuild: on ? { ...defaultBuildOrder } : null } })}
          aria-label={t('baseSetup', 'autoProduce')}
        >
          <span className="switch__knob" />
        </Switch>
        <Button
          className="setup-row__gear"
          onClick={onOpenBaseSetup}
          aria-label={t('mainMenu', 'autoProduceProgram')}
          title={t('mainMenu', 'autoProduceProgram')}
        >
          <Settings2Icon size={16} aria-hidden />
        </Button>
      </div>
    </PickerGroup>
  );
}
