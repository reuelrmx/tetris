import { CELL_BLOCK, CELL_EMPTY, CELL_GARBAGE, pieceForCellCode } from '../engine/types.ts';
import type { PieceId, Vector } from '../engine/types.ts';
import { PALETTE, pieceColor } from './theme.ts';
import type { CellMetrics, Palette, ThemeOptions } from './theme.ts';
import { glyphRects, hasGlyph } from './glyphs.ts';

/**
 * The drawing vocabulary.
 *
 * Everything the game draws goes through this narrow interface: rectangles, convex polygons,
 * clipping, translation and an alpha multiplier. `CanvasRenderer` implements it on top of
 * Canvas 2D; `tools/raster.ts` implements it on top of a plain RGBA buffer, which is how the
 * art can be reviewed headlessly with the exact same drawing code.
 */
export interface DrawTarget {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  alpha(value: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  /** `points` is a flat list of x,y pairs describing a convex polygon. */
  fillPolygon(points: readonly number[], color: string): void;
  clipRect(x: number, y: number, w: number, h: number): void;
}

export interface BoardLayout {
  readonly cell: number;
  /** Height of the sliver band drawn above the playfield (0 to hide it). */
  readonly sliverHeight: number;
  readonly cols: number;
  readonly visibleRows: number;
  readonly sliverRows: number;
  readonly padding: number;
}

export interface BoardScene {
  readonly cols: number;
  readonly visibleRows: number;
  readonly sliverRows: number;
  /** Row-major cell codes, starting at the sliver row (row 0 of the array is `sliverRows` above the field). */
  readonly cells: Uint8Array;
  readonly activeId: PieceId | null;
  readonly activeCells: readonly Vector[];
  readonly ghostId: PieceId | null;
  readonly ghostCells: readonly Vector[];
  /** View-space rows currently flashing before they collapse, plus how far the flash has run. */
  readonly clearingRows: readonly number[];
  readonly clearProgress: number;
  /** 0 empty board, 1 stack at the top of the field: tints the frame as a warning. */
  readonly dangerLevel: number;
  readonly pendingGarbage: number;
  readonly dropStreak: { readonly x: number; readonly fromY: number; readonly toY: number } | null;
  readonly theme: ThemeOptions;
  /** Set while the game is paused/over so the board reads as inactive. */
  readonly dimmed: boolean;
}

export function cellColor(code: number): string {
  if (code === CELL_GARBAGE) return PALETTE.garbage;
  if (code === CELL_BLOCK) return PALETTE.block;
  const piece = pieceForCellCode(code);
  return piece ? pieceColor(piece) : PALETTE.line;
}

/** Blends a hex colour towards a target with an alpha factor, as an `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

/** Mixes two hex colours, `amount` 0 = a, 1 = b. */
export function mix(a: string, b: string, amount: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const t = clamp01(amount);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Geometry of the whole board including the sliver band and the frame padding. */
export interface BoardGeometry {
  readonly width: number;
  readonly height: number;
  /** The spawn band: the slice of the hidden rows drawn above the well. */
  readonly bandX: number;
  readonly bandY: number;
  readonly bandH: number;
  /** The well itself: 20 visible rows, framed by a hairline and printed corner marks. */
  readonly frameX: number;
  readonly frameY: number;
  readonly frameW: number;
  readonly frameH: number;
}

/**
 * Board geometry in one place.
 *
 * The spawn band sits *above* the well rather than inside it: a piece entering the field is
 * visible in the band and never overlaps the frame, which keeps the playfield edges exact.
 */
export function boardSize(layout: BoardLayout): BoardGeometry {
  const frameW = layout.cols * layout.cell;
  const frameH = layout.visibleRows * layout.cell;
  const bandH = layout.sliverRows * layout.sliverHeight;
  return {
    width: frameW + layout.padding * 2,
    height: bandH + frameH + layout.padding * 2,
    bandX: layout.padding,
    bandY: layout.padding,
    bandH,
    frameX: layout.padding,
    frameY: layout.padding + bandH,
    frameW,
    frameH,
  };
}

/**
 * Converts a scene row (0 = first sliver row) into a y offset measured from the top of the board
 * *content* — the spawn band, i.e. `geometry.bandY`. It already includes the band height for rows
 * inside the well, so it must not be combined with `geometry.frameY`, which counts the band a
 * second time; use `rowToBoardY` for absolute placement.
 */
export function rowToY(layout: BoardLayout, row: number): number {
  const fieldTop = layout.sliverRows * layout.sliverHeight;
  if (row < layout.sliverRows) return row * layout.sliverHeight;
  return fieldTop + (row - layout.sliverRows) * layout.cell;
}

/**
 * Absolute y of a scene row's top edge inside the board.
 *
 * `rowToY` is relative to the top of the content (the band) while `frameY` is the top of the well
 * and therefore already includes the band's height. Anchoring rows at `frameY + rowToY(...)`
 * double-counts that band and shifts the whole stack down by one band height — with the default
 * 0.45 sliver the bottom row loses 45% of its height to the clip and reads as sinking into the
 * stage. Everything that places a row goes through this helper so the anchor stays single-sourced.
 */
export function rowToBoardY(geometry: BoardGeometry, layout: BoardLayout, row: number): number {
  return geometry.bandY + rowToY(layout, row);
}

// ---------------------------------------------------------------- primitives

/**
 * One block: a chamfered plate with a light top edge and a dark bottom edge. Chamfering the
 * top-left and bottom-right corners keeps stacked minoes readable without outlines or glow.
 */
export function drawBlock(
  target: DrawTarget,
  x: number,
  y: number,
  size: number,
  color: string,
  metrics: CellMetrics,
  opts: { glyph?: string; alpha?: number } = {},
): void {
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.01) return;
  const gap = metrics.inset;
  const chamfer = Math.min(metrics.chamfer, Math.floor(size / 2));
  const x0 = x + gap;
  const y0 = y + gap;
  const x1 = x + size - gap;
  const y1 = y + size - gap;
  const light = mix(color, '#ffffff', 0.28);
  const dark = mix(color, '#000000', 0.28);

  target.save();
  target.alpha(alpha);

  // Plate.
  target.fillPolygon(
    [
      x0 + chamfer, y0,
      x1, y0,
      x1, y1 - chamfer,
      x1 - chamfer, y1,
      x0, y1,
      x0, y0 + chamfer,
    ],
    color,
  );

  // Top and left light edge.
  const thickness = Math.max(1, Math.round(size * 0.1));
  target.fillPolygon([x0 + chamfer, y0, x1, y0, x1, y0 + thickness, x0, y0 + thickness, x0, y0 + chamfer], withAlpha(light, 0.55));
  target.fillPolygon([x0, y0 + chamfer, x0 + thickness, y0 + chamfer, x0 + thickness, y1, x0, y1], withAlpha(light, 0.3));
  // Bottom and right dark edge.
  target.fillPolygon([x0, y1 - thickness, x1 - chamfer, y1 - thickness, x1 - chamfer, y1, x0, y1], withAlpha(dark, 0.45));
  target.fillPolygon([x1 - thickness, y0, x1, y0, x1, y1 - chamfer, x1 - thickness, y1 - chamfer], withAlpha(dark, 0.3));

  if (opts.glyph && hasGlyph(opts.glyph)) {
    const glyphSize = Math.round(size * 0.52);
    const originX = x + (size - glyphSize) / 2;
    const originY = y + (size - glyphSize) / 2;
    for (const rect of glyphRects(opts.glyph, originX, originY, glyphSize)) {
      target.fillRect(rect.x, rect.y, rect.w, rect.h, withAlpha('#0b0e10', 0.55));
    }
  }

  target.restore();
}

/** Outline-only block, used for the ghost piece. */
export function drawGhostBlock(target: DrawTarget, x: number, y: number, size: number, color: string): void {
  const chamfer = Math.max(1, Math.round(size * 0.16));
  const inset = Math.max(0.5, size * 0.06);
  const x0 = x + inset;
  const y0 = y + inset;
  const x1 = x + size - inset;
  const y1 = y + size - inset;
  target.save();
  target.alpha(0.5);
  const outline = Math.max(1, Math.round(size * 0.08));
  // Top edge, right edge, bottom edge and left edge as separate quads; drawing the outline by
  // hand keeps it crisp at every cell size, unlike a stroke with a varying line width.
  target.fillRect(x0 + chamfer, y0, x1 - x0 - chamfer * 2, outline, withAlpha(color, 0.85));
  target.fillRect(x0, y0 + chamfer, outline, y1 - y0 - chamfer, withAlpha(color, 0.85));
  target.fillRect(x0 + chamfer, y1 - outline, x1 - x0 - chamfer * 2, outline, withAlpha(color, 0.6));
  target.fillRect(x1 - outline, y0 + chamfer, outline, y1 - y0 - chamfer, withAlpha(color, 0.6));
  target.restore();
}

// ---------------------------------------------------------------- board

export interface PlayfieldPaintOptions {
  readonly layout: BoardLayout;
  readonly metrics: CellMetrics;
  readonly palette?: Palette;
  /** Draw the vertical/horizontal hairlines inside the well. */
  readonly grid?: boolean;
}

export function paintPlayfieldBackground(target: DrawTarget, scene: BoardScene, options: PlayfieldPaintOptions): void {
  const { layout, palette = PALETTE } = options;
  const size = boardSize(layout);

  target.save();
  // Spawn band: a recessed strip above the well, so pieces entering the field read clearly as
  // "not in play yet". It is separated from the well by the frame's top hairline.
  if (size.bandH > 0) {
    target.fillRect(size.bandX, size.bandY, size.frameW, size.bandH, palette.ink);
    for (let col = 1; col < layout.cols; col++) {
      const x = size.bandX + col * layout.cell;
      target.fillRect(x, size.bandY, 1, size.bandH, withAlpha(palette.line, 0.4));
    }
  }

  // Well surface.
  target.fillRect(size.frameX, size.frameY, size.frameW, size.frameH, palette.inkWell);

  // Grid hairlines, every fifth row slightly stronger to make counting height easier.
  if (options.grid !== false) {
    for (let col = 1; col < layout.cols; col++) {
      const x = size.frameX + col * layout.cell;
      target.fillRect(x, size.frameY, 1, size.frameH, withAlpha(palette.line, 0.55));
    }
    for (let row = 1; row < layout.visibleRows; row++) {
      const strong = row % 5 === 0;
      const y = size.frameY + row * layout.cell;
      target.fillRect(size.frameX, y, size.frameW, 1, withAlpha(strong ? palette.lineStrong : palette.line, strong ? 0.5 : 0.4));
    }
  }

  // Pending-garbage strip along the left inner edge.
  if (scene.pendingGarbage > 0) {
    const rows = Math.min(scene.pendingGarbage, layout.visibleRows);
    const stripHeight = Math.max(3, Math.round((rows / layout.visibleRows) * size.frameH * 0.6));
    target.fillRect(size.frameX + 1, size.frameY, 3, stripHeight, withAlpha(palette.danger, 0.75));
  }

  target.restore();
}

export function paintBoardFrame(target: DrawTarget, scene: BoardScene, options: PlayfieldPaintOptions): void {
  const { layout, palette = PALETTE } = options;
  const size = boardSize(layout);
  const dangerTint = scene.dangerLevel > 0.62 ? (scene.dangerLevel - 0.62) / 0.38 : 0;

  target.save();
  // Hairline frame around the well only. Its top edge doubles as the spawn line.
  target.fillRect(size.frameX, size.frameY, size.frameW, 1, palette.lineStrong);
  target.fillRect(size.frameX, size.frameY + size.frameH - 1, size.frameW, 1, palette.lineStrong);
  target.fillRect(size.frameX, size.frameY, 1, size.frameH, palette.lineStrong);
  target.fillRect(size.frameX + size.frameW - 1, size.frameY, 1, size.frameH, palette.lineStrong);

  if (scene.dimmed) {
    target.fillRect(size.frameX, size.frameY, size.frameW, size.frameH, withAlpha(palette.inkDeep, 0.45));
    if (size.bandH > 0) target.fillRect(size.bandX, size.bandY, size.frameW, size.bandH, withAlpha(palette.inkDeep, 0.45));
  }

  // Printed corner marks, in the gutter just outside the well: a deliberate technical-drawing
  // detail that turns oxide red as the stack approaches the spawn line. Each mark is a small L
  // that hugs its corner without ever entering the playfield.
  const markWeight = 2;
  const markLength = Math.max(4, Math.min(Math.round(layout.padding) - markWeight - 3, Math.round(layout.cell * 0.55)));
  const color = dangerTint > 0 ? mix(palette.lineStrong, palette.danger, dangerTint) : palette.lineStrong;
  const left = size.frameX;
  const right = size.frameX + size.frameW;
  const top = size.frameY;
  const bottom = size.frameY + size.frameH;
  // [horizontal: x, y, w] and [vertical: x, y, h]
  const bars: Array<[number, number, number, number]> = [
    // top-left
    [left - markWeight - markLength, top - markWeight, markLength, markWeight],
    [left - markWeight, top - markWeight - markLength, markWeight, markLength],
    // top-right
    [right, top - markWeight, markLength, markWeight],
    [right, top - markWeight - markLength, markWeight, markLength],
    // bottom-left
    [left - markWeight - markLength, bottom, markLength, markWeight],
    [left - markWeight, bottom, markWeight, markLength],
    // bottom-right
    [right, bottom, markLength, markWeight],
    [right, bottom, markWeight, markLength],
  ];
  for (const [x, y, w, h] of bars) target.fillRect(x, y, w, h, color);
  target.restore();
}

/**
 * Draws one cell of the board. Rows are *scene* rows (0 = the sliver band). A block on a
 * sliver row is drawn as the bottom slice of a full cell, clipped to the band, so a piece
 * entering the field is visible without pretending the hidden row is part of the playfield.
 */
function drawSceneCell(
  target: DrawTarget,
  layout: BoardLayout,
  metrics: CellMetrics,
  geometry: BoardGeometry,
  sceneRow: number,
  col: number,
  options: { color: string; code: number; glyph?: string; alpha?: number },
): void {
  const { frameX, frameY, frameW } = geometry;
  const fieldTop = layout.sliverRows * layout.sliverHeight;
  const x = frameX + col * layout.cell;
  const isSliver = sceneRow < layout.sliverRows;
  if (isSliver) {
    // Reveal only the bottom slice of the block inside the spawn band.
    const bandTop = frameY - fieldTop;
    target.save();
    target.clipRect(frameX, bandTop, frameW, Math.max(1, fieldTop));
    drawBlock(target, x, frameY - layout.cell, layout.cell, options.color, metrics, {
      glyph: options.glyph,
      alpha: 0.8,
    });
    target.restore();
    return;
  }
  const isGarbage = options.code === CELL_GARBAGE;
  drawBlock(target, x, rowToBoardY(geometry, layout, sceneRow), layout.cell, options.color, metrics, {
    glyph: options.glyph,
    alpha: options.alpha ?? (isGarbage ? 0.95 : 1),
  });
}

export function paintBoardContents(target: DrawTarget, scene: BoardScene, options: PlayfieldPaintOptions): void {
  const { layout, metrics, palette = PALETTE } = options;
  const size = boardSize(layout);
  const geometry = size;
  const clearing = new Set(scene.clearingRows);

  target.save();
  // Nothing may draw outside the board surface (spawn band + well), whatever a caller hands us.
  target.clipRect(size.bandX, size.bandY, size.frameW, size.bandH + size.frameH);
  // Cells, including the sliver row so pieces can be seen entering the field.
  for (let row = 0; row < layout.sliverRows + layout.visibleRows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const code = scene.cells[row * layout.cols + col] ?? CELL_EMPTY;
      if (code === CELL_EMPTY) continue;
      const glyph = scene.theme.glyphs ? (pieceForCellCode(code) ?? undefined) : undefined;
      if (clearing.has(row)) {
        // Cleared rows flash towards bone and shrink slightly as they collapse.
        const y = rowToBoardY(size, layout, row);
        const flash = Math.max(0, 1 - scene.clearProgress);
        const scale = 1 - scene.clearProgress * 0.35;
        const shrink = (layout.cell - layout.cell * scale) / 2;
        const x = size.frameX + col * layout.cell;
        target.save();
        target.clipRect(geometry.frameX, geometry.frameY, geometry.frameW, geometry.frameH);
        drawBlock(target, x + shrink, y + shrink, layout.cell * scale, mix(cellColor(code), palette.bone, 0.3 + flash * 0.55), metrics, {
          glyph,
        });
        target.restore();
        continue;
      }
      drawSceneCell(target, layout, metrics, geometry, row, col, { color: cellColor(code), code, glyph });
    }
  }

