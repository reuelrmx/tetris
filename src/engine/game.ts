import { Board } from './board.ts';
import { PieceQueue } from './bag.ts';
import { Rng } from './rng.ts';
import { placementCells, spawnPlacement } from './pieces.ts';
import { resolveRotation } from './rotation.ts';
import { detectSpin } from './tspin.ts';
import { computeAttack, isDifficultClear, scoreLock } from './scoring.ts';
import { gravityCellsPerSecond, levelForLines, lockDelayMsForLevel, softDropCellsPerSecond } from './gravity.ts';
import {
  SLIVER_ROWS,
  cellCodeForPiece,
  clearTypeForLines,
  emptyStats,
} from './types.ts';
import type { GravityConfig } from './gravity.ts';
import type { ModeDefinition, RuleSet } from './ruleset.ts';
import type {
  ActionOutcome,
  DropPoints,
  GameEvent,
  GameOverReason,
  GamePhase,
  GameResult,
  GameSnapshot,
  GameStats,
  GameStatus,
  GameSummary,
  LastAction,
  LockResult,
  PieceId,
  PiecePlacement,
  PlayerBoardView,
  SpinKind,
  Vector,
} from './types.ts';

/** Largest simulation step; longer frames (tab switches) are clamped, never fast-forwarded. */
export const MAX_STEP_MS = 100;

export interface GarbageBurst {
  readonly rows: number;
  readonly holeColumn: number;
}

export interface GameOptions {
  readonly rules: RuleSet;
  readonly mode: ModeDefinition;
  readonly seed: number;
  /** Overrides the mode's default starting level (Marathon supports this). */
  readonly startLevel?: number;
  /** Enables attacks, garbage insertions and pending-garbage bookkeeping. */
  readonly attacksEnabled?: boolean;
  readonly autoStart?: boolean;
}

type BufferedAction =
  | { readonly kind: 'move'; readonly direction: -1 | 1 }
  | { readonly kind: 'rotate'; readonly direction: 1 | -1 }
  | { readonly kind: 'hold' };

/**
 * A position to load into a game.
 *
 * This is engine API rather than test scaffolding: `tools/render-preview.ts` uses it to draw
 * representative board states headlessly, and the unit tests use it to place pieces in exact
 * situations (T-Spin slots, near-top-out stacks) without replaying hundreds of inputs.
 */
export interface ScenarioSetup {
  /** ASCII map anchored to the bottom of the grid, see `Board.loadFromAscii`. */
  readonly board?: readonly string[];
  readonly active?: PiecePlacement | null;
  readonly hold?: PieceId | null;
}

/**
 * The game state machine.
 *
 * Deterministic and DOM-free: the host calls `update(deltaMs)` (typically from
 * `requestAnimationFrame`), input handlers call the discrete action methods, and both emit
 * events through `drainEvents()`. Every rule lives in the `RuleSet`; see `docs/RULESET.md`.
 */
export class Game {
  readonly rules: RuleSet;
  readonly mode: ModeDefinition;
  readonly seed: number;
  readonly previewCount: number;
  readonly attacksEnabled: boolean;

  private readonly gravity: GravityConfig;
  private readonly board: Board;
  private readonly queue: PieceQueue;
  /** Separate stream for hole columns so bag order and garbage randomness stay independent. */
  private readonly holeRng: Rng;

  private active: PiecePlacement | null = null;
  private activeCellsCache: Vector[] = [];
  private ghostCellsCache: Vector[] = [];
  private ghostDirty = true;

  private phase: GamePhase = 'falling';
  private gameStatus: GameStatus = 'ready';

  private levelValue: number;
  private linesValue = 0;
  private scoreValue = 0;
  private comboValue = 0;
  private backToBackChain = false;
  private holdId: PieceId | null = null;
  private holdAvailable = true;
  private elapsedMsValue = 0;
  private lineClearTimerMs = 0;
  private spawnTimerMs = 0;
  private gravityAccumulator = 0;
  private groundTimerMs = 0;
  private lockResetsUsed = 0;
  private softDrop = false;
  private softDropCells = 0;
  private hardDropCells = 0;
  private lastAction: LastAction = 'spawn';
  private lastKick: Vector = { x: 0, y: 0 };
  private lastLockPoints = 0;
  private lastClearRows: number[] = [];
  private clearingRows: number[] = [];
  private pendingGarbageRows: GarbageBurst[] = [];
  private lastHoleColumn: number | null = null;
  private locksPerformed = 0;
  private buffered: BufferedAction | null = null;
  private currentStats: GameStats = emptyStats();
  private finishSummary: GameSummary | null = null;
  private events: GameEvent[] = [];

