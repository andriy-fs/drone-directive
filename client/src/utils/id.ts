let counter = 0;

/** Monotonic, human-readable unique id, e.g. `base_1`, `robot_7`. */
export function nextId(prefix = 'e'): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

/**
 * Reset the id counter so the next match assigns ids from scratch. Called at match
 * start (after the world is cleared). Required for lockstep networking: both peers
 * must generate identical ids in identical order, which fails if one client's
 * counter is already advanced from an earlier match. Safe because a match always
 * begins from an empty world.
 */
export function resetIds(): void {
  counter = 0;
}
