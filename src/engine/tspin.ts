import { T_CORNERS, T_FRONT_CORNERS } from './pieces.ts';
import { isLongKick } from './rotation.ts';
import type { Board } from './board.ts';
import type { LastAction, PiecePlacement, SpinKind, Vector } from './types.ts';

/**
 * T-Spin detection: the 3-corner rule with Mini T-Spins and the SRS 1×2 kick promotion.
 * See `docs/RULESET.md` §9 for the normative description and sources.
 *
 * A corner counts as occupied when it is blocked by the stack, a wall, the floor or the ceiling
 * of the grid — the board reports every out-of-bounds cell as blocked, which is exactly what the
 * rule wants. The four corners are diagonally adjacent to the T's centre, so the T's own minoes
 * can never occupy them.
 */
export interface SpinContext {
  readonly lastAction: LastAction;
  readonly lastKick: Vector;
}

export function cornerOccupancy(board: Board, placement: PiecePlacement): readonly boolean[] {
  return T_CORNERS.map((corner) => !board.isFree(placement.x + corner.x, placement.y + corner.y));
}

export function detectSpin(board: Board, placement: PiecePlacement, context: SpinContext): SpinKind {
  if (placement.id !== 'T') return 'none';
  if (context.lastAction !== 'rotation') return 'none';

  const occupied = cornerOccupancy(board, placement);
  const count = occupied.reduce((total, filled) => total + (filled ? 1 : 0), 0);
  if (count < 3) return 'none';

  const front = T_FRONT_CORNERS[placement.rotation];
  const frontFilled = (occupied[front[0]] ? 1 : 0) + (occupied[front[1]] ? 1 : 0);
  if (frontFilled === 2) return 'tspin';
  // Only one front corner: a Mini, unless the rotation was completed with a 1×2 / 2×1 kick.
  return isLongKick(context.lastKick) ? 'tspin' : 'mini';
}