  // Drop streak: a restrained motion cue from where a hard drop started.
  if (scene.dropStreak) {
    const fromY = rowToBoardY(size, layout, scene.dropStreak.fromY);
    const toY = rowToBoardY(size, layout, scene.dropStreak.toY);
    const x = size.frameX + scene.dropStreak.x * layout.cell;
    const streakColor = scene.activeId ? pieceColor(scene.activeId) : palette.bone;
    for (let i = 0; i < 4; i++) {
      const inset = i;
      target.fillRect(
        x + layout.cell * 0.5 - 0.5 + inset,
        fromY,
        1,
        Math.max(0, toY - fromY),
        withAlpha(streakColor, 0.28 - i * 0.06),
      );
    }
  }

  // Ghost piece.
  if (scene.ghostId) {
    const color = pieceColor(scene.ghostId);
    for (const cell of scene.ghostCells) {
      if (cell.y < layout.sliverRows) continue;
      const x = size.frameX + cell.x * layout.cell;
      const y = rowToBoardY(size, layout, cell.y);
      drawGhostBlock(target, x, y, layout.cell, color);
    }
  }

  // Active piece on top.
  if (scene.activeId) {
    const color = pieceColor(scene.activeId);
    for (const cell of scene.activeCells) {
      if (cell.y < 0) continue;
      drawSceneCell(target, layout, metrics, geometry, cell.y, cell.x, {
        color,
        code: 0,
        glyph: scene.theme.glyphs ? scene.activeId : undefined,
      });
    }
  }

