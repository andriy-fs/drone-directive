import type { GameSettings } from '../../config/gameSettings';
import type { Command } from '../../types/commands';
import { createEcsWorld, type EcsWorld } from '../ecs/world';
import { createGameContext, type DroneControl, type GameContext } from './context';
import { EventBus, type GameBus } from './eventBus';
import { MenuScene } from './scenes/menuScene';
import { GameScene } from './scenes/gameScene';
import { SceneManager } from './scene';

/**
 * Top-level game core. Owns the persistent ECS world, the event bus, the scene
 * manager, and the UI command queue. The app layer holds a GameEngine and talks
 * through `world`, `bus`, `tick`, `enqueueCommand`, `startMatch`, `toMenu`,
 * `setPaused` — never reaching into scene/system internals.
 */
export class GameEngine {
  readonly world: EcsWorld = createEcsWorld();
  readonly bus: GameBus = new EventBus();

  private readonly manager = new SceneManager();
  private readonly commands: Command[] = [];
  private ctx: GameContext | null = null;
  private paused = false;

  constructor() {
    this.manager.change(new MenuScene(this.world, this.bus));
  }

  /** (Re)start a match with the given player settings. */
  startMatch(settings: GameSettings): void {
    this.commands.length = 0;
    this.ctx = createGameContext(this.world, this.bus, this.commands, settings);
    this.manager.change(new GameScene(this.ctx));
  }

  /** Return to the (empty) title scene. */
  toMenu(): void {
    this.ctx = null;
    this.manager.change(new MenuScene(this.world, this.bus));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Feed the player's observer-drone input for the next step (no-op on the menu). */
  setDroneControl(input: DroneControl): void {
    if (this.ctx) this.ctx.droneControl = input;
  }

  enqueueCommand(command: Command): void {
    this.commands.push(command);
  }

  /** Advances the active scene by one fixed step (unless paused). */
  tick(dt: number): void {
    if (this.paused) return;
    this.manager.update(dt);
  }

  /** Active match context (obstacles/resources/rng), or null on the menu. */
  get context(): GameContext | null {
    return this.ctx;
  }
}
