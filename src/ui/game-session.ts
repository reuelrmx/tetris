import { Game, MODES, STRATA_STANDARD_V1, gravityCellsPerSecond, levelProgress } from '../engine/index.ts';
import type { GameEvent, GameSummary, LockResult, ModeDefinition, RuleSet } from '../engine/index.ts';
import type { GameAudio } from '../audio/index.ts';
import type { ActionRouter } from '../input/router.ts';
import type { KeyboardDriver } from '../input/keyboard.ts';
import { attachBoardGestures } from '../input/touch.ts';
import { PlayfieldRenderer } from '../render/renderer.ts';
import type { DropStreak } from '../render/scene.ts';
import type { Settings } from '../storage/settings.ts';
import { announce, formatNumber } from './dom.ts';
import { PlayView } from './play-view.ts';

/** Smallest board height worth laying out, so a collapsed container still yields a playable stage. */
const MIN_BOARD_HEIGHT = 160;
/** Gap between the board and the status-chip row it shares the grid cell with (`--space-3`). */
const CHIP_ROW_GAP = 12;

/**
 * One running game: engine, renderer, input, sound, HUD and the animation loop.
 *
 * The same class drives single-player and versus matches; the match layer only adds garbage
 * routing through `receiveGarbage` and listens to `onAttack`. Pause semantics, resize handling,
 * the clear animation and the accessibility announcements therefore behave identically in every
 * mode.
 */
export interface SessionCallbacks {
  /** The game ended. `record` tells the caller whether it beat the stored best (for the summary). */
  readonly onFinished: (summary: GameSummary, record: boolean) => void;
  readonly onRequestPause: () => void;
  /** Versus: an attack produced by a lock, already net of cancelled incoming garbage. */
  readonly onAttack?: (lines: number, result: LockResult) => void;
  /** Versus: the board changed in a way the opponent should know about. */
  readonly onBoardChanged?: (summary: { lines: number; score: number; level: number; stackHeight: number }) => void;
}

export interface SessionOptions {
  readonly mode: ModeDefinition;
  readonly rules?: RuleSet;
  readonly seed: number;
  readonly startLevel?: number;
  readonly attacksEnabled?: boolean;
  readonly settings: Settings;
  readonly audio: GameAudio;
  readonly router: ActionRouter;
  readonly keyboard: KeyboardDriver | null;
  readonly callbacks: SessionCallbacks;
  /** Best score for the mode, so the HUD can flag a new record live. */
  readonly personalBest?: number;
  /** Restricts pause (used by versus, where the server owns the match clock). */
  readonly allowPause?: boolean;
  readonly reducedMotion?: boolean;
}

export class GameSession {
  readonly game: Game;
  readonly view: PlayView;
  private readonly renderer: PlayfieldRenderer;
  private readonly options: SessionOptions;
  private readonly callbacks: SessionCallbacks;
  private readonly router: ActionRouter;
  private readonly routesToKeyboard: KeyboardDriver | null;
  private gestureHandle: { destroy(): void } | null = null;
  private frameHandle: number | null = null;
  private lastTimestamp = 0;
  private running = false;
  private paused = false;
  private disposed = false;
  private clearFlash: { startedAt: number; duration: number } | null = null;
  private dropStreak: { streak: DropStreak; expiresAt: number } | null = null;
  private boardChangedSentAt = 0;
  private recordBeaten = false;
  private resizeObserver: ResizeObserver | null = null;
  private lastBoardBox: { width: number; height: number; dpr: number } | null = null;

