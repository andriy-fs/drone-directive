import { describe, expect, it } from 'vitest';
import { ChassisType } from '@drone-directive/types/enums';
import { orderChassis, selectionSoundFor, type SelectionSnapshot } from './selectionSound';

const NOTHING: SelectionSnapshot = { robotIds: [], baseId: null };

const robots = (...ids: string[]): SelectionSnapshot => ({ robotIds: ids, baseId: null });
const base = (id: string): SelectionSnapshot => ({ robotIds: [], baseId: id });

describe('selectionSoundFor', () => {
  it('announces one robot and a squad differently', () => {
    expect(selectionSoundFor(NOTHING, robots('a'))).toBe('single');
    expect(selectionSoundFor(NOTHING, robots('a', 'b'))).toBe('group');
    expect(selectionSoundFor(robots('a'), robots('a', 'b'))).toBe('group');
    expect(selectionSoundFor(robots('a', 'b'), robots('a'))).toBe('single');
  });

  it('stays silent when the same robots are re-selected in any order', () => {
    expect(selectionSoundFor(robots('a'), robots('a'))).toBe('none');
    expect(selectionSoundFor(robots('a', 'b'), robots('b', 'a'))).toBe('none');
  });

  it('stays silent on deselection', () => {
    expect(selectionSoundFor(robots('a', 'b'), NOTHING)).toBe('none');
    expect(selectionSoundFor(base('base-1'), NOTHING)).toBe('none');
    expect(selectionSoundFor(NOTHING, NOTHING)).toBe('none');
  });

  it('acknowledges a base once, not on every click that lands on it', () => {
    expect(selectionSoundFor(NOTHING, base('base-1'))).toBe('base');
    expect(selectionSoundFor(base('base-1'), base('base-1'))).toBe('none');
    expect(selectionSoundFor(base('base-1'), base('base-2'))).toBe('base');
  });

  it('answers the field the selection moved to when both change at once', () => {
    expect(selectionSoundFor(base('base-1'), robots('a'))).toBe('single');
    expect(selectionSoundFor(robots('a'), base('base-1'))).toBe('base');
  });
});

describe('orderChassis', () => {
  it('dedupes and sorts into a fixed order', () => {
    expect(orderChassis([ChassisType.Legs, ChassisType.Tracks, ChassisType.Legs])).toEqual([
      ChassisType.Tracks,
      ChassisType.Legs,
    ]);
    expect(orderChassis([ChassisType.Wheels, ChassisType.Legs, ChassisType.Tracks])).toEqual([
      ChassisType.Tracks,
      ChassisType.Wheels,
      ChassisType.Legs,
    ]);
    expect(orderChassis([])).toEqual([]);
  });
});
