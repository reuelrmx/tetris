import { shapeCells } from '../engine/pieces.ts';
import type { GameSnapshot, PieceId } from '../engine/types.ts';
import { CanvasDrawTarget } from './canvas-target.ts';
import { drawPieceTile, drawScene } from './draw.ts';
import type { BoardScene } from './draw.ts';
import { computePlayfieldGeometry } from './layout.ts';
import type { PlayfieldGeometry } from './layout.ts';
import { buildBoardScene } from './scene.ts';
import type { DropStreak } from './scene.ts';
import { DEFAULT_THEME_OPTIONS, PALETTE } from './theme.ts';
import type { ThemeOptions } from './theme.ts';

export interface PaintExtras {
  readonly clearProgress?: number;
  readonly dropStreak?: DropStreak | null;
  readonly dimmed?: boolean;
  readonly theme?: ThemeOptions;
}

/**
 * Owns one playfield canvas: sizing (device-pixel correct), scene building and painting.
 *
 * Sizing is explicit rather than responsive-by-CSS: the renderer is told how much space the
 * board may use and it decides the cell size, writes the canvas backing store and the CSS box,
 * and reports the geometry back so the surrounding layout can reserve exactly that space.
 */
export class PlayfieldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly target: CanvasDrawTarget;
  private geometry: PlayfieldGeometry | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('STRATA needs a 2D canvas context to draw the board');
    this.canvas = canvas;
    this.target = new CanvasDrawTarget(context);
  }

  get currentGeometry(): PlayfieldGeometry | null {
    return this.geometry;
  }

  /** Sizes the board to the largest cell that fits the offered space. */
  resize(availableWidth: number, availableHeight: number, dpr: number, shape: { cols: number; visibleRows: number; sliverRows: number }): PlayfieldGeometry {
    const geometry = computePlayfieldGeometry({
      availableWidth,
      availableHeight,
      cols: shape.cols,
      visibleRows: shape.visibleRows,
      sliverRows: shape.sliverRows,
      dpr,
    });
    this.geometry = geometry;
    this.canvas.width = geometry.deviceWidth;
    this.canvas.height = geometry.deviceHeight;
    this.canvas.style.width = `${geometry.cssWidth}px`;
    this.canvas.style.height = `${geometry.cssHeight}px`;
    return geometry;
  }

  /** Paints a scene that was built elsewhere (used by tests and the preview tool). */
  paint(scene: BoardScene, geometry: PlayfieldGeometry = this.requireGeometry()): void {
    this.prepare(geometry);
    drawScene(this.target, scene, { layout: geometry.layout, metrics: geometry.metrics });
  }

  /** Builds and paints the scene for a snapshot. */
  render(snapshot: GameSnapshot, extras: PaintExtras = {}): void {
    const scene = buildBoardScene({
      snapshot,
      theme: extras.theme,
      clearProgress: extras.clearProgress,
      dropStreak: extras.dropStreak,
      dimmed: extras.dimmed,
    });
    this.paint(scene);
  }

  private prepare(geometry: PlayfieldGeometry): void {
    const context = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.setTransform(geometry.dpr, 0, 0, geometry.dpr, 0, 0);
    context.globalAlpha = 1;
    // The well is opaque; clearing with the ink colour avoids a flash of transparent canvas
    // between the resize and the first painted frame.
    context.fillStyle = inkDeep();
    context.fillRect(0, 0, geometry.cssWidth, geometry.cssHeight);
  }

  private requireGeometry(): PlayfieldGeometry {
    if (!this.geometry) throw new Error('PlayfieldRenderer.resize must be called before painting');
    return this.geometry;
  }
}

export interface PieceTileRendererOptions {
  readonly glyphs?: boolean;
  /** Hold tiles draw the stored piece; queue tiles draw upcoming pieces. */
  readonly role?: 'queue' | 'hold';
}

/**
 * A single-piece canvas for the hold slot and the next queue.
 *
 * Tiles are separate canvases rather than DOM+SVG so the queue can animate (pieces slide in,
 * the next-up tile is larger) without re-implementing the block artwork in CSS.
 */
export class PieceTileRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly target: CanvasDrawTarget;
  private readonly options: PieceTileRendererOptions;
  private cssWidth = 0;
  private cssHeight = 0;
  private cell = 20;

  constructor(canvas: HTMLCanvasElement, options: PieceTileRendererOptions = {}) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('STRATA needs a 2D canvas context to draw piece tiles');
    this.canvas = canvas;
    this.options = options;
    this.target = new CanvasDrawTarget(context);
  }

  resize(width: number, height: number, dpr: number, cell?: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
    this.cell = cell ?? Math.min(width, height);
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const context = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(id: PieceId | null, options: { faded?: boolean } = {}): void {
    const context = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (!id) return;
    const cells = shapeCells(id, 0);
    this.target.save();
    if (options.faded) this.target.alpha(0.32);
    drawPieceTile(this.target, id, cells, {
      width: this.cssWidth,
      height: this.cssHeight,
      cell: this.cell,
      metrics: { size: this.cell, inset: 0, chamfer: 2, hairline: 1 },
      glyphs: this.options.glyphs ?? DEFAULT_THEME_OPTIONS.glyphs,
    });
    this.target.restore();
  }
}

function inkDeep(): string {
  return PALETTE.inkDeep;
}
