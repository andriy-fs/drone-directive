/**
 * What the store holds before anything has happened: a fresh title screen, no
 * match, no session, an empty log.
 *
 * Four of these fields are not constants at all — `settings`, `locale` and
 * `theme` are read back from the player's browser, and `chat.soundOn` with them —
 * which is why this is a module-level object built once at import rather than a literal
 * inlined into `create()`: the reads happen when the store is first pulled in,
 * before React has rendered anything that depends on them.
 *
 * Annotated with `GameStateFields`, so a field added to the store but forgotten
 * here is an error pointing at *this* object, and every value is checked against
 * the type it is supposed to have rather than whatever TypeScript would have
 * inferred from the literal.
 */
import { loadChatSound } from '../chat/chatStorage';
import { gameConfig } from '../config/gameConfig';
import { createDefaultSettings } from '../config/gameSettings';
import { resolveInitialLocale } from '../i18n/locale';
import { resolveInitialTheme } from '../theme/theme';
import type { ResourcePool } from '@drone-directive/types/entities';
import { Owner } from '@drone-directive/types/enums';
import { ClientVersion, DroneMode, GameStatus, OnlineStatus, OutcomePhase } from './enums';
import type { GameStateFields } from './types';

export const initialState: GameStateFields = {
  status: GameStatus.Menu,
  outcomePhase: OutcomePhase.None,
  matchBrief: null,
  bases: [],
  robots: [],
  sides: [],
  // Every side starts with the same purse, including the ones no match has seated
  // yet — the pool is keyed by `Owner`, so it has to be total.
  resources: Object.fromEntries(
    Object.values(Owner).map((owner) => [owner, gameConfig.economy.startingResources]),
  ) as ResourcePool,
  selectedRobotIds: [],
  selectedBaseId: null,
  selectedDroneId: null,
  commands: [],
  restartRequested: false,
  menuRequested: false,
  paused: false,
  pauseTogglePending: false,
  stickInput: { x: 0, y: 0 },
  dronePossessRequested: false,
  droneFireRequested: false,
  overrideRequested: null,
  droneStatus: {
    mode: DroneMode.Flying,
    // No world yet: the bridge fills this in on its first snapshot.
    id: null,
    possessedRobotId: null,
    hp: gameConfig.drone.maxHp,
    maxHp: gameConfig.drone.maxHp,
    respawnProgress: 0,
    // Nothing is being ridden yet, so there is no menu to describe.
    overrides: { available: [], running: null },
  },
  showDroneRequested: false,
  droneReadyNotice: 0,
  buildDialogOpen: false,
  settings: createDefaultSettings(),
  locale: resolveInitialLocale(),
  clientVersion: ClientVersion.Current,
  theme: resolveInitialTheme(),
  localSide: Owner.Player,
  online: { status: OnlineStatus.Offline },
  pendingOnline: null,
  chat: {
    open: false,
    chatId: null,
    seat: null,
    roomCode: null,
    connected: false,
    peerOnline: false,
    messages: [],
    unread: 0,
    soundOn: loadChatSound(),
    error: null,
  },
  radio: [],
};
