/** A game state with lifecycle. The active scene is advanced each fixed tick. */
export interface Scene {
  readonly name: 'menu' | 'game';
  enter(): void;
  update(dt: number): void;
  exit(): void;
  /**
   * Apply pending player input *without* advancing the simulation — what a
   * paused tick runs instead of `update`. Optional: only a scene that reads the
   * command queue has anything to do here.
   */
  applyCommands?(): void;
}

/** Runs the current scene and handles transitions (exit old → enter new). */
export class SceneManager {
  private current: Scene | null = null;

  change(next: Scene): void {
    this.current?.exit();
    this.current = next;
    next.enter();
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  applyCommands(): void {
    this.current?.applyCommands?.();
  }

  get active(): Scene | null {
    return this.current;
  }
}
