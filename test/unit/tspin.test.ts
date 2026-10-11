import { describe, expect, it } from 'vitest';
import {
  Board,
  MODES,
  STRATA_STANDARD_V1,
  T_CORNERS,
  cornerOccupancy,
  detectSpin,
  placementCells,
} from '../../src/engine/index.ts';
import type { PiecePlacement, SpinKind, Vector } from '../../src/engine/index.ts';

const COLS = STRATA_STANDARD_V1.cols;
const ROWS = STRATA_STANDARD_V1.rows;

function board(): Board {
  return new Board(COLS, ROWS);
}

/**
 * A T-Spin Single slot, from the geometry in `docs/RULESET.md` §9:
 *
 * ```
 * row 37  .....#....   overhang: the T's back corner
 * row 38  ..........   the T bar rests here
 * row 39  ####.#####   floor with the hole the stem drops into
 * ```
 *
 * A T rotated into the slot touches the floor on both front corners and the overhang behind it:
 * three corners, both front => full T-Spin, and the stem fills the hole for a single.
 */
const SPIN_SLOT = ['.....#....', '..........', '####.#####'];

describe('corner occupancy', () => {
  it('reports the four corners around the T in box order', () => {
    expect(T_CORNERS).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ]);
    const b = board();
    b.set(3, 37, 1);
    b.set(5, 39, 1);
    const placement: PiecePlacement = { id: 'T', rotation: 2, x: 3, y: 37 };
    expect(cornerOccupancy(b, placement)).toEqual([true, false, false, true]);
  });

  it('counts the walls, floor and ceiling of the grid as occupied', () => {
    const b = board();
    // One cell past the left wall: both left corners are outside the grid.
    expect(cornerOccupancy(b, { id: 'T', rotation: 0, x: -1, y: 20 })).toEqual([true, false, true, false]);
    // Resting on the floor: both bottom corners are outside the grid.
    expect(cornerOccupancy(b, { id: 'T', rotation: 0, x: 3, y: ROWS - 2 })).toEqual([false, false, true, true]);
  });
});

describe('spin detection', () => {
  const inSlot: PiecePlacement = { id: 'T', rotation: 2, x: 3, y: 37 };

  it('detects a full T-Spin when both front corners are filled', () => {
    const b = board();
    b.loadFromAscii(SPIN_SLOT);
    expect(detectSpin(b, inSlot, { lastAction: 'rotation', lastKick: { x: 0, y: 0 } })).toBe('tspin');
  });

  it('requires the last action to be a rotation', () => {
    const b = board();
    b.loadFromAscii(SPIN_SLOT);
    for (const lastAction of ['spawn', 'move', 'drop', 'gravity'] as const) {
      expect(detectSpin(b, inSlot, { lastAction, lastKick: { x: 0, y: 0 } })).toBe('none');
    }
  });

  it('ignores pieces other than the T', () => {
    const b = board();
    b.loadFromAscii(SPIN_SLOT);
    for (const id of ['I', 'J', 'L', 'O', 'S', 'Z'] as const) {
      expect(detectSpin(b, { ...inSlot, id }, { lastAction: 'rotation', lastKick: { x: 0, y: 0 } })).toBe('none');
    }
  });

  it('requires at least three occupied corners', () => {
    // Remove the right floor corner from the slot: only the overhang and the left floor block
    // remain, so the T is not boxed in by the stack even though it is sitting in a notch.
    const b = board();
    b.loadFromAscii(['.....#....', '..........', '####.#####']);
    b.set(5, 39, 0);
    const occupancy = cornerOccupancy(b, inSlot);
    expect(occupancy.filter(Boolean)).toHaveLength(2);
    expect(detectSpin(b, inSlot, { lastAction: 'rotation', lastKick: { x: 0, y: 0 } })).toBe('none');
  });

  it('classifies three corners with one front corner as a Mini', () => {
    // Right front corner removed from the floor: the T now has one front and one back corner.
    const b = board();
    b.loadFromAscii(['.....#....', '..........', '####.#####']);
    b.set(5, 39, 0);
    b.set(3, 37, 1); // second back corner, so we are at three occupied corners again
    const occupancy = cornerOccupancy(b, inSlot);
    expect(occupancy.filter(Boolean)).toHaveLength(3);
    expect(detectSpin(b, inSlot, { lastAction: 'rotation', lastKick: { x: 0, y: 0 } })).toBe('mini');
  });

  it('promotes a Mini to a full T-Spin after an SRS long kick', () => {
    const b = board();
    b.loadFromAscii(['.....#....', '..........', '####.#####']);
    b.set(5, 39, 0);
    b.set(3, 37, 1);
    const longKick: Vector = { x: 1, y: 2 };
    expect(detectSpin(b, inSlot, { lastAction: 'rotation', lastKick: longKick })).toBe('tspin');
    expect(detectSpin(b, inSlot, { lastAction: 'rotation', lastKick: { x: 1, y: 0 } })).toBe('mini');
  });

  it('accepts all four corners as a full T-Spin', () => {
    const b = board();
    b.loadFromAscii(SPIN_SLOT);
    b.set(3, 37, 1);
    expect(cornerOccupancy(b, inSlot).filter(Boolean)).toHaveLength(4);
    expect(detectSpin(b, inSlot, { lastAction: 'rotation', lastKick: { x: 0, y: 0 } })).toBe('tspin');
  });

  it('agrees with the geometry of the slot it is handed', () => {
    const b = board();
    b.loadFromAscii(SPIN_SLOT);
    // Sanity: the spin position is legal and its cells sit where the diagram says.
    const cells = placementCells(inSlot);
    expect(cells.every((cell) => b.isFree(cell.x, cell.y))).toBe(true);
    expect(cells).toContainEqual({ x: 4, y: 39 });
  });
});

describe('spin kinds stay in sync with the ruleset tables', () => {
  it('lists every spin kind the scoring and attack tables know', () => {
    const kinds: SpinKind[] = ['none', 'mini', 'tspin'];
    for (const kind of kinds) {
      const hasScore =
        kind === 'none' ||
        STRATA_STANDARD_V1.scoring.base[`${kind === 'tspin' ? 'spin' : 'miniSpin'}NoLines` as 'spinNoLines'];
      expect(hasScore).toBeTruthy();
    }
  });

  it('is the mode used by the versus profile', () => {
    expect(MODES.versus.allowAttacks).toBe(true);
    expect(MODES.marathon.allowAttacks).toBe(false);
  });
});
