import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../common/Button';
import { ChipPicker, PickerGroup } from '../common/Picker';
import { difficultyOptions, mapSizeOptions, opponentOptions } from './menuOptions';

/**
 * Everything that describes the match about to be played, and the button that
 * plays it — the title screen's one piece of primary content.
 *
 * All three rules write straight through to `settings.match`, so the store stays
 * the single source of truth and `GameApp` reads whatever is current when the
 * restart flag is consumed. Nothing here is local state.
 */
export function MatchSetupPanel({ onStart }: { onStart: () => void }) {
  const t = useT();
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const mapSize = useGameStore((s) => s.settings.match.mapSize);
  const aiOpponents = useGameStore((s) => s.settings.match.aiOpponents);
  const updateSettings = useGameStore((s) => s.updateSettings);

  return (
    <section className="menu-panel">
      <h2 className="menu-panel__heading">{t('mainMenu', 'matchSetup')}</h2>

      <PickerGroup label={t('mainMenu', 'difficulty')}>
        <ChipPicker
          className="picker--segmented"
          options={difficultyOptions(t)}
          value={difficulty}
          onChange={(value) => updateSettings({ match: { difficulty: value } })}
        />
      </PickerGroup>

      <PickerGroup label={t('mainMenu', 'opponents')}>
        <ChipPicker
          className="picker--segmented"
          options={opponentOptions(t)}
          value={aiOpponents}
          onChange={(value) => updateSettings({ match: { aiOpponents: value } })}
        />
      </PickerGroup>

      <PickerGroup label={t('mapSize', 'label')}>
        <ChipPicker
          className="picker--segmented"
          options={mapSizeOptions(t)}
          value={mapSize}
          onChange={(value) => updateSettings({ match: { mapSize: value } })}
        />
      </PickerGroup>

      <Button className="btn--primary menu-panel__cta" onClick={onStart}>
        {t('mainMenu', 'start')}
      </Button>
    </section>
  );
}