  constructor(options: SessionOptions) {
    this.options = options;
    this.callbacks = options.callbacks;
    this.routesToKeyboard = options.keyboard;
    this.router = options.router;
    this.game = new Game({
      rules: options.rules ?? STRATA_STANDARD_V1,
      mode: options.mode,
      seed: options.seed,
      startLevel: options.startLevel,
      attacksEnabled: options.attacksEnabled ?? options.mode.allowAttacks,
      autoStart: false,
    });
    this.view = new PlayView({
      mode: options.mode,
      rules: this.game.rules,
      previewCount: this.game.previewCount,
      showTicker: options.settings.showTicker,
      onPause: () => this.requestPause(),
    });
    const canvas = this.view.canvas;
    this.renderer = new PlayfieldRenderer(canvas);

    this.router.attach(this.game, {
      onPauseRequest: () => this.requestPause(),
      onRestartRequest: () => this.restart(),
      onAction: (action, outcome) => {
        if (outcome.performed) this.options.audio.onAction(action, outcome);
      },
    });
    this.gestureHandle = attachBoardGestures(canvas, this.router);

    // Observe the grid cell, not the canvas frame: the frame's box is derived from the canvas,
    // so watching it would re-run layout in response to layout's own output.
    this.resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.layout()) : null;
    this.resizeObserver?.observe(this.view.boardArea);
    globalThis.addEventListener('resize', this.onWindowResize);
  }

  /** Starts the game and the animation loop. */
  start(): void {
    if (this.disposed) return;
    this.game.start();
    this.running = true;
    this.paused = false;
    this.options.audio.unlock();
    this.layout();
    this.view.setPaused(false);
    this.router.setEnabled(true);
    document.body.classList.add('is-playing');
    this.tick(performance.now(), true);
  }

  /** Pauses or resumes; the versus mode disables pausing. */
  requestPause(): void {
    if (!this.running || this.options.allowPause === false) return;
    this.callbacks.onRequestPause();
  }

  /** Applies a pause state decided by the host (a dialog, a match countdown). */
  setPaused(paused: boolean): void {
    if (!this.running) return;
    this.paused = paused;
    if (paused) {
      this.game.pause();
      this.router.releaseAll();
      this.routesToKeyboard?.releaseAll();
    } else {
      this.game.resume();
      this.lastTimestamp = performance.now();
    }
    this.view.setPaused(paused);
    this.router.setEnabled(!paused);
    this.renderOnce();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isFinished(): boolean {
    return this.game.status === 'over' || this.game.status === 'won';
  }

  /** Restarts with a fresh seed. */
  restart(seed = nextSeed()): GameSession {
    const options: SessionOptions = {
      ...this.options,
      seed,
      callbacks: this.callbacks,
    };
    this.dispose();
    const session = new GameSession(options);
    session.start();
    return session;
  }

  /** Versus: adds incoming garbage rows to the queue. */
  receiveGarbage(rows: number, holeColumn?: number): void {
    this.game.queueGarbage(rows, holeColumn);
  }

  /** Versus: the opponent's live board summary, for the mini board. */
  get snapshot() {
    return this.game.snapshot();
  }

  /** Ends the game from outside (forfeit, opponent won, time ran out). */
  endGame(reason: 'forfeit' | 'quit' | 'time' = 'quit'): void {
    this.game.endGame(reason);
    this.renderOnce();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    globalThis.removeEventListener('resize', this.onWindowResize);
    this.gestureHandle?.destroy();
    this.gestureHandle = null;
    this.routesToKeyboard?.releaseAll();
    this.router.attach(null);
    document.body.classList.remove('is-playing');
  }

  /** One frame: advance the engine, drain events, update the HUD and repaint. */
  private tick = (timestamp: number, immediate = false): void => {
    if (this.disposed || !this.running) return;
    const delta = immediate ? 0 : Math.min(250, Math.max(0, timestamp - this.lastTimestamp));
    this.lastTimestamp = timestamp;

    if (this.game.status === 'playing' && !this.paused) {
      this.game.update(delta);
      this.routesToKeyboard?.tick(delta);
    }
    const events = this.game.drainEvents();
    if (events.length > 0) this.handleEvents(events);
    this.options.audio.music.tick();
    this.paint(timestamp);
    if (this.game.status === 'playing' || this.paused) {
      this.frameHandle = requestAnimationFrame(this.tick);
    } else {
      this.frameHandle = null;
      document.body.classList.remove('is-playing');
    }
  };

  private handleEvents(events: readonly GameEvent[]): void {
    this.options.audio.onEvents(events);
    for (const event of events) {
      switch (event.type) {
        case 'lock': {
          const result = event.result;
          this.view.pushTicker(result);
          if (result.points > 0) this.view.flashScoreDelta(result.points);
          if (result.linesCleared > 0) {
            this.clearFlash = {
              startedAt: performance.now(),
              duration: Math.max(1, this.game.rules.lineClearDelayMs),
            };
          }
          if (result.drop.hardDropCells > 0) this.makeDropStreak(result);
          if (this.game.attacksEnabled && result.attack.lines > 0 && result.linesCleared > 0) {
            this.callbacks.onAttack?.(result.attack.lines, result);
          }
          this.announceLock(result);
          break;
        }
        case 'levelup':
          announce(`Level ${event.level}`);
          this.options.audio.music.setLevel(event.level);
          break;
        case 'garbage':
          announce(`${event.inserted} garbage rows added`);
          break;
        case 'attack':
          announce(`Attack sent: ${event.lines} lines`);
          break;
        case 'gameover':
        case 'win':
          this.finish(event.summary);
          break;
        default:
          break;
      }
    }
    if (this.game.attacksEnabled) this.reportBoardChange();
  }

  private finish(summary: GameSummary): void {
    this.running = false;
    this.router.setEnabled(false);
    this.routesToKeyboard?.releaseAll();
    document.body.classList.remove('is-playing');
    this.paint(performance.now());
    this.callbacks.onFinished(summary, this.recordBeaten);
  }

  private announceLock(result: LockResult): void {
    if (result.linesCleared === 0) return;
    const spin = result.spin === 'tspin' ? 'T-spin ' : result.spin === 'mini' ? 'Mini T-spin ' : '';
    const names = ['', 'single', 'double', 'triple', 'four-line clear'];
    const what = `${spin}${names[Math.min(4, result.linesCleared)] ?? 'clear'}`;
    const extras: string[] = [`${formatNumber(result.points)} points`];
    if (result.backToBack) extras.push('back to back');
    if (result.combo > 1) extras.push(`combo ${result.combo}`);
    if (result.perfectClear) extras.push('perfect clear');
    announce(`${what}: ${extras.join(', ')}`);
  }

  private makeDropStreak(result: LockResult): void {
    const rules = this.game.rules;
    const offset = rules.hiddenRows - 1; // grid row -> view row offset for the sliver layout
    const cells = result.cells;
    if (cells.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      minX = Math.min(minX, cell.x);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    const fromY = maxY - result.drop.hardDropCells + 1 - offset;
    const toY = maxY - offset;
    if (toY <= fromY) return;
    this.dropStreak = {
      streak: { x: minX, width: maxX - minX + 1, fromY: Math.max(0, fromY), toY },
      expiresAt: performance.now() + 130,
    };
  }

  private reportBoardChange(): void {
    const now = performance.now();
    if (now - this.boardChangedSentAt < 200) return;
    this.boardChangedSentAt = now;
    const snapshot = this.game.snapshot();
    this.callbacks.onBoardChanged?.({
      lines: snapshot.lines,
      score: snapshot.score,
      level: snapshot.level,
      stackHeight: snapshot.board.cells.reduce((count, cell) => (cell === 0 ? count : count + 1), 0),
    });
  }

  private paint(timestamp: number): void {
    const reduced = this.isReducedMotion();
    const snapshot = this.game.snapshot();
    const progress = this.clearFlash
      ? Math.min(1, (timestamp - this.clearFlash.startedAt) / this.clearFlash.duration)
      : 0;
    if (progress >= 1) this.clearFlash = null;
    if (this.dropStreak && timestamp >= this.dropStreak.expiresAt) this.dropStreak = null;

    this.renderer.render(snapshot, {
      theme: {
        glyphs: this.options.settings.glyphs,
        highContrast: this.options.settings.highContrast,
      },
      clearProgress: reduced ? (this.clearFlash ? 0.5 : 0) : progress,
      dropStreak: reduced || !this.options.settings.ghostPiece ? null : (this.dropStreak?.streak ?? null),
      dimmed: this.paused || this.isFinished,
    });

    if (snapshot.score > (this.options.personalBest ?? 0) && this.options.personalBest !== undefined) {
      this.recordBeaten = true;
    }

    const gravitySpeed = gravityCellsPerSecond(snapshot.level, this.game.rules.gravity.speedCapLevel);
    const seconds = Math.max(0.5, snapshot.elapsedMs / 1000);
    this.view.update(
      snapshot,
      {
        piecesPerSecond: snapshot.stats.piecesPlaced / seconds,
        linesPerMinute: (snapshot.lines / seconds) * 60,
        speed: gravitySpeed,
        levelProgress: levelProgress(
          { ...this.game.rules.gravity, ...this.options.mode.levels },
          snapshot.lines,
        ),
        recordBeaten: this.recordBeaten,
      },
    );
  }

  private isReducedMotion(): boolean {
    const preference = this.options.settings.reducedMotion;
    if (preference === 'reduce') return true;
    if (preference === 'allow') return false;
    return this.options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private renderOnce(): void {
    this.paint(performance.now());
  }

  private onWindowResize = (): void => this.layout();

  /** Sizes the board canvas and the piece tiles for the current container. */
  layout(): void {
    const dpr = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
    const box = this.availableBoardBox();
    if (
      this.lastBoardBox !== null &&
      this.lastBoardBox.width === box.width &&
      this.lastBoardBox.height === box.height &&
      this.lastBoardBox.dpr === dpr
    ) {
      // Same offer as last time: skip the resize. Re-assigning the backing store clears the
      // canvas, so doing it on every observer callback costs a frame of flicker for nothing.
      this.view.layout(dpr);
      this.renderOnce();
      return;
    }
    this.lastBoardBox = { ...box, dpr };
    this.renderer.resize(box.width, box.height, dpr, {
      cols: this.game.rules.cols,
      visibleRows: this.game.rules.rows - this.game.rules.hiddenRows,
      sliverRows: 1,
    });
    this.view.layout(dpr);
    this.renderOnce();
  }

  /**
   * The space the board may occupy, in CSS pixels.
   *
   * Measured from `.play__board` — the grid cell — because that box is sized by the `.play` grid
   * (`minmax(0, 1fr)`) and is therefore independent of the canvas. The previous measurement of the
   * canvas's own wrapper fed the renderer its own last output: the wrapper shrink-wraps the canvas,
   * the geometry always comes out no larger than the space offered, so every pass shrank the board
   * until it settled on a strip derived from the canvas's default 300×150 box — a stage a fraction
   * of the size the screen actually offers. The chip row shares the cell, so its height is reserved.
   */
  private availableBoardBox(): { width: number; height: number } {
    const area = this.view.boardArea;
    const chipsHeight = this.view.chipsRow.offsetHeight;
    const width = area.clientWidth;
    const height = area.clientHeight - (chipsHeight > 0 ? chipsHeight + CHIP_ROW_GAP : 0);
    return {
      // Fall back to a playable minimum while the screen is detached or hidden.
      width: width > 0 ? width : 320,
      height: Math.max(MIN_BOARD_HEIGHT, height > 0 ? height : globalThis.innerHeight * 0.6),
    };
  }
}

/** A random 32-bit seed for a fresh game, drawn from the platform CSPRNG when available. */
export function nextSeed(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    return cryptoApi.getRandomValues(new Uint32Array(1))[0] ?? 1;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** Mode lookup that keeps the session decoupled from the screen that started it. */
export function modeById(id: string): ModeDefinition {
  const mode = (MODES as Record<string, ModeDefinition | undefined>)[id];
  if (!mode) throw new Error(`Unknown mode "${id}"`);
  return mode;
}
