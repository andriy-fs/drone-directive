import { useState } from 'react';
import { gameConfig } from '../../config/gameConfig';
import { useT } from '../../i18n';
import {
  selectDroneStatus,
  selectLocalSide,
  selectPlayerBase,
  selectResources,
  selectRobotLoad,
  selectRobots,
  selectSelectedBaseId,
  selectSelectedIds,
} from '../../store/selectors';
import { useGameStore } from '../../store/gameStore';
import { commandableRobots } from '../../store/selection';
import { DroneMode } from '../../store/enums';
import { Bar } from '../common/Bar';
import { Button } from '../common/Button';
import { DomeIcon, FactoryIcon, FormationIcon, SelectAllIcon } from '../common/icons';
import { BuildRobotModal } from './BuildRobotModal';
import { FormationModal } from './FormationModal';
import { SelectionModal } from './SelectionModal';
import { programLabel } from './programOptions';

/**
 * Everything the local side has and can spend: its bank, its base, its army's
 * size, what the base is currently building, and the actions that start from here. The base and unit tallies used to be sections of their own listing every
 * side in the match — with the opponents' rows gone they were one number each,
 * and belong next to the resources they compete for.
 *
 * Deliberately says nothing about anyone else: an opponent's bank is intelligence
 * the map never gives up, and reading it off the HUD — against an AI or against a
 * person online — would be reading their hand.
 */
