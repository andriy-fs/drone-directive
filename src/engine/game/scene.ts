/** A game state with lifecycle. The active scene is advanced each fixed tick. */
export interface Scene {
  readonly name: 'menu' | 'game';
  enter(): void;
  update(dt: number): void;
  exit(): void;
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

  get active(): Scene | null {
    return this.current;
  }
}
