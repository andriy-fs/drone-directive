import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT } from '../../i18n';
import { GRAPHICS_QUALITIES, graphicsQuality, type GraphicsQuality } from '../../pixi/quality';
import { sfx } from '../../pixi/audio/sfx';
import { Button } from '../common/Button';
import { ChipPicker, PickerGroup } from '../common/Picker';

/**
 * How many pixels the renderer is asked to fill.
 *
 * Mirrors `SoundSettingsModal` deliberately, down to the local state mirroring a
 * module that owns and persists the value: graphics quality is a machine
 * preference, not part of the world, and nothing renders off the store for it.
 *
 * The reload notice is only shown once the pick actually differs from what is on
 * screen — antialiasing is fixed when the WebGL context is created, so the honest
 * thing is to say so rather than let the player wonder why the edges look the
 * same. The resolution half applies immediately.
 */
export function GraphicsSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [quality, setQuality] = useState<GraphicsQuality>(graphicsQuality.get());
  const [needsReload, setNeedsReload] = useState(graphicsQuality.needsReload());

  const pick = (next: GraphicsQuality) => {
    sfx.buttonClick();
    graphicsQuality.set(next);
    setQuality(next);
    setNeedsReload(graphicsQuality.needsReload());
  };

  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
          <DialogTitle className="modal__title">{t('graphics', 'title')}</DialogTitle>

          <PickerGroup label={t('graphics', 'quality')}>
            <ChipPicker
              options={GRAPHICS_QUALITIES.map((level) => ({ value: level, label: t('graphics', level) }))}
              value={quality}
              onChange={pick}
            />
          </PickerGroup>

          <p className="modal__note">{t('graphics', 'hint')}</p>
          {needsReload && <p className="modal__note modal__note--warn">{t('graphics', 'reload')}</p>}

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