  target.restore();
}

export function drawScene(target: DrawTarget, scene: BoardScene, options: PlayfieldPaintOptions): void {
  paintPlayfieldBackground(target, scene, options);
  paintBoardContents(target, scene, options);
  paintBoardFrame(target, scene, options);
}

// ---------------------------------------------------------------- tiles

export interface TileOptions {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly metrics: CellMetrics;
  readonly glyphs: boolean;
  /** Scale of the piece inside the tile, 1 = as large as fits. */
  readonly scale?: number;
}

/**
 * Draws a piece centred in a tile (used by the next queue and the hold slot). The piece is
 * drawn in its spawn orientation with its own bounding box, so previews look like the piece
 * the player is about to receive.
 */
export function drawPieceTile(target: DrawTarget, id: PieceId, cells: readonly Vector[], options: TileOptions): void {
  const { width, height, cell, metrics, glyphs } = options;
  const scale = options.scale ?? 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  const pieceW = maxX - minX + 1;
  const pieceH = maxY - minY + 1;
  const cellSize = Math.min(cell, (Math.min(width / pieceW, height / pieceH) * 0.86) * scale);
  const offsetX = (width - pieceW * cellSize) / 2 - minX * cellSize;
  const offsetY = (height - pieceH * cellSize) / 2 - minY * cellSize;
  for (const c of cells) {
    drawBlock(target, c.x * cellSize + offsetX, c.y * cellSize + offsetY, cellSize, pieceColor(id), metrics, {
      glyph: glyphs ? id : undefined,
    });
  }
}
