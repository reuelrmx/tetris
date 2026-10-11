import type { PieceId, PiecePlacement, RotationState, Vector } from './types.ts';

/**
 * Piece geometry.
 *
 * Shapes are written as the canonical SRS bounding-box matrices, one per rotation state,
 * with `X` marking an occupied cell. Writing them as text keeps them reviewable against
 * the published SRS diagrams in `docs/RULESET.md` §2.
 *
 * The five 3×3 pieces rotate about the centre cell of the box; `I` uses a 4×4 box and
 * rotates about a grid intersection; `O` uses a 2×2 box and never moves when rotated.
 */

export const PIECE_BOX: Readonly<Record<PieceId, number>> = {
  I: 4,
  J: 3,
  L: 3,
  O: 2,
  S: 3,
  T: 3,
  Z: 3,
};

/** Box-local coordinates of the rotation point (used for T-Spin corner tests). */
export const ROTATION_CENTER: Readonly<Record<PieceId, Vector>> = {
  I: { x: 1.5, y: 1.5 },
  J: { x: 1, y: 1 },
  L: { x: 1, y: 1 },
  O: { x: 0.5, y: 0.5 },
  S: { x: 1, y: 1 },
  T: { x: 1, y: 1 },
  Z: { x: 1, y: 1 },
};

const SHAPES: Readonly<Record<PieceId, readonly [string[], string[], string[], string[]]>> = {
  I: [
    ['....', 'XXXX', '....', '....'],
    ['..X.', '..X.', '..X.', '..X.'],
    ['....', '....', 'XXXX', '....'],
    ['.X..', '.X..', '.X..', '.X..'],
  ],
  J: [
    ['X..', 'XXX', '...'],
    ['.XX', '.X.', '.X.'],
    ['...', 'XXX', '..X'],
    ['.X.', '.X.', 'XX.'],
  ],
  L: [
    ['..X', 'XXX', '...'],
    ['.X.', '.X.', '.XX'],
    ['...', 'XXX', 'X..'],
    ['XX.', '.X.', '.X.'],
  ],
  O: [
    ['XX', 'XX'],
    ['XX', 'XX'],
    ['XX', 'XX'],
    ['XX', 'XX'],
  ],
  S: [
    ['.XX', 'XX.', '...'],
    ['.X.', '.XX', '..X'],
    ['...', '.XX', 'XX.'],
    ['X..', 'XX.', '.X.'],
  ],
  T: [
    ['.X.', 'XXX', '...'],
    ['.X.', '.XX', '.X.'],
    ['...', 'XXX', '.X.'],
    ['.X.', 'XX.', '.X.'],
  ],
  Z: [
    ['XX.', '.XX', '...'],
    ['..X', '.XX', '.X.'],
    ['...', 'XX.', '.XX'],
    ['.X.', 'XX.', 'X..'],
  ],
};

/**
 * Spawn box origins.
 *
 * Every piece's lowest occupied row is hidden row 19, the last row of the buffer and the row
 * shown in the sliver; `J L S T Z O` also occupy hidden row 18 and `I` only occupies row 19.
 * That is the Guideline arrangement (piece letters share two rows, `I` sits in the lower one),
 * one row lower than the 2001-era placement — the same shift modern web and console games use,
 * so pieces enter the visible field immediately.
 *
 * `x` centres each piece: the 3-wide pieces land on columns 3–5 (flat side rounded left of
 * centre), `I` on columns 3–6 and `O` on columns 4–5.
 */
export const SPAWN_ORIGIN: Readonly<Record<PieceId, Vector>> = {
  I: { x: 3, y: 18 },
  J: { x: 3, y: 18 },
  L: { x: 3, y: 18 },
  O: { x: 4, y: 18 },
  S: { x: 3, y: 18 },
  T: { x: 3, y: 18 },
  Z: { x: 3, y: 18 },
};

interface ParsedShape {
  readonly cells: readonly Vector[];
  /** Cached string identity for fast equality checks in tests/debug tooling. */
  readonly key: string;
}

const parsedCache = new Map<string, ParsedShape>();

function parseShape(rows: readonly string[]): ParsedShape {
  const cells: Vector[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'X') cells.push({ x, y });
    }
  }
  return { cells, key: rows.join('/') };
}

/** Box-local cells for a piece in a given rotation state. */
export function shapeCells(id: PieceId, rotation: RotationState): readonly Vector[] {
  const cacheKey = `${id}:${rotation}`;
  const cached = parsedCache.get(cacheKey);
  if (cached) return cached.cells;
  const rows = SHAPES[id][rotation];
  const parsed = parseShape(rows);
  parsedCache.set(cacheKey, parsed);
  return parsed.cells;
}

/** Board-space cells for a placement. */
export function placementCells(placement: PiecePlacement): Vector[] {
  return shapeCells(placement.id, placement.rotation).map((cell) => ({
    x: placement.x + cell.x,
    y: placement.y + cell.y,
  }));
}

export function spawnPlacement(id: PieceId): PiecePlacement {
  const origin = SPAWN_ORIGIN[id];
  return { id, rotation: 0, x: origin.x, y: origin.y };
}

/** Width of the occupied cells of a piece in its spawn state (used by the preview tiles). */
export function placementBounds(cells: readonly Vector[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * The four corner cells around a `T` piece's rotation centre, as box-local offsets.
 * Order: top-left, top-right, bottom-left, bottom-right.
 */
export const T_CORNERS: readonly Vector[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: 2 },
  { x: 2, y: 2 },
];

/**
 * The two "front" corner indices for each rotation state — the corners adjacent to the
 * T's stem, used to tell a full T-Spin from a Mini.
 */
export const T_FRONT_CORNERS: Readonly<Record<RotationState, readonly [number, number]>> = {
  0: [0, 1], // stem points up
  1: [1, 3], // stem points right
  2: [2, 3], // stem points down
  3: [0, 2], // stem points left
};