export function StatusPanel() {
  const t = useT();
  const resources = useGameStore(selectResources);
  const localSide = useGameStore(selectLocalSide);
  const playerBase = useGameStore(selectPlayerBase);
  const robots = useGameStore(selectRobots);
  const drone = useGameStore(selectDroneStatus);
  // The three selection slots are mutually exclusive in the store, so "something
  // is selected" is the union of all of them — a base and the drone count too, not
  // only an army.
  const selectedRobotIds = useGameStore(selectSelectedIds);
  const selectedBaseId = useGameStore(selectSelectedBaseId);
  const selectedDroneId = useGameStore((s) => s.selectedDroneId);
  const hasSelection = selectedRobotIds.length > 0 || selectedBaseId !== null || selectedDroneId !== null;
  // Local state, unlike the build dialog's: nothing on the canvas opens this one,
  // so it has no second entry point to keep in step.
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [formationOpen, setFormationOpen] = useState(false);
  // The same answer the Directive card gets, from the same helper: a shape can
  // only be given to units that are actually in hand.
  const commandable = commandableRobots(robots, selectedRobotIds, localSide, selectedBaseId);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  // Dialog visibility lives in the store so a double-click on the base (canvas
  // side) opens the very same dialog as this panel's button.
  const buildOpen = useGameStore((s) => s.buildDialogOpen);
  const setBuildOpen = useGameStore((s) => s.setBuildDialogOpen);

  const myRobotCount = robots.filter((r) => r.owner === localSide).length;
  const queueLength = playerBase?.queue.length ?? 0;
  // A queue that cannot pay for its next machine sits at zero progress. Saying so
  // is the difference between "the game has stopped" and "you are short".
  const waiting = playerBase?.waitingForResources ?? false;
  // Read as `7/12`, like the base's HP row above it — the cap is invisible
  // otherwise, and a factory that has quietly stopped looks like a bug.
  //
  // The tally is living units, but the *cap* counts what is queued too (see
  // `sideRobotLoad`), so the colour is driven by the load and not by the number
  // on screen: at 10 built + 2 queued the row reads `10/12` and is already red,
  // which is exactly the state the player needs explained.
  const maxRobots = gameConfig.production.maxRobots;
  const robotLoad = useGameStore(selectRobotLoad);
  let capClass = '';
  if (robotLoad >= maxRobots) capClass = 'hud__row-value--cap';
  else if (robotLoad >= maxRobots - 1) capClass = 'hud__row-value--near-cap';
  const auto = playerBase?.autoBuild ?? null;
  const stopAuto = () => {
    if (playerBase) enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: null });
  };

  const shield = playerBase?.shield;
  const shieldOn = shield?.active ?? false;
  // The one condition that is real: the charge. `spent` is set the moment the dome
  // goes up, so this also covers the dome currently standing.
  //
  // It used to additionally require a known enemy inside the base's sight
  // (`shield.threatNear`), which is why the tile spent most of a match dark for a
  // reason nothing on screen explained — and a control that is dead without saying
  // why is the worse failure. Pre-casting is the player's own mistake to make, and
  // the engine has always taken that view: `applyCommand` gates on the charge alone
  // and lets an early press through, because silently swallowing a panic-button
  // press is indistinguishable from the game having frozen
  // (see `engine/systems/shield.ts`, `canActivateShield`).
  const canRaiseShield = !!shield && !shield.spent;
  const raiseShield = () => {
    if (playerBase) enqueueCommand({ kind: 'ActivateShield', baseId: playerBase.id });
  };
  // "Show me my drone" sits with the shield rather than in a section of its own:
  // it is one of the things the player *does* from here, and the drone's own
  // readout was the same subject reported twice.
  //
  // A one-shot jump, not a view mode. The camera follows nothing, so a
  // replacement rolling out over the base cannot haul the player off the fight
  // they were watching — the tile just nags until they go and collect it.
  const droneDown = drone.mode === DroneMode.Down;

  let shieldLabel = t('statusPanel', 'shield');
  if (shieldOn) shieldLabel = t('statusPanel', 'shieldUp');
  else if (shield?.spent) shieldLabel = t('statusPanel', 'shieldSpent');

  return (
    <div className="status-panel">
      <div className="hud__row">
        <span className="hud__row-label">{t('statusPanel', 'resources')}</span>
        <span className="hud__row-value">{Math.floor(resources[localSide] ?? 0)}</span>
      </div>

      <div className="hud__row">
        <span className="hud__row-label">{t('programming', 'baseSelected')}</span>
        <span className="hud__row-value">
          {playerBase ? `${Math.ceil(playerBase.hp)}/${playerBase.maxHp}` : '—'}
        </span>
      </div>

      <div className="hud__row">
        <span className="hud__row-label">{t('hud', 'units')}</span>
        <span className={`hud__row-value ${capClass}`.trim()}>
          {myRobotCount}/{maxRobots}
        </span>
      </div>

      <div className={`build-progress ${!queueLength ? 'build-progress--idle' : ''}`.trim()}>
        <span className="hud__muted">
          {queueLength === 0
            ? t('statusPanel', 'idle')
            : waiting
              ? `${t('statusPanel', 'waiting')} · ${queueLength} ${t('statusPanel', 'queued')}`
              : `${t('statusPanel', 'building')} · ${queueLength} ${t('statusPanel', 'queued')}`}
        </span>
        <Bar value={playerBase?.buildProgress ?? 0} />
      </div>

      {auto && (
        <div className="auto-build">
          <span className="hud__muted">
            {t('statusPanel', 'auto')}: {t('chassis', auto.chassis)}/{t('weapons', auto.weapon)}
            {auto.task !== undefined ? ` · ${programLabel(auto.task, t)}` : ''}
          </span>
          <Button className="auto-build__stop" onClick={stopAuto}>
            {t('statusPanel', 'stop')}
          </Button>
        </div>
      )}

      {/* Strength on the bar, seconds on the label: while the dome stands both
          are what the player is deciding against, and neither alone is enough. */}
      {shieldOn && shield && (
        <div className="shield-status">
          <span className="hud__muted">
            {t('statusPanel', 'shieldUp')} · {Math.ceil(shield.secondsLeft)}s
          </span>
          <Bar value={shield.hp / shield.maxHp} />
        </div>
      )}

      {/* The same tiles as the directive grid: the things a player starts from this
          section. Three of them now, because everything about picking units — all,
          none, by weapon, and the observer drone — went behind the Selection tile's
          dialog rather than spreading across the rail. The dome is the third, and it
          is live from the first second: the only thing that ever greys it out is the
          charge being gone, because there is exactly one per match and its tooltip
          says so. */}
      <div className="tile-grid">
        <Button className="tile" onClick={() => setBuildOpen(true)} disabled={!playerBase}>
          <FactoryIcon className="tile__icon" size={22} />
          <span>{t('statusPanel', 'buildProgram')}</span>
        </Button>
        <Button
          className="tile"
          // Dead only when it could do nothing at all: no army to pick from,
          // nothing picked to drop, and no drone to go to.
          disabled={myRobotCount === 0 && !hasSelection && droneDown}
          onClick={() => setSelectionOpen(true)}
        >
          <SelectAllIcon className="tile__icon" size={22} />
          <span>{t('statusPanel', 'selection')}</span>
        </Button>
        <Button
          className={`tile ${shieldOn ? 'tile--on' : ''}`.trim()}
          onClick={raiseShield}
          disabled={!canRaiseShield}
          title={t('statusPanel', 'shieldHint')}
        >
          <DomeIcon className="tile__icon" size={22} />
          <span>{shieldLabel}</span>
        </Button>
        <Button
          className="tile"
          // Nothing selected, nothing to put in a shape.
          disabled={commandable.length === 0}
          onClick={() => setFormationOpen(true)}
        >
          <FormationIcon className="tile__icon" size={22} />
          <span>{t('programming', 'formationHeading')}</span>
        </Button>
      </div>

      {buildOpen && <BuildRobotModal onClose={() => setBuildOpen(false)} />}
      {selectionOpen && <SelectionModal onClose={() => setSelectionOpen(false)} />}
      {formationOpen && <FormationModal onClose={() => setFormationOpen(false)} />}
    </div>
  );
}
