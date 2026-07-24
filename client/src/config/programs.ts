import { TaskType } from "../types/enums";
import type { Program } from "../types/tasks";

/**
 * Built-in robot behaviour programs — each a priority-ordered directive list
 * ("when → do", evaluated top-down every tick). This is the JSON-describable
 * scenario layer: a preset "Attack Robots" no longer means a single hardcoded
 * behaviour but a small program that prioritises *known* (detected) robots,
 * falls back to a *known* base once none remain, searches the map when nothing
 * is known yet, dodges fire, and returns fire when hit. "Known" is per-team
 * and computed by `systems/vision.ts` — see `targeting.ts`'s `knownEnemyRobots`
 * / `knownEnemyBases`.
 *
 * Extend behaviour by inserting directives; add a program by adding a key. The
 * engine looks a program up by `TaskType` (the id the UI/settings select).
 */
export const programs: Record<TaskType, Program> = {
  [TaskType.Idle]: {
    id: TaskType.Idle,
    label: "Idle",
    directives: [
      // Even while idle, shoot back at whoever hits us (self-defence, no chasing).
      { when: { type: "underFire" }, do: { type: "attackAttacker" } },
      { when: { type: "always" }, do: { type: "idle" } },
    ],
  },

  [TaskType.Guard]: {
    id: TaskType.Guard,
    label: "Guard",
    directives: [
      // Patrol the perimeter of the post, but shoot back at whoever hits us.
      { when: { type: "underFire" }, do: { type: "attackAttacker" } },
      { when: { type: "underFire" }, do: { type: "evade" } },
      { when: { type: "always" }, do: { type: "guard" } },
    ],
  },

  [TaskType.AttackBase]: {
    id: TaskType.AttackBase,
    label: "Attack Base",
    directives: [
      // Under fire: dodge while shooting back...
      { when: { type: "underFire" }, do: { type: "evade" } },
      { when: { type: "underFire" }, do: { type: "attackAttacker" } },
      // ...deal with robots that get in close...
      {
        when: { type: "enemyRobotWithin" },
        do: { type: "attackNearestRobot" },
      },
      // ...the main objective is the enemy base, once its location is known...
      { when: { type: "enemyBasesExist" }, do: { type: "attackNearestBase" } },
      // ...otherwise its location hasn't been discovered yet — go find it.
      { when: { type: "always" }, do: { type: "search" } },
    ],
  },

  [TaskType.AttackRobots]: {
    id: TaskType.AttackRobots,
    label: "Attack Robots",
    directives: [
      // Under fire: dodge and return fire on the attacker.
      { when: { type: "underFire" }, do: { type: "evade" } },
      { when: { type: "underFire" }, do: { type: "attackAttacker" } },
      // Priority: hunt down any enemy robot our team has detected...
      {
        when: { type: "enemyRobotsExist" },
        do: { type: "attackNearestRobot" },
      },
      // ...once none are known, push the enemy base if it's been found...
      { when: { type: "enemyBasesExist" }, do: { type: "attackNearestBase" } },
      // ...otherwise nothing is known yet — go find something.
      { when: { type: "always" }, do: { type: "search" } },
    ],
  },

  [TaskType.Scout]: {
    id: TaskType.Scout,
    label: "Search & Detect",
    directives: [
      // Self-defence: dodge and return fire if attacked while scouting...
      { when: { type: "underFire" }, do: { type: "evade" } },
      { when: { type: "underFire" }, do: { type: "attackAttacker" } },
      // ...engage anything that wanders within weapon range...
      {
        when: { type: "enemyRobotWithin" },
        do: { type: "attackNearestRobot" },
      },
      // ...but the job is to roam and reveal the map, not to hunt.
      { when: { type: "always" }, do: { type: "search" } },
    ],
  },

  [TaskType.AttackTarget]: {
    id: TaskType.AttackTarget,
    label: "Attack Target",
    directives: [
      // Defend itself en route, but the order is to focus one specific target
      // (robot or base) until it's destroyed, then hold.
      { when: { type: "underFire" }, do: { type: "evade" } },
      { when: { type: "underFire" }, do: { type: "attackAttacker" } },
      { when: { type: "always" }, do: { type: "attackTarget" } },
    ],
  },
};

/** The directive program for a task id (falls back to Idle for safety). */
export function getProgram(id: TaskType): Program {
  return programs[id] ?? programs[TaskType.Idle];
}