  constructor(options: GameOptions) {
    this.rules = options.rules;
    this.mode = options.mode;
    this.seed = options.seed >>> 0;
    this.previewCount = this.rules.previewCount;
    this.attacksEnabled = options.attacksEnabled ?? (this.mode.allowAttacks && this.rules.attack.enabled);
    this.gravity = { ...this.rules.gravity, ...this.mode.levels };
    const startLevel = Math.max(1, options.startLevel ?? this.mode.levels.startLevel);
    this.levelValue = startLevel;
    this.board = new Board(this.rules.cols, this.rules.rows);
    this.queue = new PieceQueue(this.seed);
    this.holeRng = new Rng((this.seed ^ 0x5bf03635) >>> 0);
    if (options.autoStart !== false) this.start();
  }

  // ---------------------------------------------------------------- status

  get status(): GameStatus {
    return this.gameStatus;
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }

  get level(): number {
    return this.levelValue;
  }

  get lines(): number {
    return this.linesValue;
  }

  get score(): number {
    return this.scoreValue;
  }

  get stats(): GameStats {
    return this.currentStats;
  }

  get summary(): GameSummary | null {
    return this.finishSummary;
  }

  get pendingGarbageRowsCount(): number {
    let total = 0;
    for (const burst of this.pendingGarbageRows) total += burst.rows;
    return total;
  }

  get remainingMs(): number | null {
    if (this.mode.goal.kind !== 'time') return null;
    return Math.max(0, this.mode.goal.durationMs - this.elapsedMsValue);
  }

  get linesGoal(): number | null {
    return this.mode.goal.kind === 'lines' ? this.mode.goal.lines : null;
  }

  /** Fraction (0..1) of the lock delay consumed; 0 while the piece is airborne. */
  get lockProgress(): number {
    if (!this.active || this.activeGrounded === false) return 0;
    const limit = lockDelayMsForLevel(this.gravity, this.levelValue);
    return limit <= 0 ? 1 : Math.min(1, this.groundTimerMs / limit);
  }

  private get activeGrounded(): boolean {
    return this.active !== null && !this.canPlace(this.translate(this.active, 0, 1));
  }

  start(): void {
    if (this.gameStatus === 'playing') return;
    this.gameStatus = 'playing';
    this.phase = 'falling';
    this.spawnNext();
  }

  pause(): boolean {
    if (this.gameStatus !== 'playing' || !this.mode.allowPause) return false;
    this.gameStatus = 'paused';
    this.softDrop = false;
    return true;
  }

  resume(): boolean {
    if (this.gameStatus !== 'paused') return false;
    this.gameStatus = 'playing';
    return true;
  }

  /** Ends the game early (leaving a match, quitting to the menu). */
  endGame(reason: GameOverReason = 'quit'): void {
    this.finish(reason);
  }

