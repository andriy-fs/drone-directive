import { Owner } from '../types/enums';
import type { GameState } from './gameStore';

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

/** The player's (first) base, or undefined if it has been destroyed. */
export const selectPlayerBase = (s: GameState) => s.bases.find((b) => b.owner === Owner.Player);
