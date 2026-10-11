import { describe, expect, it } from 'vitest';
import {
  MAX_CELLS_PER_SECOND,
  MODES,
  STRATA_STANDARD_V1,
  curveLevel,
  gravityCellsPerSecond,
  isMaxGravity,
  levelForLines,
  levelProgress,
  lockDelayMsForLevel,
  secondsPerRow,
  softDropCellsPerSecond,
} from '../../src/engine/index.ts';

/**
 * Level progression lives on the mode, speed on the rules: the engine merges them into a
 * `GravityConfig`, and so does this test.
 */
const gravity = { ...STRATA_STANDARD_V1.gravity, ...MODES.marathon.levels };

/**
 * The community-documented marathon curve: `(0.8 - 0.007 * (level - 1)) ^ (level - 1)` seconds
 * per row. Levels 10 and 15 are cross-checked against the published table's cells-per-frame
 * figures (0.2598 and 2.36 cells per frame at 60 Hz).
 */
describe('gravity curve', () => {
  it('matches the formula for the documented levels', () => {
    const formula = (level: number): number => (0.8 - 0.007 * (level - 1)) ** (level - 1);
    for (const level of [1, 2, 3, 10, 15]) {
      expect(secondsPerRow(level)).toBeCloseTo(formula(level), 10);
    }
    expect(secondsPerRow(1)).toBe(1);
    expect(secondsPerRow(2)).toBeCloseTo(0.793, 10);
  });

  it('agrees with the published cells-per-frame table at levels 10 and 15', () => {
    expect(gravityCellsPerSecond(10, null) / 60).toBeCloseTo(0.2598, 3);
    expect(gravityCellsPerSecond(15, null) / 60).toBeCloseTo(2.36, 2);
  });

  it('speeds up monotonically, flat once clamped at 20G', () => {
    let previous = 0;
    for (let level = 1; level <= 25; level++) {
      const speed = gravityCellsPerSecond(level, null);
      expect(speed).toBeGreaterThanOrEqual(previous);
      if (speed < MAX_CELLS_PER_SECOND) expect(speed).toBeGreaterThan(previous);
      previous = speed;
    }
    expect(previous).toBe(MAX_CELLS_PER_SECOND);
  });

  it('keeps level 1 at one cell per second', () => {
    expect(gravityCellsPerSecond(1, null)).toBeCloseTo(1, 10);
  });

  it('stops accelerating at the configured speed cap without hiding the level', () => {
    expect(curveLevel(20, 15)).toBe(15);
    expect(gravityCellsPerSecond(20, 15)).toBe(gravityCellsPerSecond(15, 15));
    expect(lockDelayMsForLevel(gravity, 20)).toBe(gravity.lockDelayMs);
  });

  it('clamps to 20G when the curve is uncapped', () => {
    expect(gravityCellsPerSecond(20, null)).toBe(MAX_CELLS_PER_SECOND);
    expect(isMaxGravity(20, null)).toBe(true);
    expect(isMaxGravity(15, null)).toBe(false);
  });

  it('treats the default profile as capped at level 15', () => {
    expect(gravity.speedCapLevel).toBe(15);
    expect(isMaxGravity(15, 15)).toBe(false);
    expect(gravityCellsPerSecond(15, null)).toBeLessThan(MAX_CELLS_PER_SECOND);
  });
});

describe('soft drop', () => {
  it('is twenty times gravity with a ten cell per second floor', () => {
    expect(softDropCellsPerSecond(gravity, 1)).toBeCloseTo(20, 6);
    expect(softDropCellsPerSecond(gravity, 10)).toBeCloseTo(gravityCellsPerSecond(10, gravity.speedCapLevel) * 20, 6);
  });

  it('never falls below the floor even when gravity is tiny', () => {
    const slow = { ...gravity, speedCapLevel: 1, softDropMultiplier: 0.1, minSoftDropCellsPerSecond: 10 };
    expect(softDropCellsPerSecond(slow, 1)).toBe(10);
  });

  it('clamps to 20G', () => {
    const fast = { ...gravity, speedCapLevel: null, softDropMultiplier: 100 };
    expect(softDropCellsPerSecond(fast, 20)).toBe(MAX_CELLS_PER_SECOND);
  });
});

describe('lock delay', () => {
  it('is half a second while gravity is below 20G', () => {
    expect(lockDelayMsForLevel(gravity, 1)).toBe(500);
    expect(lockDelayMsForLevel(gravity, 19)).toBe(500);
  });

  it('shrinks once gravity is at 20G, with a floor', () => {
    const uncapped = { ...gravity, speedCapLevel: null };
    expect(lockDelayMsForLevel(uncapped, 20)).toBe(470);
    expect(lockDelayMsForLevel(uncapped, 25)).toBe(320);
    expect(lockDelayMsForLevel(uncapped, 29)).toBe(200);
    expect(lockDelayMsForLevel(uncapped, 40)).toBe(200);
  });
});

describe('level progression', () => {
  it('advances by the configured threshold', () => {
    expect(levelForLines(gravity, 0)).toBe(1);
    expect(levelForLines(gravity, 9)).toBe(1);
    expect(levelForLines(gravity, 10)).toBe(2);
    expect(levelForLines(gravity, 19)).toBe(2);
    expect(levelForLines(gravity, 20)).toBe(3);
    expect(levelForLines(gravity, 99)).toBe(10);
  });

  it('honours a custom starting level and threshold', () => {
    const custom = { ...gravity, startLevel: 5, linesPerLevel: 4 };
    expect(levelForLines(custom, 0)).toBe(5);
    expect(levelForLines(custom, 3)).toBe(5);
    expect(levelForLines(custom, 4)).toBe(6);
  });

  it('stays put when progression is disabled', () => {
    const fixed = { ...gravity, levelProgression: false, startLevel: 1 };
    expect(levelForLines(fixed, 0)).toBe(1);
    expect(levelForLines(fixed, 250)).toBe(1);
    expect(levelProgress(fixed, 250)).toEqual({ intoLevel: 0, needed: 0 });
  });

  it('reports progress inside the current level', () => {
    expect(levelProgress(gravity, 0)).toEqual({ intoLevel: 0, needed: 10 });
    expect(levelProgress(gravity, 12)).toEqual({ intoLevel: 2, needed: 10 });
    expect(levelProgress(gravity, 29)).toEqual({ intoLevel: 9, needed: 10 });
    expect(levelProgress(gravity, 30)).toEqual({ intoLevel: 0, needed: 10 });
  });
});
