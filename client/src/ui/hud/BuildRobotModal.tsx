import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { buildCost } from '../../engine/economy';
import { gameConfig } from '../../config/gameConfig';
import { ROBOT_MODELS } from '../../models';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectLocalSide, selectPlayerBase, selectResources, selectRobotLoad } from '../../store/selectors';
import { ChassisType, TaskType, WeaponType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { XIcon } from '../common/icons';
import { ChipPicker, PickerGroup } from '../common/Picker';
import { Wireframe } from '../common/Wireframe';
import { useTurntable } from '../hooks/useTurntable';
import { useTypewriter } from '../hooks/useTypewriter';
import { chassisStats, weaponStats } from './unitHints';
import { directiveOptions } from './programOptions';
import { chassisOptions, weaponOptions } from './unitOptions';

/**
 * Configure a robot (chassis + weapon + directive), see what it will look like
 * and what its numbers are, and either put it on the factory's queue — at the
 * back, or in front of everything waiting — or make it the model the base builds
 * on repeat. Auto-build's off switch lives here too, beside the on switch, and
 * the queue itself is listed with a way to take any order back off it.
 *
 * **Nothing but Close closes it.** Ordering a robot is not the end of what a
 * player came here to do — the usual next act is ordering another one, or a
 * different one, and a dialog that dismissed itself made them reopen it every
 * time. Every button reports its effect through the list on the right instead.
 *
 * **Nothing here is gated on the wallet.** Ordering is free; the price is taken
 * when an order reaches the head of the queue and building actually starts (see
 * `engine/systems/production.ts`). That is a deliberate reversal: a disabled
 * button used to leave the player watching a number climb with the dialog open,
 * which is not a decision, it is a wait. The cost row stays, and a price the
 * player cannot cover reads red — as a warning that the machine will not start
 * yet, not as a refusal.
 *
 * The one thing that *does* refuse an order is the per-side robot cap, which the
 * engine enforces by silently dropping the command. Both buttons go dead at the
 * cap and say why, because a button that appears to work and does nothing is the
 * worse of the two failures.
 */
export function BuildRobotModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const playerBase = useGameStore(selectPlayerBase);
  // Seed from the base's current auto-build model so it reflects (and doesn't
  // accidentally reset) the running setting. Unlike the pre-game setting, this
  // dialog offers no "no directive" card, so it falls back to Guard rather than
  // to null — a robot ordered here always leaves with a standing order.
  const auto = playerBase?.autoBuild ?? null;
  const [chassis, setChassis] = useState<ChassisType>(auto?.chassis ?? ChassisType.Tracks);
  const [weapon, setWeapon] = useState<WeaponType>(auto?.weapon ?? WeaponType.Cannon);
  const [task, setTask] = useState<TaskType>(auto?.task ?? playerBase?.defaultTask ?? TaskType.Guard);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const resources = useGameStore(selectResources);
  const localSide = useGameStore(selectLocalSide);
  const robotLoad = useGameStore(selectRobotLoad);
  const spin = useTurntable();
  const queue = playerBase?.queue ?? [];

  /**
   * The spec sheet under the model, typed out the way the radio types a
   * transmission — one passage, newlines and all, so it reads as a readout coming
   * in rather than as a label that was always there.
   *
   * Keyed on the configuration, so picking a different weapon retypes it. That is
   * the point of the effect here: it draws the eye to the numbers that just
   * changed, which a static block never would.
   */
  const spec = [
    `${t('chassis', chassis)} / ${t('weapons', weapon)}`,
    chassisStats(chassis, t),
    weaponStats(weapon, t),
  ].join('\n');
  const typed = useTypewriter(`${chassis}/${weapon}`, spec.length);

  const cost = buildCost({ chassis, weapon });
  // The local side's own wallet — the online guest plays `Owner.AI`, so reading
  // `resources.player` here would gate them on their opponent's balance.
  const wallet = resources[localSide] ?? 0;
  const affordable = wallet >= cost;
  // Living units plus everything queued, which is what the engine's cap counts.
  const atCap = robotLoad >= gameConfig.production.maxRobots;
  const canOrder = !!playerBase && !atCap;

  /**
   * Take one order back off the queue.
   *
   * The position *and* what stood there: a build can finish between the snapshot
   * this list was drawn from and the tick the command lands on, and the engine
   * uses the order to find the right slot when it has moved. Money already spent
   * on it comes back — see `applyCommand`.
   */
  const cancelQueued = (index: number) => {
    if (!playerBase) return;
    enqueueCommand({ kind: 'CancelQueued', baseId: playerBase.id, index, order: queue[index] });
  };

  /** `front` puts the order ahead of everything waiting; the engine will not displace a build already paid for. */
  const order = (front: boolean) => {
    if (!canOrder || !playerBase) return;
    enqueueCommand({ kind: 'BuildRobot', baseId: playerBase.id, order: { chassis, weapon, task }, front });
  };

  const startAutoBuild = () => {
    if (!playerBase) return;
    enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: { chassis, weapon, task } });
  };

  /** The same command the status panel's Stop sends — auto-build is one setting with one off switch. */
  const stopAutoBuild = () => {
    if (!playerBase) return;
    enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: null });
  };

  // Read live rather than from `auto` above, which is only the seed for the
  // pickers: a base whose auto-build was switched off from the status panel while
  // this dialog was open has nothing left to cancel.
  const autoRunning = playerBase?.autoBuild != null;

  const capNote = atCap ? t('buildRobot', 'atCap') : undefined;

  return (
    <Dialog open={true} onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel
          className="modal modal--build"
          onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        >
          <div className="modal__head">
            <DialogTitle className="modal__title">{t('buildRobot', 'title')}</DialogTitle>
            <Button className="modal__close" onClick={onClose} aria-label={t('aria', 'close')} title={t('aria', 'close')}>
              <XIcon size={16} aria-hidden />
            </Button>
          </div>

          {/* Everything between the fixed title and the fixed actions. See
              `.build-scroll`: the panel itself no longer scrolls, this does. */}
          <div className="build-scroll">
            <div className="build-layout">
              {/* The machine the rows beside it add up to, and its numbers — first
                  in the markup, on the right in the layout (see `.build-aside`).
                  The model turns because a static outline of a box on tracks reads
                  as an icon; one that turns reads as a thing, and shows the barrel
                  and the engine deck in the same few seconds. */}
              <div className="build-aside">
                <div className="build-preview">
                  <Wireframe model={ROBOT_MODELS[chassis][weapon]} spin={spin} title={t('buildRobot', 'preview')} />
                </div>
                {/* `aria-live="off"`: the full text is in the DOM from the first
                    frame — only its visible slice grows — so there is nothing for a
                    screen reader to announce character by character. */}
                <p className="build-spec" aria-live="off">
                  {spec.slice(0, typed)}
                  {typed < spec.length && (
                    <span className="build-spec__cursor" aria-hidden="true">
                      ▋
                    </span>
                  )}
                </p>

                {queue.length > 0 && (
                  <div className="build-queue">
                    <span className="picker__label">{t('buildRobot', 'queueHeading')}</span>
                    {/* Numbered, because position is the whole meaning of the list:
                        1 is what the factory is working on now. Each row cancels on
                        the spot rather than through the footer — editing the queue
                        is not an action you commit on the way out. */}
                    <ol className="build-queue__list">
                      {queue.map((order, i) => (
                        <li className="build-queue__row" key={`${i}-${order.chassis}-${order.weapon}`}>
                          <span className="build-queue__index">{i + 1}.</span>
                          <span className="build-queue__name">
                            {t('chassis', order.chassis)} / {t('weapons', order.weapon)}
                          </span>
                          <Button
                            className="build-queue__drop"
                            onClick={() => cancelQueued(i)}
                            aria-label={t('buildRobot', 'cancelQueued')}
                            title={t('buildRobot', 'cancelQueued')}
                          >
                            <XIcon size={12} aria-hidden />
                          </Button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              <div className="build-config">
                <PickerGroup label={t('buildRobot', 'chassis')}>
                  <ChipPicker
                    className="picker--cards"
                    options={chassisOptions(t)}
                    value={chassis}
                    onChange={setChassis}
                  />
                </PickerGroup>
                <PickerGroup label={t('buildRobot', 'weapon')}>
                  <ChipPicker className="picker--cards" options={weaponOptions(t)} value={weapon} onChange={setWeapon} />
                </PickerGroup>
                <PickerGroup label={t('buildRobot', 'program')}>
                  <ChipPicker className="picker--cards" options={directiveOptions(t)} value={task} onChange={setTask} />
                </PickerGroup>
              </div>
            </div>

            <div className="build-cost">
              <div className="build-cost__stat">
                <span className="build-cost__label">{t('buildRobot', 'cost')}</span>
                {/* Red is no longer a refusal — the order goes on the queue either
                    way. It says the factory will hold at the gate until the bank
                    catches up. */}
                <span className={`build-cost__value ${affordable ? '' : 'build-cost__value--short'}`.trim()}>
                  {cost}
                </span>
              </div>
              <div className="build-cost__stat">
                <span className="build-cost__label">{t('buildRobot', 'available')}</span>
                <span className="build-cost__value">{Math.floor(wallet)}</span>
              </div>
            </div>

            {atCap && <p className="build-warning">{capNote}</p>}
          </div>

          {/* Left to right in the order a player works through them: put this model
              on repeat, or order one of it (back of the queue, then the front), then
              the two ways to undo and leave. Centred as one run rather than split
              across the row — with five of them, an action pinned to a far corner
              reads as unrelated to the rest. */}
          <div className="modal__buttons modal__buttons--wrap">
            <Button onClick={startAutoBuild} disabled={!playerBase}>
              {t('buildRobot', 'startAutoBuild')}
            </Button>
            <Button
              className="btn--primary"
              onClick={() => order(false)}
              disabled={!canOrder}
              title={capNote ?? t('buildRobot', 'queueBackHint')}
            >
              {t('buildRobot', 'queueBack')}
            </Button>
            <Button onClick={() => order(true)} disabled={!canOrder} title={capNote ?? t('buildRobot', 'queueFrontHint')}>
              {t('buildRobot', 'queueFront')}
            </Button>
            <Button onClick={stopAutoBuild} disabled={!autoRunning}>
              {t('buildRobot', 'stopAutoBuild')}
            </Button>
            <Button className="btn--ghost" onClick={onClose}>
              {t('buildRobot', 'close')}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
