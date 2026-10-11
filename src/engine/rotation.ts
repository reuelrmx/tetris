import { shapeCells } from './pieces.ts';
import type { PieceId, PiecePlacement, RotationState, Vector } from './types.ts';

/**
 * SRS wall kicks.
 *
 * The tables are transcribed exactly as published (offsets are `(dx, dy)` with **+y up**),
 * and converted to grid space (`+y` down) in `kickOffsets`. Test order matters: the first
 * non-colliding offset wins, and test 1 is always the plain rotation.
 */

export type RotationTransition =
  | '0>1'
  | '1>0'
  | '1>2'
  | '2>1'
  | '2>3'
  | '3>2'
  | '3>0'
  | '0>3';

/** J, L, S, T, Z share this table. */
export const JLSTZ_KICKS: Readonly<Record<RotationTransition, readonly Vector[]>> = {
  '0>1': [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -2 },
    { x: -1, y: -2 },
  ],
  '1>0': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: -1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
  '1>2': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: -1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
  '2>1': [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -2 },
    { x: -1, y: -2 },
  ],
  '2>3': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
  ],
  '3>2': [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: 2 },
    { x: -1, y: 2 },
  ],
  '3>0': [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: 2 },
    { x: -1, y: 2 },
  ],
  '0>3': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
  ],
};

/**
 * The I piece has its own table. Both tables are transcribed in the published orientation
 * (`+y` up, the convention the SRS diagrams use); `kickOffsets` flips `y` into grid space.
 */
export const I_KICKS: Readonly<Record<RotationTransition, readonly Vector[]>> = {
  '0>1': [
    { x: 0, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: -1 },
    { x: 1, y: 2 },
  ],
  '1>0': [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 1 },
    { x: -1, y: -2 },
  ],
  '1>2': [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: -2 },
    { x: 2, y: 1 },
  ],
  '2>1': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 2 },
    { x: -2, y: -1 },
  ],
  '2>3': [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 1 },
    { x: -1, y: -2 },
  ],
  '3>2': [
    { x: 0, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: -1 },
    { x: 1, y: 2 },
  ],
  '3>0': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 2 },
    { x: -2, y: -1 },
  ],
  '0>3': [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: -2 },
    { x: 2, y: 1 },
  ],
};

/** The O piece never kicks; a rotation is a visual no-op. */
const O_KICKS: readonly Vector[] = [{ x: 0, y: 0 }];

export function rotationTransition(from: RotationState, to: RotationState): RotationTransition {
  return `${from}>${to}` as RotationTransition;
}

/**
 * Kick offsets in grid space (`+y` down, `+x` right), ready to add to a placement.
 * Kernels return the published table order.
 */
export function kickOffsets(id: PieceId, from: RotationState, to: RotationState): readonly Vector[] {
  if (id === 'O') return O_KICKS;
  const table = id === 'I' ? I_KICKS : JLSTZ_KICKS;
  const published = table[rotationTransition(from, to)];
  // Published +y is up; the grid grows downward, hence the sign flip on y.
  // `-0` is normalised to `0` so equality checks behave.
  return published.map((offset) => ({ x: offset.x === 0 ? 0 : offset.x, y: offset.y === 0 ? 0 : -offset.y }));
}

export function nextRotation(rotation: RotationState, direction: 1 | -1): RotationState {
  return (((rotation + direction) % 4 + 4) % 4) as RotationState;
}

/**
 * True when a kick is one of SRS's "1×2" offset moves. A Mini T-Spin performed with such a
 * kick is promoted to a full T-Spin (see `docs/RULESET.md` §9).
 */
export function isLongKick(kick: Vector): boolean {
  const ax = Math.abs(kick.x);
  const ay = Math.abs(kick.y);
  return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
}

/**
 * Resolves a rotation. `isFree(cellX, cellY)` is the collision test supplied by the board.
 * Returns the resulting placement plus the kick that was used, or null when every test fails.
 */
export function resolveRotation(
  placement: PiecePlacement,
  direction: 1 | -1,
  isFree: (x: number, y: number) => boolean,
): { placement: PiecePlacement; kick: Vector } | null {
  const target = nextRotation(placement.rotation, direction);
  for (const kick of kickOffsets(placement.id, placement.rotation, target)) {
    const candidate: PiecePlacement = {
      id: placement.id,
      rotation: target,
      x: placement.x + kick.x,
      y: placement.y + kick.y,
    };
    const cells = shapeCells(candidate.id, candidate.rotation);
    let fits = true;
    for (const cell of cells) {
      if (!isFree(candidate.x + cell.x, candidate.y + cell.y)) {
        fits = false;
        break;
      }
    }
    if (fits) return { placement: candidate, kick };
  }
  return null;
}
