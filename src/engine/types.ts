/**
 * Core engine types.
 *
 * Nothing in this file (or in `src/engine` generally) may reference the DOM, Canvas,
 * storage or the network: the engine is a pure, deterministic state machine that is
 * driven by explicit `update(deltaMs)` calls. See `test/unit/engine-boundary.test.ts`.
 */

/** The seven tetromino kinds, in canonical order. */
export type PieceId = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

export const PIECE_IDS = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as const;

/** Rotation states in SRS order: 0 = spawn, 1 = clockwise from spawn, 2 = flipped, 3 = counter-clockwise. */
export type RotationState = 0 | 1 | 2 | 3;

/** Cell codes stored in the board grid. */
export const CELL_EMPTY = 0;
/** Garbage rows use their own code so the renderer can style them distinctly. */
export const CELL_GARBAGE = 8;
/**
 * A neutral locked block, used for fixtures and previews ("a block is here" without claiming a
 * colour) and for stack diagrams in the docs. It never appears during normal play.
 */
export const CELL_BLOCK = 9;
/** Highest valid cell code. */
export const CELL_MAX = CELL_BLOCK;

/** Maps a piece id to its board cell code (1..7). */
export function cellCodeForPiece(id: PieceId): number {
  return PIECE_IDS.indexOf(id) + 1;
}

/** Maps a board cell code back to a piece id, or null for empty/garbage. */
export function pieceForCellCode(code: number): PieceId | null {
  if (code < 1 || code > 7) return null;
  return PIECE_IDS[code - 1] ?? null;
}

export interface Vector {
  readonly x: number;
  readonly y: number;
}

/** A piece placed on the grid. `x`/`y` is the top-left corner of its bounding box. */
export interface PiecePlacement {
  readonly id: PieceId;
  readonly rotation: RotationState;
  readonly x: number;
  readonly y: number;
}

export type ClearType = 'none' | 'single' | 'double' | 'triple' | 'quad';

export function clearTypeForLines(lines: number): ClearType {
  switch (lines) {
    case 0:
      return 'none';
    case 1:
      return 'single';
    case 2:
      return 'double';
    case 3:
      return 'triple';
    default:
      return 'quad';
  }
}

/**
 * What the piece did immediately before locking. T-Spin detection depends on this:
 * only `rotation` can earn a spin award.
 */
export type LastAction = 'spawn' | 'rotation' | 'move' | 'drop' | 'gravity';

/** Spin classification per the 3-corner rule with Mini promotion. */
export type SpinKind = 'none' | 'mini' | 'tspin';

export type GameStatus = 'ready' | 'playing' | 'paused' | 'over' | 'won';

/** Internal phase of a running game. */
export type GamePhase = 'falling' | 'clearing' | 'settling' | 'finished';

export type GameOverReason = 'blockout' | 'lockout' | 'time' | 'goal' | 'quit' | 'forfeit';

export type GameResult = 'gameover' | 'won';

/** One line item of the score breakdown shown on the summary screen. */
export interface ScoreLine {
  readonly label: string;
  readonly points: number;
}

export interface DropPoints {
  readonly softDropCells: number;
  readonly hardDropCells: number;
}

export interface AttackResult {
  readonly lines: number;
  readonly base: number;
  readonly backToBackBonus: number;
  readonly comboBonus: number;
  readonly perfectClearBonus: number;
}

/** Everything that happened when a piece locked. Emitted once per lock. */
export interface LockResult {
  readonly piece: PiecePlacement;
  readonly cells: readonly Vector[];
  readonly linesCleared: number;
  readonly clearType: ClearType;
  readonly rowsCleared: readonly number[];
  readonly spin: SpinKind;
  readonly backToBack: boolean;
  readonly combo: number;
  readonly perfectClear: boolean;
  readonly level: number;
  readonly points: number;
  readonly scoreBreakdown: readonly ScoreLine[];
  readonly attack: AttackResult;
  readonly drop: DropPoints;
  /** True when the lock ended the game (block-out / lock-out). */
  readonly toppedOut: boolean;
}

