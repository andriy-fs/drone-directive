let counter = 0;

/** Monotonic, human-readable unique id, e.g. `base_1`, `robot_7`. */
export function nextId(prefix = 'e'): string {
  counter += 1;
  return `${prefix}_${counter}`;
}
