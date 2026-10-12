import { clearLabel } from '../engine/index.ts';
import type { GameSnapshot, LockResult, ModeDefinition, PieceId, RuleSet } from '../engine/index.ts';
import { PieceTileRenderer } from '../render/renderer.ts';
import { stackHeight } from '../render/scene.ts';
import { el, formatClock, formatDuration, formatNumber, qsa, setDataset, setText } from './dom.ts';

/**
 * The play screen: board canvas, hold slot, next queue, statistics, status chips and event log.
 *
 * The view is deliberately passive. It builds its DOM once, keeps direct references to the
 * elements it writes to, and updates them through `setText` (a no-op when the string is
 * unchanged) so the per-frame cost of the whole HUD is a handful of comparisons.
 */
export interface PlayViewOptions {
  readonly mode: ModeDefinition;
  readonly rules: RuleSet;
  readonly previewCount: number;
  readonly showTicker: boolean;
  readonly onPause: () => void;
}

export interface HudExtras {
  /** Pieces per second over the whole game. */
  readonly piecesPerSecond: number;
  /** Lines cleared per minute. */
  readonly linesPerMinute: number;
  /** Gravity speed for the current level, in cells per second. */
  readonly speed: number;
  /** Progress inside the current level (0/0 when the level never changes). */
  readonly levelProgress: { readonly intoLevel: number; readonly needed: number };
  /** Whether the current score has passed the stored personal best. */
  readonly recordBeaten: boolean;
}

interface Readout {
  readonly row: HTMLElement;
  readonly value: HTMLElement;
}

const TICKER_LIMIT = 6;

export class PlayView {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly boardHost: HTMLElement;
  /**
   * The grid cell that offers space to the board. Its size comes from the `.play` grid
   * (`minmax(0, 1fr)`) rather than from the canvas, which is what makes it safe to measure:
   * `boardHost` wraps the canvas and shrink-wraps to whatever the canvas was last sized to.
   */
  readonly boardArea: HTMLElement;
  readonly touchPad: HTMLElement;
  readonly pauseButton: HTMLButtonElement;

  private readonly options: PlayViewOptions;
  private readonly holdTile: PieceTileRenderer;
  private readonly holdCanvas: HTMLCanvasElement;
  private readonly nextTiles: Array<{ canvas: HTMLCanvasElement; renderer: PieceTileRenderer }> = [];
  private readonly nextList: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly chips: HTMLElement;

  private readonly scoreValue: HTMLElement;
  private readonly scoreDelta: HTMLElement;
  private readonly stripScore: HTMLElement;
  private readonly stripLines: HTMLElement;
  private readonly stripLevel: HTMLElement;
  private readonly stripTime: HTMLElement;
  private readonly linesValue: HTMLElement;
  private readonly levelValue: HTMLElement;
  private readonly timeValue: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly ppsValue: HTMLElement;
  private readonly lpmValue: HTMLElement;
  private readonly goalValue: HTMLElement;
  private readonly goalHint: HTMLElement;
  private readonly goalBar: HTMLElement;

  private lastStackHeight = -1;
  private readonly tickerLines: HTMLElement[] = [];