export interface GameStats {
  readonly piecesPlaced: number;
  readonly lineClears: number;
  readonly singles: number;
  readonly doubles: number;
  readonly triples: number;
  readonly quads: number;
  readonly tspins: number;
  readonly miniTspins: number;
  readonly perfectClears: number;
  readonly maxCombo: number;
  readonly holds: number;
  readonly garbageReceived: number;
  readonly garbageSent: number;
  readonly attacksSent: number;
  readonly maxAttack: number;
}

export function emptyStats(): GameStats {
  return {
    piecesPlaced: 0,
    lineClears: 0,
    singles: 0,
    doubles: 0,
    triples: 0,
    quads: 0,
    tspins: 0,
    miniTspins: 0,
    perfectClears: 0,
    maxCombo: 0,
    holds: 0,
    garbageReceived: 0,
    garbageSent: 0,
    attacksSent: 0,
    maxAttack: 0,
  };
}

export interface GameSummary {
  readonly result: GameResult;
  readonly reason: GameOverReason;
  readonly modeId: string;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly durationMs: number;
  readonly seed: number;
  readonly stats: GameStats;
  /** Pieces per second, rounded to 2 decimals, 0 when the game was empty. */
  readonly piecesPerSecond: number;
  readonly linesPerMinute: number;
}

/**
 * How much of the hidden buffer is drawn above the playfield frame. Pieces spawn in the
 * buffer, so a sliver is shown for the player to track them (the Guideline allows showing
 * part of the 21st row for exactly this reason).
 */
export const SLIVER_ROWS = 1;

export interface PlayerBoardView {
  readonly width: number;
  /** Visible rows plus `sliverRows`. */
  readonly height: number;
  readonly sliverRows: number;
  /** Cell codes, row-major, starting at the sliver row. */
  readonly cells: Uint8Array;
  readonly activeCells: readonly Vector[];
  readonly activeId: PieceId | null;
  readonly ghostCells: readonly Vector[];
  readonly clearingRows: readonly number[];
}

/** Immutable-ish view of the game for renderers and UI (a fresh copy each call). */
export interface GameSnapshot {
  readonly modeId: string;
  readonly status: GameStatus;
  readonly phase: GamePhase;
  readonly board: PlayerBoardView;
  readonly queue: readonly PieceId[];
  readonly hold: PieceId | null;
  readonly holdAvailable: boolean;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly combo: number;
  readonly backToBack: boolean;
  readonly elapsedMs: number;
  readonly remainingMs: number | null;
  readonly pendingGarbage: number;
  readonly linesGoal: number | null;
  readonly stats: GameStats;
  readonly seed: number;
  readonly lastAction: LastAction;
  /** Rows (visible-space, 0 = top visible row) currently flashing before compaction. */
  readonly lastClearRows: readonly number[];
  readonly lastLockPoints: number;
}

export type GameEvent =
  | { readonly type: 'spawn'; readonly piece: PiecePlacement; readonly id: PieceId }
  | { readonly type: 'move'; readonly direction: -1 | 0 | 1; readonly blocked: boolean }
  | { readonly type: 'rotate'; readonly direction: 1 | -1; readonly kick: Vector; readonly blocked: boolean }
  | { readonly type: 'lock'; readonly result: LockResult }
  | { readonly type: 'hold'; readonly stored: PieceId; readonly swapped: boolean; readonly blocked: boolean }
  | { readonly type: 'levelup'; readonly level: number }
  | { readonly type: 'garbage'; readonly inserted: number; readonly holeColumn: number; readonly remaining: number }
  | { readonly type: 'attack'; readonly lines: number; readonly breakdown: AttackResult }
  | { readonly type: 'gameover'; readonly summary: GameSummary }
  | { readonly type: 'win'; readonly summary: GameSummary };

export interface ActionOutcome {
  /** The action changed the game state. */
  readonly performed: boolean;
  /** The action was legal but had no effect (wall, floor, stack, cooldown). */
  readonly blocked: boolean;
}
