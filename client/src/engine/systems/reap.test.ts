import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnRobot } from '../ecs/factory';
import { explosions } from '../ecs/queries';
import { reapSystem } from './reap';
import { makeCtx } from './testkit';

/**
 * A base's death is the end of the match, not one more casualty, and the outcome
 * transition holds the live field on it for 1.4 s before anything else happens
 * (`.docs/tasks/outcome-transition.md`). If this blast ever goes back to the
 * default 30 px / 0.5 s the transition is holding on an explosion that finished
 * a second before the veil starts.
 */
describe('reapSystem — a base dies bigger than a robot', () => {
  it('gives a destroyed base the wide, slow blast', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 4);
    base.hp = 0;

    reapSystem(ctx);

    const [boom] = [...explosions(ctx.world)];
    expect(boom.effect.maxRadius).toBe(gameConfig.fx.baseExplosionMaxRadius);
    expect(boom.effect.duration).toBe(gameConfig.fx.baseExplosionDuration);
  });

  it('leaves a destroyed robot on the default poof', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.hp = 0;

    reapSystem(ctx);

    const [boom] = [...explosions(ctx.world)];
    // Undefined rather than the number: `ExplosionView` falls back to the config
    // value, and only the base path passes one explicitly.
    expect(boom.effect.maxRadius).toBeUndefined();
    expect(boom.effect.duration).toBe(gameConfig.fx.explosionDuration);
  });
});