  constructor(options: PlayViewOptions) {
    this.options = options;
    const { mode } = options;

    this.canvas = el('canvas', {
      class: 'board-canvas',
      attrs: {
        role: 'img',
        'aria-label': `${mode.name} playfield, 10 columns wide and 20 rows tall`,
        tabindex: '0',
      },
    });
    this.boardHost = el('div', { class: 'canvas-frame' }, [this.canvas]);

    // Hold slot.
    this.holdCanvas = el('canvas', { class: 'piece-slot__canvas', attrs: { 'aria-hidden': 'true' } });
    this.holdTile = new PieceTileRenderer(this.holdCanvas, { glyphs: false, role: 'hold' });
    const holdPanel = el('div', { class: 'piece-slot piece-slot--hold' }, [
      el('div', { class: 'panel__title', text: 'Hold' }),
      this.holdCanvas,
    ]);

    // Next queue.
    this.nextList = el('div', { class: 'next-list' });
    for (let index = 0; index < options.previewCount; index++) {
      const canvas = el('canvas', { class: 'piece-slot__canvas', attrs: { 'aria-hidden': 'true' } });
      const renderer = new PieceTileRenderer(canvas, { glyphs: false, role: 'queue' });
      this.nextTiles.push({ canvas, renderer });
      this.nextList.appendChild(canvas);
    }
    const nextPanel = el('div', { class: 'piece-slot' }, [
      el('div', { class: 'panel__title', text: 'Next' }),
      this.nextList,
    ]);

    // Statistics.
    this.scoreValue = el('div', { class: 'scoreboard__value num', text: '0' });
    this.scoreDelta = el('div', { class: 'scoreboard__delta', text: '' });
    const statsPanel = el('div', { class: 'panel' }, [
      el('div', { class: 'scoreboard' }, [
        el('div', { class: 'scoreboard__label', text: 'Score' }),
        this.scoreValue,
        this.scoreDelta,
      ]),
      el('hr', { class: 'rule' }),
      (() => {
        const lines = this.readout('Lines');
        this.linesValue = lines.value;
        const level = this.readout('Level');
        this.levelValue = level.value;
        const time = this.readout('Time');
        this.timeValue = time.value;
        return el('div', {}, [lines.row, level.row, time.row]);
      })(),
    ]);

    const ratePanel = el('div', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('span', { class: 'panel__title', text: 'Rate' })]),
      (() => {
        const speed = this.readout('Speed');
        this.speedValue = speed.value;
        const pps = this.readout('Pieces/s');
        this.ppsValue = pps.value;
        const lpm = this.readout('Lines/min');
        this.lpmValue = lpm.value;
        return el('div', {}, [speed.row, pps.row, lpm.row]);
      })(),
    ]);

    this.ticker = el('div', { class: 'ticker' });
    const tickerPanel = el('div', { class: 'panel panel--ticker' }, [
      el('div', { class: 'panel__head' }, [el('span', { class: 'panel__title', text: 'Log' })]),
      this.ticker,
    ]);

    // Goal / clock.
    this.goalValue = el('div', { class: 'num', text: '—' });
    this.goalHint = el('p', { class: 'hint', text: '' });
    this.goalBar = el('div', { class: 'progress__fill' });
    const goalPanel = el('div', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [
        el('span', { class: 'panel__title', text: mode.goal.kind === 'time' ? 'Clock' : 'Goal' }),
      ]),
      this.goalValue,
      el('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-label': 'Mode progress' } }, [this.goalBar]),
      this.goalHint,
    ]);

    this.chips = el('div', { class: 'status-chips' });
    const boardColumn = el('div', { class: 'play__board' }, [this.boardHost, this.chips]);
    this.boardArea = boardColumn;

    // Compact strip for small screens.
    this.stripScore = el('span', { class: 'num', text: '0' });
    this.stripLines = el('span', { class: 'num', text: '0' });
    this.stripLevel = el('span', { class: 'num', text: '1' });
    this.stripTime = el('span', { class: 'num', text: '0:00' });
    const hudStrip = el('div', { class: 'hud-strip' }, [
      this.stripItem('Score', this.stripScore),
      this.stripItem('Lines', this.stripLines),
      this.stripItem('Level', this.stripLevel),
      el('span', { class: 'hud-strip__item' }, [this.stripTime]),
    ]);

    // Touch controls.
    this.touchPad = el('div', { class: 'play__touch touch-pad', attrs: { 'aria-label': 'Touch controls' } }, [
      this.touchKey('left', '◀', 'Left'),
      this.touchKey('right', '▶', 'Right'),
      this.touchKey('rotateCCW', '↺', 'Rotate left'),
      this.touchKey('rotateCW', '↻', 'Rotate right'),
      this.touchKey('hold', 'H', 'Hold'),
      this.touchKey('softDrop', '▼', 'Soft drop'),
      this.touchKey('hardDrop', '⤓', 'Hard drop'),
      this.touchKey('pause', '❚❚', 'Pause'),
    ]);

    this.pauseButton = el('button', {
      class: 'btn',
      type: 'button',
      text: 'Pause',
      attrs: { 'aria-keyshortcuts': 'Escape' },
    });
    this.pauseButton.addEventListener('click', () => options.onPause());

    this.element = el('section', { class: 'screen play', attrs: { 'aria-label': `${mode.name} game` } }, [
      hudStrip,
      el('div', { class: 'play__rail play__rail--left' }, [statsPanel, holdPanel, tickerPanel]),
      boardColumn,
      el('div', { class: 'play__rail play__rail--right' }, [goalPanel, nextPanel, ratePanel]),
      this.touchPad,
    ]);
  }

  get firstFocus(): HTMLElement {
    return this.canvas;
  }

  /** The status-chip row, exposed so the session can reserve its height when sizing the board. */
  get chipsRow(): HTMLElement {
    return this.chips;
  }

  /** Sizes the piece tiles to the space their rails give them. */
  layout(dpr: number): void {
    const railWidth = this.nextList.parentElement?.clientWidth ?? 96;
    const holdWidth = Math.max(48, Math.min(160, this.holdCanvas.parentElement?.clientWidth ?? railWidth));
    this.holdTile.resize(holdWidth, holdWidth * 0.7, dpr, holdWidth * 0.24);

    const rowLayout = globalThis.matchMedia('(max-width: 960px)').matches;
    const listWidth = this.nextList.clientWidth || 320;
    const nextWidth = rowLayout
      ? Math.max(34, Math.min(84, listWidth / this.nextTiles.length - 6))
      : Math.max(48, Math.min(150, railWidth));
    for (const tile of this.nextTiles) {
      tile.renderer.resize(nextWidth, rowLayout ? nextWidth : nextWidth * 0.62, dpr, nextWidth * 0.26);
    }
  }

  update(snapshot: GameSnapshot, extras: HudExtras): void {
    setText(this.scoreValue, formatNumber(snapshot.score));
    setText(this.stripScore, formatNumber(snapshot.score));
    setText(this.stripLines, formatNumber(snapshot.lines));
    setText(this.stripLevel, String(snapshot.level));
    setText(this.linesValue, formatNumber(snapshot.lines));
    setText(
      this.levelValue,
      extras.levelProgress.needed > 0
        ? `${snapshot.level} · ${extras.levelProgress.intoLevel}/${extras.levelProgress.needed}`
        : String(snapshot.level),
    );
    setText(this.timeValue, formatDuration(snapshot.elapsedMs));
    setText(
      this.stripTime,
      snapshot.remainingMs !== null ? formatClock(snapshot.remainingMs) : formatClock(snapshot.elapsedMs),
    );
    setText(this.speedValue, `${extras.speed.toFixed(1)} c/s`);
    setText(this.ppsValue, extras.piecesPerSecond.toFixed(2));
    setText(this.lpmValue, extras.linesPerMinute.toFixed(1));

    this.updateGoal(snapshot, extras);
    this.updateChips(snapshot);
    this.updateTiles(snapshot);
    this.updateCanvasLabel(snapshot);
  }

  /** Adds one line to the event log and trims the oldest entries. */
  pushTicker(result: LockResult): void {
    if (!this.options.showTicker) return;
    const label = result.perfectClear
      ? 'Perfect clear'
      : result.linesCleared === 0
        ? result.spin === 'none'
          ? 'Lock'
          : clearLabel('none', result.spin)
        : clearLabel(result.clearType, result.spin);
    const line = el('div', { class: 'ticker__line' }, [
      el('span', { text: label }),
      el('span', { class: 'points', text: `+${formatNumber(result.points)}` }),
    ]);
    this.ticker.prepend(line);
    this.tickerLines.unshift(line);
    while (this.tickerLines.length > TICKER_LIMIT) this.tickerLines.pop()?.remove();
  }

  /** Briefly shows the points added by the last lock next to the running total. */
  flashScoreDelta(points: number): void {
    this.scoreDelta.textContent = `+${formatNumber(points)}`;
    this.scoreDelta.style.opacity = '1';
    globalThis.setTimeout(() => {
      this.scoreDelta.style.opacity = '0';
    }, 900);
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }

  private updateGoal(snapshot: GameSnapshot, extras: HudExtras): void {
    const goal = this.options.mode.goal;
    switch (goal.kind) {
      case 'lines': {
        const progress = Math.min(1, snapshot.lines / goal.lines);
        setText(this.goalValue, `${formatNumber(snapshot.lines)} / ${goal.lines}`);
        setText(this.goalHint, progress >= 1 ? 'Complete' : `${goal.lines - snapshot.lines} lines to go`);
        this.goalBar.style.width = `${progress * 100}%`;
        this.goalBar.classList.toggle('progress__fill--ok', progress >= 1);
        break;
      }
      case 'time': {
        const remaining = snapshot.remainingMs ?? 0;
        const progress = 1 - remaining / goal.durationMs;
        setText(this.goalValue, formatClock(remaining));
        setText(this.goalHint, remaining <= 10_000 ? 'Final ten seconds' : 'Score as much as you can');
        this.goalBar.style.width = `${Math.min(100, progress * 100)}%`;
        this.goalBar.classList.toggle('progress__fill--ok', remaining <= 10_000);
        break;
      }
      case 'versus': {
        setText(this.goalValue, extras.recordBeaten ? 'Personal best' : `${formatNumber(snapshot.score)} pts`);
        setText(this.goalHint, 'Clear lines to send garbage');
        this.goalBar.style.width = '0%';
        break;
      }
      default: {
        setText(this.goalValue, extras.recordBeaten ? 'New best' : `${formatNumber(snapshot.score)} pts`);
        setText(this.goalHint, extras.recordBeaten ? 'Keep going' : 'Endless climb');
        const ratio = extras.levelProgress.needed > 0
          ? extras.levelProgress.intoLevel / extras.levelProgress.needed
          : 0;
        this.goalBar.style.width = `${Math.min(100, ratio * 100)}%`;
        this.goalBar.classList.remove('progress__fill--ok');
      }
    }
  }

  private updateChips(snapshot: GameSnapshot): void {
    const wanted: Array<{ key: string; text: string; kind: 'accent' | 'danger' | 'plain' }> = [];
    if (snapshot.combo > 1) wanted.push({ key: 'combo', text: `Combo ×${snapshot.combo}`, kind: 'accent' });
    if (snapshot.backToBack) wanted.push({ key: 'b2b', text: 'Back-to-back', kind: 'accent' });
    if (snapshot.pendingGarbage > 0) {
      wanted.push({ key: 'garbage', text: `Incoming ${snapshot.pendingGarbage}`, kind: 'danger' });
    }
    if (snapshot.hold !== null && !snapshot.holdAvailable) {
      wanted.push({ key: 'hold', text: 'Hold used', kind: 'plain' });
    }

    const existing = new Map<string, HTMLElement>();
    for (const child of qsa<HTMLElement>(this.chips, '.chip')) existing.set(child.dataset.chip ?? '', child);
    for (const [key, element] of existing) {
      if (!wanted.some((item) => item.key === key)) element.remove();
    }
    for (const item of wanted) {
      const current = existing.get(item.key);
      if (current) {
        setText(current, item.text);
        continue;
      }
      this.chips.appendChild(
        el('span', {
          class: item.kind === 'plain' ? 'chip' : `chip chip--${item.kind}`,
          text: item.text,
          dataset: { chip: item.key },
        }),
      );
    }
  }

  private updateTiles(snapshot: GameSnapshot): void {
    this.holdTile.render(snapshot.hold, { faded: !snapshot.holdAvailable });
    setDataset(this.holdCanvas, 'available', String(snapshot.holdAvailable));
    const previews: (PieceId | null)[] = [...snapshot.queue];
    while (previews.length < this.nextTiles.length) previews.push(null);
    for (let index = 0; index < this.nextTiles.length; index++) {
      const tile = this.nextTiles[index];
      if (tile) tile.renderer.render(previews[index] ?? null);
    }
  }

  private updateCanvasLabel(snapshot: GameSnapshot): void {
    const height = stackHeight(
      snapshot.board.cells,
      snapshot.board.width,
      snapshot.board.height,
      snapshot.board.sliverRows,
    );
    if (height === this.lastStackHeight) return;
    this.lastStackHeight = height;
    const active = snapshot.board.activeId ? `active piece ${snapshot.board.activeId}` : 'no active piece';
    this.canvas.setAttribute(
      'aria-label',
      `Playfield: 10 columns by 20 rows. Stack height ${height}. ${active}. Score ${formatNumber(snapshot.score)}, ${formatNumber(snapshot.lines)} lines, level ${snapshot.level}.`,
    );
  }

  private readout(label: string): Readout {
    const value = el('div', { class: 'readout__value' });
    const row = el('div', { class: 'readout' }, [el('span', { class: 'readout__label', text: label }), value]);
    return { row, value };
  }

  private stripItem(label: string, value: HTMLElement): HTMLElement {
    return el('span', { class: 'hud-strip__item' }, [
      el('span', { class: 'hud-strip__label', text: label }),
      value,
    ]);
  }

  private touchKey(action: string, glyph: string, label: string): HTMLElement {
    return el(
      'button',
      {
        class: action === 'hardDrop' ? 'touch-key touch-key--wide' : 'touch-key',
        type: 'button',
        dataset: { action },
        attrs: { 'aria-label': label },
      },
      [
        el('span', { class: 'touch-key__glyph', text: glyph, attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'touch-key__text', text: label }),
      ],
    );
  }
}
