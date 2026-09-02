import { gameConfig } from '../../config/gameConfig';
import { useT } from '../../i18n';
import {
  selectDroneReadyNotice,
  selectDroneStatus,
  selectLocalSide,
  selectPlayerBase,
  selectResources,
  selectRobotLoad,
  selectRobots,
} from '../../store/selectors';
import { useGameStore } from '../../store/gameStore';
import { DroneMode } from '../../store/enums';
import { Bar } from '../common/Bar';
import { Button } from '../common/Button';
import { DomeIcon, EyeIcon, FactoryIcon, SelectAllIcon } from '../common/icons';
import { selectAllOwnRobots } from '../hooks/useSelectAllHotkey';
import { BuildRobotModal } from './BuildRobotModal';
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
  const droneReady = useGameStore(selectDroneReadyNotice) > 0;
  const requestShowDrone = useGameStore((s) => s.requestShowDrone);
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
  // The gate is the engine's, projected through the snapshot: a known enemy robot
  // inside the base's own detection radius. The engine does not re-check it when
  // the command lands — pre-casting merely burns the player's single charge.
  const canRaiseShield = !!shield && !shield.spent && shield.threatNear;
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

      {/* The same tiles as the directive grid: the things a player starts from
          this section, one of which (select-all) is otherwise a shortcut they have
          to know about before they can use it. The last two are the dome — dark
          until an enemy is actually at the door, and dark for good once used,
          there is exactly one per match — and the drone view toggle. */}
      <div className="tile-grid">
        <Button className="tile" onClick={() => setBuildOpen(true)} disabled={!playerBase}>
          <FactoryIcon className="tile__icon" size={22} />
          <span>{t('statusPanel', 'buildProgram')}</span>
        </Button>
        <Button className="tile" onClick={selectAllOwnRobots} disabled={myRobotCount === 0}>
          <SelectAllIcon className="tile__icon" size={22} />
          <span>{t('statusPanel', 'selectAll')}</span>
        </Button>
        <Button
          className={`tile ${shieldOn ? 'tile--on' : ''}`.trim()}
          onClick={raiseShield}
          disabled={!canRaiseShield}
        >
          <DomeIcon className="tile__icon" size={22} />
          <span>{shieldLabel}</span>
        </Button>
        <Button
          className={`tile ${droneReady ? 'tile--ready' : ''}`.trim()}
          // Nothing to jump to while it is being rebuilt.
          disabled={droneDown}
          title={t('hud', 'showDroneHint')}
          onClick={requestShowDrone}
        >
          <EyeIcon className="tile__icon" size={22} />
          <span>{t('hud', 'showDrone')}</span>
        </Button>
      </div>

      {buildOpen && <BuildRobotModal onClose={() => setBuildOpen(false)} />}
    </div>
  );
}
