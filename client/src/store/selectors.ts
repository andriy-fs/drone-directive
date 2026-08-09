import { OnlineLink, OnlineStatus } from './enums';
import type { GameState } from './types';

/**
 * Narrowed selectors so components subscribe to the smallest slice they need
 * (zustand re-renders a component only when its selected value changes). Prefer
 * these over inline `(s) => s.x` for shared slices.
 */
export const selectStatus = (s: GameState) => s.status;
export const selectBases = (s: GameState) => s.bases;
export const selectRobots = (s: GameState) => s.robots;
export const selectResources = (s: GameState) => s.resources;
export const selectSelectedIds = (s: GameState) => s.selectedRobotIds;
/** The selected base, or null — mutually exclusive with the robot selection. */
export const selectSelectedBaseId = (s: GameState) => s.selectedBaseId;
/** Local side's observer drone: health while it flies, rebuild progress once it's down. */
export const selectDroneStatus = (s: GameState) => s.droneStatus;
/** Which side this client plays (Player offline/host, AI for the online guest). */
export const selectLocalSide = (s: GameState) => s.localSide;
export const selectOnline = (s: GameState) => s.online;
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

/** The local side's (first) base, or undefined if it has been destroyed. */
export const selectPlayerBase = (s: GameState) => s.bases.find((b) => b.owner === s.localSide);