  drainEvents(): readonly GameEvent[] {
    if (this.events.length === 0) return EMPTY_EVENTS;
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /**
   * Loads a position (board, active piece, hold slot). Used by the headless preview renderer
   * and by the engine tests; it does not touch score, lines or the queue.
   */
  applyScenario(setup: ScenarioSetup): void {
    if (setup.board) {
      this.board.loadFromAscii(setup.board);
      this.ghostDirty = true;
    }
    if (setup.active !== undefined) {
      if (setup.active === null) {
        this.active = null;
        this.activeCellsCache = [];
        this.ghostCellsCache = [];
      } else {
        this.active = setup.active;
        this.activeCellsCache = placementCells(setup.active);
        this.ghostDirty = true;
      }
      this.groundTimerMs = 0;
      this.lockResetsUsed = 0;
      this.gravityAccumulator = 0;
    }
    if (setup.hold !== undefined) this.holdId = setup.hold;
  }

  /** Direct read access to the grid, for the preview renderer and tests. */
  get boardRef(): Board {
    return this.board;
  }

  // ---------------------------------------------------------------- input actions

  moveHorizontal(direction: -1 | 1): ActionOutcome {
    if (!this.canAct()) {
      const buffered = this.tryBuffer({ kind: 'move', direction });
      return { performed: false, blocked: !buffered };
    }
    const active = this.active as PiecePlacement;
    const candidate = this.translate(active, direction, 0);
    if (!this.canPlace(candidate)) {
      this.events.push({ type: 'move', direction, blocked: true });
      return { performed: false, blocked: true };
    }
    this.setActive(candidate);
    this.lastAction = 'move';
    this.registerGroundedAction();
    this.events.push({ type: 'move', direction, blocked: false });
    return { performed: true, blocked: false };
  }

  rotate(direction: 1 | -1): ActionOutcome {
    if (!this.canAct()) {
      const buffered = this.tryBuffer({ kind: 'rotate', direction });
      return { performed: false, blocked: !buffered };
    }
    const active = this.active as PiecePlacement;
    const resolved = resolveRotation(active, direction, (x, y) => this.board.isFree(x, y));
    if (!resolved) {
      this.events.push({ type: 'rotate', direction, kick: { x: 0, y: 0 }, blocked: true });
      return { performed: false, blocked: true };
    }
    this.setActive(resolved.placement);
    this.lastAction = 'rotation';
    this.lastKick = resolved.kick;
    this.registerGroundedAction();
    this.events.push({ type: 'rotate', direction, kick: resolved.kick, blocked: false });
    return { performed: true, blocked: false };
  }

  setSoftDrop(active: boolean): void {
    this.softDrop = active && this.canAct();
    if (!this.softDrop) this.gravityAccumulator = 0;
  }

  hardDrop(): ActionOutcome {
    if (!this.canAct()) return { performed: false, blocked: false };
    const distance = this.dropDistance();
    if (distance > 0) {
      this.setActive(this.translate(this.active as PiecePlacement, 0, distance));
      this.hardDropCells += distance;
    }
    // A hard drop is not a "move": a T-Spin set up by a rotation and then hard-dropped still counts.
    this.lockPiece();
    return { performed: true, blocked: false };
  }

  hold(): ActionOutcome {
    if (!this.rules.holdEnabled) return { performed: false, blocked: false };
    if (!this.canAct()) {
      const buffered = this.tryBuffer({ kind: 'hold' });
      return { performed: false, blocked: !buffered };
    }
    if (!this.holdAvailable) {
      this.events.push({ type: 'hold', stored: this.holdId ?? (this.active as PiecePlacement).id, swapped: false, blocked: true });
      return { performed: false, blocked: true };
    }
    const activeId = (this.active as PiecePlacement).id;
    const swapped = this.holdId !== null;
    const incoming = this.holdId ?? this.queue.next();
    this.holdId = activeId;
    this.holdAvailable = false;
    this.currentStats = { ...this.currentStats, holds: this.currentStats.holds + 1 };
    this.events.push({ type: 'hold', stored: activeId, swapped, blocked: false });
    this.spawnPiece(incoming);
    return { performed: true, blocked: false };
  }

  // ---------------------------------------------------------------- simulation

  update(deltaMs: number): void {
    if (this.gameStatus !== 'playing') return;
    const dt = Math.max(0, Math.min(deltaMs, MAX_STEP_MS));
    if (this.enforceTimeLimit()) return;
    this.elapsedMsValue += dt;

    switch (this.phase) {
      case 'clearing': {
        this.lineClearTimerMs -= dt;
        if (this.lineClearTimerMs <= 0) this.completeLineClear();
        break;
      }
      case 'settling': {
        this.spawnTimerMs -= dt;
        if (this.spawnTimerMs <= 0) this.spawnNext();
        break;
      }
      case 'falling': {
        this.stepActivePiece(dt);
        break;
      }
      case 'finished':
        break;
    }
  }

  private enforceTimeLimit(): boolean {
    const remaining = this.remainingMs;
    if (remaining !== null && remaining <= 0) {
      this.finish('time');
      return true;
    }
    return false;
  }

  /** One frame of gravity, soft drop and lock-delay bookkeeping. */
  private stepActivePiece(dt: number): void {
    const active = this.active;
    if (!active) return;

    if (this.activeGrounded) {
      this.gravityAccumulator = 0;
      const limit = lockDelayMsForLevel(this.gravity, this.levelValue);
      this.groundTimerMs += dt;
      if (this.groundTimerMs >= limit) {
        this.lockPiece();
        return;
      }
      return;
    }

    // Airborne: the lock timer is held at zero but the reset budget survives.
    this.groundTimerMs = 0;

    const cellsPerSecond = this.softDrop
      ? softDropCellsPerSecond(this.gravity, this.levelValue)
      : gravityCellsPerSecond(this.levelValue, this.gravity.speedCapLevel);
    this.gravityAccumulator += (cellsPerSecond * dt) / 1000;

    let steps = 0;
    while (this.gravityAccumulator >= 1 && steps < MAX_GRAVITY_STEPS_PER_UPDATE) {
      const moved = this.tryStepDown();
      if (!moved) {
        this.gravityAccumulator = 0;
        return;
      }
      this.gravityAccumulator -= 1;
      steps++;
    }
    if (steps >= MAX_GRAVITY_STEPS_PER_UPDATE) this.gravityAccumulator = 0;
  }

  /** One downward step. Soft drop credits a point per cell; gravity does not. */
  private tryStepDown(): boolean {
    const active = this.active as PiecePlacement;
    const candidate = this.translate(active, 0, 1);
    if (!this.canPlace(candidate)) return false;
    this.setActive(candidate);
    if (this.softDrop) {
      this.softDropCells += 1;
      this.lastAction = 'move';
    } else {
      this.lastAction = 'gravity';
    }
    return true;
  }

  /** A successful grounded move or rotation refreshes the lock timer, up to the reset limit. */
  private registerGroundedAction(): void {
    if (!this.activeGrounded) {
      this.groundTimerMs = 0;
      return;
    }
    if (this.lockResetsUsed < this.rules.lockResetLimit) {
      this.lockResetsUsed += 1;
      this.groundTimerMs = 0;
    }
  }

  // ---------------------------------------------------------------- locking

  private lockPiece(): void {
    const active = this.active;
    if (!active) return;
    const cells = this.activeCellsCache;
    const spin = detectSpin(this.board, active, { lastAction: this.lastAction, lastKick: this.lastKick });
    this.board.lock(cells, cellCodeForPiece(active.id));

    const fullRows = this.board.findFullRows();
    const lines = fullRows.length;
    const clearType = clearTypeForLines(lines);
    const levelBefore = this.levelValue;
    const previousBackToBack = this.backToBackChain;
    const combo = lines > 0 ? this.comboValue + 1 : 0;
    const perfectClear = lines > 0 && this.isPerfectClearPending(fullRows);
    const drop: DropPoints = { softDropCells: this.softDropCells, hardDropCells: this.hardDropCells };

    const scored = scoreLock(
      {
        clearType,
        lines,
        spin,
        level: levelBefore,
        backToBack: previousBackToBack,
        combo,
        perfectClear,
        drop,
      },
      this.rules.scoring,
    );
    this.scoreValue += scored.points;
    this.lastLockPoints = scored.points;

    const attack = computeAttack(
      { clearType, lines, spin, backToBack: previousBackToBack, combo, perfectClear },
      this.rules.attack,
    );

    if (lines > 0) {
      this.comboValue = combo;
      this.backToBackChain = isDifficultClear(lines, spin);
    } else {
      this.comboValue = 0;
      // A lock that clears nothing leaves the chain intact (including a spin with no lines).
    }

    this.linesValue += lines;
    this.applyLevelProgression();
    this.accumulateLockStats(lines, spin, combo, perfectClear);
    this.locksPerformed += 1;

    const toppedOut = this.applyGarbageAfterLock(lines);
    const lockedAboveField = cells.every((cell) => cell.y < this.rules.hiddenRows);
    const baseLock = {
      piece: active,
      cells,
      linesCleared: lines,
      clearType,
      rowsCleared: fullRows,
      spin,
      backToBack: scored.backToBackApplied,
      combo,
      perfectClear,
      level: levelBefore,
      points: scored.points,
      scoreBreakdown: scored.breakdown,
      attack,
      drop,
    };

    this.active = null;
    this.softDropCells = 0;
    this.hardDropCells = 0;
    this.holdAvailable = true;
    this.softDrop = false;
    this.gravityAccumulator = 0;
    this.groundTimerMs = 0;
    this.lockResetsUsed = 0;
    this.lastAction = 'spawn';
    this.lastKick = { x: 0, y: 0 };

    this.lastClearRows = fullRows.map((row) => row - this.rules.hiddenRows);

    // The LockResult carries `toppedOut`; build it once we know every outcome.
    const result: LockResult = { ...baseLock, toppedOut };
    this.events.push({ type: 'lock', result });

    if (this.attacksEnabled && attack.lines > 0) {
      const forwarded = this.cancelIncomingGarbage(attack.lines);
      if (forwarded > 0) {
        this.currentStats = {
          ...this.currentStats,
          garbageSent: this.currentStats.garbageSent + forwarded,
          attacksSent: this.currentStats.attacksSent + 1,
          maxAttack: Math.max(this.currentStats.maxAttack, forwarded),
        };
        this.events.push({ type: 'attack', lines: forwarded, breakdown: attack });
      }
    }

    if (toppedOut) {
      this.finish('blockout');
      return;
    }
    if (lockedAboveField) {
      this.finish('lockout');
      return;
    }
    if (lines > 0) {
      this.clearingRows = fullRows;
      this.lineClearTimerMs = this.rules.lineClearDelayMs;
      this.phase = 'clearing';
      if (this.lineClearTimerMs <= 0) this.completeLineClear();
      return;
    }
    this.enterSettling();
  }

  /** True when removing `fullRows` empties the board (perfect clear). */
  private isPerfectClearPending(fullRows: readonly number[]): boolean {
    const doomed = new Set(fullRows);
    for (let y = 0; y < this.board.rows; y++) {
      if (doomed.has(y)) continue;
      for (let x = 0; x < this.board.cols; x++) {
        if (this.board.get(x, y) !== 0) return false;
      }
    }
    return true;
  }

  private completeLineClear(): void {
    this.board.clearRows(this.clearingRows);
    this.clearingRows = [];
    this.phase = 'settling';
    const goal = this.mode.goal;
    if (goal.kind === 'lines' && this.linesValue >= goal.lines) {
      this.finish('goal');
      return;
    }
    this.enterSettling();
  }

  private enterSettling(): void {
    this.spawnTimerMs = this.rules.spawnDelayMs;
    this.phase = 'settling';
    if (this.spawnTimerMs <= 0) this.spawnNext();
  }

  private applyLevelProgression(): void {
    const nextLevel = this.mode.gravityMode === 'leveled' ? levelForLines(this.gravity, this.linesValue) : this.levelValue;
    if (nextLevel !== this.levelValue) {
      this.levelValue = nextLevel;
      this.events.push({ type: 'levelup', level: nextLevel });
    }
  }

  private accumulateLockStats(lines: number, spin: SpinKind, combo: number, perfectClear: boolean): void {
    const stats = this.currentStats;
    this.currentStats = {
      ...stats,
      piecesPlaced: stats.piecesPlaced + 1,
      lineClears: stats.lineClears + (lines > 0 ? 1 : 0),
      singles: stats.singles + (lines === 1 ? 1 : 0),
      doubles: stats.doubles + (lines === 2 ? 1 : 0),
      triples: stats.triples + (lines === 3 ? 1 : 0),
      quads: stats.quads + (lines >= 4 ? 1 : 0),
      tspins: stats.tspins + (spin === 'tspin' ? 1 : 0),
      miniTspins: stats.miniTspins + (spin === 'mini' ? 1 : 0),
      perfectClears: stats.perfectClears + (perfectClear ? 1 : 0),
      maxCombo: Math.max(stats.maxCombo, combo),
    };
  }

  // ---------------------------------------------------------------- garbage

  /**
   * Queues incoming garbage. Hole columns are supplied by the match server in versus play; in
   * single player the engine picks them from its own stream (never repeating the previous column).
   */
  queueGarbage(rows: number, holeColumn?: number): void {
    if (rows <= 0) return;
    const column = holeColumn ?? this.pickHoleColumn();
    const clamped = Math.max(0, Math.min(this.board.cols - 1, column));
    this.pendingGarbageRows.push({ rows, holeColumn: clamped });
    this.lastHoleColumn = clamped;
  }

  private pickHoleColumn(): number {
    const cols = this.board.cols;
    if (!this.rules.garbage.avoidRepeatingHole || this.lastHoleColumn === null) {
      const col = this.holeRng.nextInt(cols);
      this.lastHoleColumn = col;
      return col;
    }
    // Draw from the other nine columns by mapping a (cols - 1) draw around the previous hole.
    const offset = this.holeRng.nextInt(cols - 1);
    const column = (this.lastHoleColumn + 1 + offset) % cols;
    this.lastHoleColumn = column;
    return column;
  }

  /** Live view of the incoming queue, used by the match layer and the garbage indicator. */
  pendingGarbage(): readonly GarbageBurst[] {
    return this.pendingGarbageRows;
  }

  /**
   * Cancels pending incoming rows with outgoing attack, 1:1, and returns the amount left over.
   * Insertion itself happens on the next lock that clears no lines (RULESET §13).
   */
  private cancelIncomingGarbage(attackLines: number): number {
    let remaining = attackLines;
    while (remaining > 0 && this.pendingGarbageRows.length > 0) {
      const burst = this.pendingGarbageRows[0] as GarbageBurst;
      const consumed = Math.min(remaining, burst.rows);
      remaining -= consumed;
      if (consumed >= burst.rows) {
        this.pendingGarbageRows.shift();
      } else {
        this.pendingGarbageRows[0] = { rows: burst.rows - consumed, holeColumn: burst.holeColumn };
      }
    }
    return remaining;
  }

  /** Returns true when the game ended because the stack could not accommodate the garbage. */
  private applyGarbageAfterLock(linesCleared: number): boolean {
    if (!this.attacksEnabled || linesCleared > 0) return false;
    if (this.pendingGarbageRows.length === 0) return false;
    if (this.rules.garbage.requireInitialLock && this.locksPerformed < 2) return false;

    let budget = this.rules.garbage.maxRowsPerInsertion;
    let inserted = 0;
    let holeColumn = -1;
    while (budget > 0 && this.pendingGarbageRows.length > 0) {
      const burst = this.pendingGarbageRows[0] as GarbageBurst;
      const rows = Math.min(budget, burst.rows);
      const outcome = this.board.insertGarbage(rows, burst.holeColumn);
      if (!outcome.ok) return true;
      inserted += rows;
      holeColumn = burst.holeColumn;
      budget -= rows;
      if (rows >= burst.rows) {
        this.pendingGarbageRows.shift();
      } else {
        this.pendingGarbageRows[0] = { rows: burst.rows - rows, holeColumn: burst.holeColumn };
      }
    }
    if (inserted > 0) {
      this.currentStats = {
        ...this.currentStats,
        garbageReceived: this.currentStats.garbageReceived + inserted,
      };
      this.events.push({ type: 'garbage', inserted, holeColumn, remaining: this.pendingGarbageRowsCount });
    }
    return false;
  }

  // ---------------------------------------------------------------- spawning

  private spawnNext(): void {
    this.spawnPiece(this.queue.next());
  }

  private spawnPiece(id: PieceId): void {
    const placement = spawnPlacement(id);
    this.active = placement;
    this.activeCellsCache = placementCells(placement);
    this.ghostDirty = true;
    this.lastAction = 'spawn';
    this.lastKick = { x: 0, y: 0 };
    this.groundTimerMs = 0;
    this.lockResetsUsed = 0;
    this.gravityAccumulator = 0;
    this.phase = 'falling';

    if (this.canPlace(placement) === false) {
      this.events.push({ type: 'spawn', piece: placement, id });
      this.finish('blockout');
      return;
    }
    this.events.push({ type: 'spawn', piece: placement, id });
    this.flushBufferedAction();
  }

  // ---------------------------------------------------------------- helpers

  private canPlace(placement: PiecePlacement): boolean {
    return !this.board.collides(placementCells(placement));
  }

  private translate(placement: PiecePlacement, dx: number, dy: number): PiecePlacement {
    return { id: placement.id, rotation: placement.rotation, x: placement.x + dx, y: placement.y + dy };
  }

  private setActive(placement: PiecePlacement): void {
    this.active = placement;
    this.activeCellsCache = placementCells(placement);
    this.ghostDirty = true;
  }

  private dropDistance(): number {
    const active = this.active;
    if (!active) return 0;
    let distance = 0;
    while (this.canPlace(this.translate(active, 0, distance + 1))) distance++;
    return distance;
  }

  private getGhostCells(): readonly Vector[] {
    if (!this.active) return EMPTY_CELLS;
    if (this.ghostDirty) {
      const distance = this.dropDistance();
      this.ghostCellsCache = this.activeCellsCache.map((cell) => ({ x: cell.x, y: cell.y + distance }));
      this.ghostDirty = false;
    }
    return this.ghostCellsCache;
  }

  private canAct(): boolean {
    return this.gameStatus === 'playing' && this.phase === 'falling' && this.active !== null;
  }

  /**
   * Remembers a single action performed during the clear/spawn delay and replays it on spawn.
   * Modern games have no entry delay, so a press during a 150 ms line-clear animation would
   * otherwise be swallowed; the last press in the window wins.
   */
  private tryBuffer(action: BufferedAction): boolean {
    const bufferable = this.gameStatus === 'playing' && (this.phase === 'clearing' || this.phase === 'settling');
    if (!bufferable) return false;
    this.buffered = action;
    return true;
  }

  private flushBufferedAction(): void {
    const action = this.buffered;
    if (!action) return;
    this.buffered = null;
    switch (action.kind) {
      case 'move':
        this.moveHorizontal(action.direction);
        break;
      case 'rotate':
        this.rotate(action.direction);
        break;
      case 'hold':
        this.hold();
        break;
    }
  }

  private finish(reason: GameOverReason): void {
    if (this.gameStatus === 'over' || this.gameStatus === 'won') return;
    const result: GameResult = reason === 'time' || reason === 'goal' ? 'won' : 'gameover';
    this.gameStatus = result === 'won' ? 'won' : 'over';
    this.phase = 'finished';
    this.softDrop = false;
    // Clear the active piece *and* its cached cells: snapshots must not resurrect a piece
    // that the renderer would then draw on a finished board.
    this.active = null;
    this.activeCellsCache = [];
    this.ghostCellsCache = [];
    this.clearingRows = [];
    this.finishSummary = this.buildSummary(result, reason);
    this.events.push(
      result === 'won'
        ? { type: 'win', summary: this.finishSummary }
        : { type: 'gameover', summary: this.finishSummary },
    );
  }

  private buildSummary(result: GameResult, reason: GameOverReason): GameSummary {
    const seconds = this.elapsedMsValue / 1000;
    const minutes = this.elapsedMsValue / 60000;
    return {
      result,
      reason,
      modeId: this.mode.id,
      score: this.scoreValue,
      lines: this.linesValue,
      level: this.levelValue,
      durationMs: Math.round(this.elapsedMsValue),
      seed: this.seed,
      stats: this.currentStats,
      piecesPerSecond: seconds > 0 ? round2(this.currentStats.piecesPlaced / seconds) : 0,
      linesPerMinute: minutes > 0 ? round2(this.linesValue / minutes) : 0,
    };
  }

  // ---------------------------------------------------------------- view

  snapshot(): GameSnapshot {
    return {
      modeId: this.mode.id,
      status: this.gameStatus,
      phase: this.phase,
      board: this.boardView(),
      queue: this.queue.peek(this.previewCount),
      hold: this.holdId,
      holdAvailable: this.holdAvailable,
      score: this.scoreValue,
      lines: this.linesValue,
      level: this.levelValue,
      combo: this.comboValue,
      backToBack: this.backToBackChain,
      elapsedMs: this.elapsedMsValue,
      remainingMs: this.remainingMs,
      pendingGarbage: this.pendingGarbageRowsCount,
      linesGoal: this.linesGoal,
      stats: this.currentStats,
      seed: this.seed,
      lastAction: this.lastAction,
      lastClearRows: this.lastClearRows,
      lastLockPoints: this.lastLockPoints,
    };
  }

  private boardView(): PlayerBoardView {
    const visibleRows = this.rules.rows - this.rules.hiddenRows;
    const height = visibleRows + SLIVER_ROWS;
    const cells = new Uint8Array(this.rules.cols * height);
    this.board.copyVisibleInto(cells, this.rules.hiddenRows - SLIVER_ROWS);
    return {
      width: this.rules.cols,
      height,
      sliverRows: SLIVER_ROWS,
      cells,
      activeCells: toViewSpace(this.activeCellsCache, this.rules.hiddenRows),
      activeId: this.active?.id ?? null,
      ghostCells: this.active ? toViewSpace(this.getGhostCells(), this.rules.hiddenRows) : EMPTY_CELLS,
      clearingRows: this.clearingRows.map((row) => row - this.rules.hiddenRows + SLIVER_ROWS),
    };
  }
}

const EMPTY_EVENTS: readonly GameEvent[] = [];
const EMPTY_CELLS: readonly Vector[] = [];
/** 20G means a full-field drop inside one frame; 40 rows is more than enough headroom. */
const MAX_GRAVITY_STEPS_PER_UPDATE = 40;

/** Converts grid rows to view rows: view 0 is the sliver row just above the frame. */
function toViewSpace(cells: readonly Vector[], hiddenRows: number): Vector[] {
  return cells.map((cell) => ({ x: cell.x, y: cell.y - hiddenRows + SLIVER_ROWS }));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
