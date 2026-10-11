import { describe, expect, it } from 'vitest';
import {
  PIECE_IDS,
  placementBounds,
  placementCells,
  shapeCells,
  spawnPlacement,
} from '../../src/engine/index.ts';
import type { PieceId, RotationState } from '../../src/engine/index.ts';

const ROTATIONS: readonly RotationState[] = [0, 1, 2, 3];

/** Expected spawn cells, derived from the SRS diagrams in `docs/RULESET.md` §2. */
const SPAWN_CELLS: Readonly<Record<PieceId, readonly [number, number][]>> = {
  I: [[3, 19], [4, 19], [5, 19], [6, 19]],
  J: [[3, 18], [3, 19], [4, 19], [5, 19]],
  L: [[5, 18], [3, 19], [4, 19], [5, 19]],
  O: [[4, 18], [5, 18], [4, 19], [5, 19]],
  S: [[4, 18], [5, 18], [3, 19], [4, 19]],
  T: [[4, 18], [3, 19], [4, 19], [5, 19]],
  Z: [[3, 18], [4, 18], [4, 19], [5, 19]],
};

function sorted<T extends readonly [number, number]>(cells: readonly T[]): string[] {
  return cells.map(([x, y]) => `${x},${y}`).sort();
}

describe('pieces', () => {
  it('defines exactly the seven guideline tetrominoes', () => {
    expect([...PIECE_IDS]).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
  });

  it.each(PIECE_IDS)('%s has four distinct cells in every rotation state', (id) => {
    for (const rotation of ROTATIONS) {
      const cells = shapeCells(id, rotation);
      expect(cells).toHaveLength(4);
      const unique = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
      expect(unique.size).toBe(4);
    }
  });

  it.each(PIECE_IDS)('%s keeps every cell inside its bounding box', (id) => {
    const size = id === 'I' ? 4 : id === 'O' ? 2 : 3;
    for (const rotation of ROTATIONS) {
      for (const cell of shapeCells(id, rotation)) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(size);
        expect(cell.y).toBeLessThan(size);
      }
    }
  });

  it.each(PIECE_IDS)('%s spawns at the documented cells', (id) => {
    const cells = placementCells(spawnPlacement(id));
    expect(sorted(cells.map((cell) => [cell.x, cell.y] as const))).toEqual(sorted(SPAWN_CELLS[id]));
  });

  it.each(PIECE_IDS)('%s spawns entirely inside the two hidden rows above the field', (id) => {
    for (const cell of placementCells(spawnPlacement(id))) {
      expect(cell.y).toBeGreaterThanOrEqual(18);
      expect(cell.y).toBeLessThanOrEqual(19);
    }
  });

  it('centres the spawn columns like the guideline diagrams', () => {
    expect(placementBounds(placementCells(spawnPlacement('I')))).toMatchObject({ minX: 3, maxX: 6 });
    expect(placementBounds(placementCells(spawnPlacement('O')))).toMatchObject({ minX: 4, maxX: 5 });
    for (const id of ['J', 'L', 'S', 'T', 'Z'] as const) {
      expect(placementBounds(placementCells(spawnPlacement(id)))).toMatchObject({ minX: 3, maxX: 5 });
    }
  });

  it('rotates the T piece through the four SRS orientations', () => {
    // Stem up (0), right (1), down (2), left (3).
    expect(sorted(shapeCells('T', 0).map((cell) => [cell.x, cell.y] as const))).toEqual(['0,1', '1,0', '1,1', '2,1']);
    expect(sorted(shapeCells('T', 1).map((cell) => [cell.x, cell.y] as const))).toEqual(['1,0', '1,1', '1,2', '2,1']);
    expect(sorted(shapeCells('T', 2).map((cell) => [cell.x, cell.y] as const))).toEqual(['0,1', '1,1', '1,2', '2,1']);
    expect(sorted(shapeCells('T', 3).map((cell) => [cell.x, cell.y] as const))).toEqual(['0,1', '1,0', '1,1', '1,2']);
  });

  it('keeps the I piece in the expected columns per orientation', () => {
    expect(new Set(shapeCells('I', 0).map((cell) => cell.y))).toEqual(new Set([1]));
    expect(new Set(shapeCells('I', 1).map((cell) => cell.x))).toEqual(new Set([2]));
    expect(new Set(shapeCells('I', 2).map((cell) => cell.y))).toEqual(new Set([2]));
    expect(new Set(shapeCells('I', 3).map((cell) => cell.x))).toEqual(new Set([1]));
  });

  it('treats the O piece as rotation-invariant', () => {
    const base = sorted(shapeCells('O', 0).map((cell) => [cell.x, cell.y] as const));
    for (const rotation of ROTATIONS) {
      expect(sorted(shapeCells('O', rotation).map((cell) => [cell.x, cell.y] as const))).toEqual(base);
    }
  });

  it.each(PIECE_IDS)('%s returns to its starting shape after four rotations', (id) => {
    const start = placementCells({ id, rotation: 0, x: 4, y: 20 });
    let placement = { id, rotation: 0 as RotationState, x: 4, y: 20 };
    for (let i = 0; i < 4; i++) {
      placement = { ...placement, rotation: (((placement.rotation + 1) % 4) as RotationState) };
    }
    expect(sorted(placementCells(placement).map((cell) => [cell.x, cell.y] as const))).toEqual(
      sorted(start.map((cell) => [cell.x, cell.y] as const)),
    );
  });

  it('translates cells by the placement origin', () => {
    const cells = placementCells({ id: 'T', rotation: 0, x: 0, y: 0 });
    expect(sorted(cells.map((cell) => [cell.x, cell.y] as const))).toEqual(['0,1', '1,0', '1,1', '2,1']);
  });

  it('reports the bounds of an arbitrary cell set', () => {
    expect(placementBounds([{ x: 3, y: 4 }, { x: 1, y: 9 }, { x: 5, y: 2 }])).toEqual({
      minX: 1,
      maxX: 5,
      minY: 2,
      maxY: 9,
    });
  });
});
