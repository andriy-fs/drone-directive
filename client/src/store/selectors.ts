import { OnlineLink, OnlineStatus } from './enums';
import type { GameState } from './types';

/**
 * Narrowed selectors so components subscribe to the smallest slice they need
 * (zustand re-renders a component only when its selected value changes). Prefer
 * these over inline `(s) => s.x` for shared slices.
 */
export const selectStatus = (s: GameState) => s.status;
export const selectOutcomePhase = (s: GameState) => s.outcomePhase;
export const selectBases = (s: GameState) => s.bases;
export const selectRobots = (s: GameState) => s.robots;
export const selectResources = (s: GameState) => s.resources;
export const selectSelectedIds = (s: GameState) => s.selectedRobotIds;
/** The selected base, or null — mutually exclusive with the robot selection. */
export const selectSelectedBaseId = (s: GameState) => s.selectedBaseId;
/** Local side's observer drone: health while it flies, rebuild progress once it's down. */
export const selectDroneStatus = (s: GameState) => s.droneStatus;
/** Whether the viewport rides the drone (client-local — it never reaches the engine). */
export const selectViewSync = (s: GameState) => s.viewSyncedToDrone;
/** The current "replacement drone is up" notice, or 0 if there is none. */
export const selectDroneReadyNotice = (s: GameState) => s.droneReadyNotice;
/** Which side this client plays (Player offline/host, AI for the online guest). */
export const selectLocalSide = (s: GameState) => s.localSide;
export const selectOnline = (s: GameState) => s.online;
/** How stale this bundle is — drives the update notice and the online block. */
export const selectClientVersion = (s: GameState) => s.clientVersion;
/**
 * Transport health, flattened to a value every caller can read without first
 * proving there is a match. Outside one it is `ok` — no session is not the same
 * thing as a broken one, and the HUD's "the world is frozen" checks all key off
 * `!== 'ok'`, so this keeps them from having to spell out both halves.
 */
export const selectOnlineLink = (s: GameState) =>
  s.online.status === OnlineStatus.InMatch ? s.online.link : OnlineLink.Ok;
/** Chat with the online opponent — event-driven, and it outlives the match. */
export const selectChat = (s: GameState) => s.chat;
export const selectChatMessages = (s: GameState) => s.chat.messages;
/** True once there is a conversation to open, in a match or long after one. */
export const selectHasChat = (s: GameState) => s.chat.chatId !== null;
/** The radio feed over the scene, oldest first. */
export const selectRadio = (s: GameState) => s.radio;

/** The local side's (first) base, or undefined if it has been destroyed. */
export const selectPlayerBase = (s: GameState) => s.bases.find((b) => b.owner === s.localSide);

/**
 * What the local side has committed against the per-side robot cap: living units
 * plus everything its base still has queued.
 *
 * The same sum the engine's `sideRobotLoad` computes, from the HUD's side of the
 * bridge — and the number the cap is actually judged on, which is why the units
 * row can read `10/12` and already be red. Shared because two places need it: the
 * status panel colours a row with it, and the build dialog refuses an order with
 * it. Since the wallet no longer gates a build, this is the only thing that does.
 */
export const selectRobotLoad = (s: GameState) => {
  const base = selectPlayerBase(s);
  return s.robots.filter((r) => r.owner === s.localSide).length + (base?.queue.length ?? 0);
};
