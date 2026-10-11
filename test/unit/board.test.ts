import { describe, expect, it } from 'vitest';
import { Board, CELL_BLOCK, CELL_GARBAGE, STRATA_STANDARD_V1 } from '../../src/engine/index.ts';

const COLS = STRATA_STANDARD_V1.cols;
const ROWS = STRATA_STANDARD_V1.rows;

function board(): Board {
  return new Board(COLS, ROWS);
}

function fillRow(target: Board, y: number, code = 1): void {
  for (let x = 0; x < COLS; x++) target.set(x, y, code);
}

describe('board', () => {
  it('starts empty', () => {
    const b = board();
    expect(b.isEmpty()).toBe(true);
    expect(b.countBlocks()).toBe(0);
    expect(b.stackHeight()).toBe(0);
    expect(b.findFullRows()).toEqual([]);
  });

  it('reports cells inside the grid as free and outside as blocked', () => {
    const b = board();
    expect(b.isFree(0, 0)).toBe(true);
    expect(b.isFree(COLS - 1, ROWS - 1)).toBe(true);
    expect(b.isFree(-1, 10)).toBe(false);
    expect(b.isFree(COLS, 10)).toBe(false);
    expect(b.isFree(0, -1)).toBe(false);
    expect(b.isFree(0, ROWS)).toBe(false);
  });

  it('ignores out-of-bounds writes', () => {
    const b = board();
    b.set(-1, 5, 1);
    b.set(COLS, 5, 1);
    b.set(5, -1, 1);
    b.set(5, ROWS, 1);
    expect(b.countBlocks()).toBe(0);
  });

  it('detects collisions against the walls, the ceiling and the floor', () => {
    const b = board();
    expect(b.collides([{ x: -1, y: 0 }])).toBe(true);
    expect(b.collides([{ x: COLS, y: 39 }])).toBe(true);
    expect(b.collides([{ x: 4, y: -1 }])).toBe(true);
    expect(b.collides([{ x: 4, y: ROWS - 1 }])).toBe(false);
    expect(b.collides([{ x: 4, y: ROWS }])).toBe(true);
  });

  it('locks cells and finds full rows', () => {
    const b = board();
    fillRow(b, ROWS - 1);
    b.set(3, ROWS - 2, 2);
    expect(b.findFullRows()).toEqual([ROWS - 1]);
    expect(b.countBlocks()).toBe(COLS + 1);
    expect(b.stackHeight()).toBe(2);
  });

  it('compacts everything above a cleared row downward', () => {
    const b = board();
    fillRow(b, ROWS - 1);
    b.set(0, ROWS - 2, 1);
    b.set(9, ROWS - 3, 1);
    b.clearRows([ROWS - 1]);
    expect(b.toAscii(3)).toEqual(['..........', '.........I', 'I.........']);
    expect(b.findFullRows()).toEqual([]);
  });

  it('compacts correctly when several rows clear at once', () => {
    const b = board();
    b.set(2, ROWS - 4, 1);
    fillRow(b, ROWS - 2);
    fillRow(b, ROWS - 1);
    b.clearRows([ROWS - 2, ROWS - 1]);
    expect(b.toAscii(3)).toEqual(['..........', '..I.......', '..........']);
  });

  it('handles a quad clear that empties the stack', () => {
    const b = board();
    for (const y of [ROWS - 4, ROWS - 3, ROWS - 2, ROWS - 1]) fillRow(b, y);
    b.clearRows([ROWS - 4, ROWS - 3, ROWS - 2, ROWS - 1]);
    expect(b.isEmpty()).toBe(true);
  });

  it('copies the visible field out in row-major order', () => {
    const b = board();
    b.set(1, ROWS - 1, 2);
    const target = new Uint8Array(COLS * 2);
    b.copyVisibleInto(target, ROWS - 2);
    expect(target[COLS + 1]).toBe(2);
    expect(target[0]).toBe(0);
  });

  it('refuses to copy into a buffer that is too small', () => {
    const b = board();
    expect(() => b.copyVisibleInto(new Uint8Array(3), ROWS - 2)).toThrow(RangeError);
  });

  it('clones independently', () => {
    const b = board();
    b.set(1, ROWS - 1, 3);
    const copy = b.clone();
    copy.set(2, ROWS - 1, 4);
    expect(b.get(2, ROWS - 1)).toBe(0);
    expect(copy.get(1, ROWS - 1)).toBe(3);
  });

  describe('ASCII tooling', () => {
    it('anchors maps to the bottom of the grid and round-trips every symbol', () => {
      const b = board();
      b.loadFromAscii(['#Z.', 'GG#']);
      expect(b.toAscii(2)).toEqual(['#Z........', 'GG#.......']);
      expect(b.get(0, ROWS - 2)).toBe(CELL_BLOCK);
      expect(b.get(0, ROWS - 1)).toBe(CELL_GARBAGE);
      expect(b.get(2, ROWS - 1)).toBe(CELL_BLOCK);
      expect(b.get(3, ROWS - 1)).toBe(0);
    });

    it('left-aligns short rows and ignores spaces', () => {
      const b = board();
      b.loadFromAscii(['T', 'X ']);
      // Short rows are never padded to the right, and the trailing space is ignored.
      expect(b.toAscii(2)).toEqual(['T.........', '#.........']);
      // 'T' is cell code 6: codes follow the I J L O S T Z order of `cellCodeForPiece`.
      expect(b.get(0, ROWS - 2)).toBe(6);
      expect(b.get(0, ROWS - 1)).toBe(CELL_BLOCK);
    });

    it('rejects unknown characters so typos fail loudly', () => {
      const b = board();
      expect(() => b.loadFromAscii(['Q..'])).toThrow(/unsupported character/);
    });
  });

  describe('garbage insertion', () => {
    it('inserts rows at the bottom with a single hole', () => {
      const b = board();
      expect(b.insertGarbage(2, 6)).toEqual({ ok: true, overflow: false });
      expect(b.toAscii(3)).toEqual(['..........', 'GGGGGG.GGG', 'GGGGGG.GGG']);
      expect(b.get(5, ROWS - 1)).toBe(CELL_GARBAGE);
    });

    it('pushes the existing stack up', () => {
      const b = board();
      b.set(0, ROWS - 1, 1);
      b.insertGarbage(1, 4);
      expect(b.toAscii(2)).toEqual(['I.........', 'GGGG.GGGGG']);
    });

    it('reports overflow instead of mutating when blocks would leave the grid', () => {
      const b = board();
      b.set(9, 0, 1);
      expect(b.insertGarbage(1, 0)).toEqual({ ok: false, overflow: true });
      // The board is untouched: the block is still in hidden row 0, so the visible row is empty.
      expect(b.get(9, 0)).toBe(1);
    });

    it('is a no-op for a count of zero', () => {
      const b = board();
      expect(b.insertGarbage(0, 3)).toEqual({ ok: true, overflow: false });
      expect(b.isEmpty()).toBe(true);
    });
  });
});
