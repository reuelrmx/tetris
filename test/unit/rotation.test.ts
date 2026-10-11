import { describe, expect, it } from 'vitest';
import {
  Board,
  CELL_BLOCK,
  PIECE_IDS,
  isLongKick,
  kickOffsets,
  nextRotation,
  placementCells,
  resolveRotation,
  shapeCells,
  STRATA_STANDARD_V1,
} from '../../src/engine/index.ts';
import type { PiecePlacement, RotationState, Vector } from '../../src/engine/index.ts';

const COLS = STRATA_STANDARD_V1.cols;
const ROWS = STRATA_STANDARD_V1.rows;

function board(): Board {
  return new Board(COLS, ROWS);
}

/** The published SRS tables are written with +y up; grid space has +y down. */
function gridSpace(published: readonly Vector[]): Vector[] {
  const flip = (value: number): number => (value === 0 ? 0 : -value);
  return published.map((offset) => ({ x: offset.x === 0 ? 0 : offset.x, y: flip(offset.y) }));
}

describe('rotation', () => {
  it('keeps the seven tetrominoes four cells big through every rotation', () => {
    for (const id of PIECE_IDS) {
      for (const rotation of [0, 1, 2, 3] as RotationState[]) {
        expect(shapeCells(id, rotation)).toHaveLength(4);
      }
    }
  });

  describe('published SRS kick tables (converted to grid space)', () => {
    it('JLSTZ 0>R matches the guideline five-test order', () => {
      expect(kickOffsets('T', 0, 1)).toEqual(gridSpace([
        { x: 0, y: 0 },
        { x: -1, y: 0 },
        { x: -1, y: 1 },
        { x: 0, y: -2 },
        { x: -1, y: -2 },
      ]));
    });

    it('JLSTZ R>0 mirrors it', () => {
      expect(kickOffsets('J', 1, 0)).toEqual(gridSpace([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: -1 },
        { x: 0, y: 2 },
        { x: 1, y: 2 },
      ]));
    });

    it('JLSTZ R>2 and 2>R use the vertical pair', () => {
      expect(kickOffsets('L', 1, 2)).toEqual(gridSpace([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: -1 },
        { x: 0, y: 2 },
        { x: 1, y: 2 },
      ]));
      expect(kickOffsets('S', 2, 1)).toEqual(gridSpace([
        { x: 0, y: 0 },
        { x: -1, y: 0 },
        { x: -1, y: 1 },
        { x: 0, y: -2 },
        { x: -1, y: -2 },
      ]));
    });

    it('I 0>R uses the I table, not the JLSTZ one', () => {
      expect(kickOffsets('I', 0, 1)).toEqual(gridSpace([
        { x: 0, y: 0 },
        { x: -2, y: 0 },
        { x: 1, y: 0 },
        { x: -2, y: -1 },
        { x: 1, y: 2 },
      ]));
    });

    it('I 1>0 mirrors the horizontal pair', () => {
      expect(kickOffsets('I', 1, 0)).toEqual(gridSpace([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: -1, y: 0 },
        { x: 2, y: 1 },
        { x: -1, y: -2 },
      ]));
    });

    it('O never moves', () => {
      for (const from of [0, 1, 2, 3] as RotationState[]) {
        expect(kickOffsets('O', from, nextRotation(from, 1))).toEqual([{ x: 0, y: 0 }]);
      }
    });

    it('normalises -0 so kick vectors compare cleanly', () => {
      for (const id of PIECE_IDS) {
        for (const from of [0, 1, 2, 3] as RotationState[]) {
          for (const kick of kickOffsets(id, from, nextRotation(from, 1))) {
            expect(Object.is(kick.x, -0)).toBe(false);
            expect(Object.is(kick.y, -0)).toBe(false);
          }
        }
      }
    });
  });

  describe('resolveRotation', () => {
    it('rotates in place on an empty board', () => {
      const b = board();
      const result = resolveRotation({ id: 'T', rotation: 0, x: 3, y: 20 }, 1, (x, y) => b.isFree(x, y));
      expect(result).not.toBeNull();
      expect(result?.kick).toEqual({ x: 0, y: 0 });
      expect(result?.placement).toEqual({ id: 'T', rotation: 1, x: 3, y: 20 });
    });

    it('kicks up and left off the floor', () => {
      // Stem right: the T needs a row below its box, which the floor forbids, so the third test
      // ((-1, -1) in grid space) rescues the rotation.
      const b = board();
      const placement: PiecePlacement = { id: 'T', rotation: 0, x: 3, y: ROWS - 2 };
      const result = resolveRotation(placement, 1, (x, y) => b.isFree(x, y));
      expect(result?.kick).toEqual({ x: -1, y: -1 });
      expect(result?.placement).toEqual({ id: 'T', rotation: 1, x: 2, y: ROWS - 3 });
    });

    it('kicks the I piece back inside the right wall', () => {
      const b = board();
      const placement: PiecePlacement = { id: 'I', rotation: 1, x: 7, y: 10 };
      // State 2 wants columns 7..10; the second test pulls the piece one cell to the left.
      const result = resolveRotation(placement, 1, (x, y) => b.isFree(x, y));
      expect(result?.kick).toEqual({ x: -1, y: 0 });
      expect(result?.placement).toEqual({ id: 'I', rotation: 2, x: 6, y: 10 });
    });

    it('returns null when every kick test collides', () => {
      // Everything is filled except the cells the T currently occupies: no rotation can fit.
      const b = board();
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) b.set(x, y, CELL_BLOCK);
      const placement: PiecePlacement = { id: 'T', rotation: 0, x: 3, y: 20 };
      for (const cell of placementCells(placement)) b.set(cell.x, cell.y, 0);
      expect(resolveRotation(placement, 1, (x, y) => b.isFree(x, y))).toBeNull();
      expect(resolveRotation(placement, -1, (x, y) => b.isFree(x, y))).toBeNull();
    });

    it('cannot rotate a vertical I inside a one-wide well', () => {
      const b = board();
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) if (x !== 4) b.set(x, y, CELL_BLOCK);
      }
      const placement: PiecePlacement = { id: 'I', rotation: 1, x: 2, y: 20 };
      for (const cell of placementCells(placement)) b.set(cell.x, cell.y, 0);
      expect(resolveRotation(placement, 1, (x, y) => b.isFree(x, y))).toBeNull();
    });

    it('rotates through four states and returns to the start', () => {
      const b = board();
      let placement: PiecePlacement = { id: 'L', rotation: 0, x: 4, y: 20 };
      for (let i = 0; i < 4; i++) {
        const result = resolveRotation(placement, 1, (x, y) => b.isFree(x, y));
        expect(result).not.toBeNull();
        placement = result?.placement as PiecePlacement;
      }
      expect(placement).toEqual({ id: 'L', rotation: 0, x: 4, y: 20 });
    });

    it('supports counter-clockwise rotation', () => {
      const b = board();
      const result = resolveRotation({ id: 'T', rotation: 0, x: 4, y: 20 }, -1, (x, y) => b.isFree(x, y));
      expect(result?.placement.rotation).toBe(3);
      expect(result?.kick).toEqual({ x: 0, y: 0 });
    });
  });

  it('wraps rotation states in both directions', () => {
    expect(nextRotation(3, 1)).toBe(0);
    expect(nextRotation(0, -1)).toBe(3);
    expect(nextRotation(1, 1)).toBe(2);
    expect(nextRotation(2, -1)).toBe(1);
  });

  it('recognises SRS long kicks', () => {
    expect(isLongKick({ x: 1, y: 2 })).toBe(true);
    expect(isLongKick({ x: -2, y: 1 })).toBe(true);
    expect(isLongKick({ x: 1, y: 1 })).toBe(false);
    expect(isLongKick({ x: 0, y: 0 })).toBe(false);
    expect(isLongKick({ x: 2, y: 0 })).toBe(false);
  });
});
