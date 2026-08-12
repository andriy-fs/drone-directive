import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import type { Entity } from '../../engine/ecs/entity';
import { useGameStore } from '../../store/gameStore';
import { getMunitionTexture } from '../assets';
import { ownerColor } from './ownerColor';

/**
 * View for a single-use FPV strike drone in flight. Lives on the `overlay` layer
 * next to the observer drone, for the same two reasons: it flies (so it draws
 * above the fog and above the units it is passing over), and it must never
 * intercept a click meant for a robot underneath — five of these crossing a
 * firefight would otherwise make the ground unselectable for seven seconds.
 *
 * **No health bar, deliberately.** A munition has 8 hp and dies to any single
 * anti-air hit, so a bar could only ever read full — five of them would be five
 * pieces of furniture saying nothing. Its state is binary and the swarm's own
 * size is the readout.
 *
 * Recoloured exactly like `DroneView`: there is one art set for every side, so
 * the local side keeps the authored look and everyone else is tinted by
 * `ownerColor`. An untinted enemy swarm would look like your own arriving to
 * help — the one piece of misinformation this weapon must not produce.
 */
export class MunitionView {
  readonly container: Container;
  private readonly body: Container;

  constructor(munition: Entity) {
    this.container = new Container();
    this.container.label = `fpv:${munition.id}`;
    this.container.eventMode = 'none';

    // undefined = leave the art exactly as authored (this client's own side).
    const tint = munition.owner === useGameStore.getState().localSide ? undefined : ownerColor(munition.owner);

    this.body = new Container();
    const sprite = getMunitionTexture();
    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? gameConfig.munition.hitRadius * 4;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      img.rotation = def.rotationOffset ?? 0;
      if (tint !== undefined) img.tint = tint;
      this.body.addChild(img);
    } else {
      // Placeholder: a dart, not the observer's diamond. The two flyers share the
      // airspace and the tint, so the fallback art has to keep them apart too —
      // this one points where it is going.
      const r = gameConfig.munition.hitRadius;
      const color = tint ?? 0xf87171;
      const g = new Graphics();
      g.poly([r * 1.6, 0, -r, -r * 0.8, -r * 0.5, 0, -r, r * 0.8])
        .fill({ color })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.8 });
      this.body.addChild(g);
    }
    this.container.addChild(this.body);

    this.update(munition, true);
  }

  update(munition: Entity, visible: boolean): void {
    // The overlay layer draws above the fog, so a munition the local side hasn't
    // detected has to be hidden outright — the fog can't cover it.
    this.container.visible = visible;
    if (munition.position) this.container.position.set(munition.position.x, munition.position.y);
    this.body.rotation = munition.heading ?? 0;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
