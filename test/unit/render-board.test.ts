import { describe, expect, it } from 'vitest';
import { CELL_BLOCK, CELL_EMPTY } from '../../src/engine/types.ts';
import { boardSize, paintBoardContents, paintPlayfieldBackground } from '../../src/render/draw.ts';
import type { BoardLayout, BoardScene } from '../../src/render/draw.ts';
import { computePlayfieldGeometry } from '../../src/render/layout.ts';
import type { PlayfieldGeometry } from '../../src/render/layout.ts';
import { RasterDrawTarget } from '../../src/render/raster.ts';
import { DEFAULT_THEME_OPTIONS, PALETTE } from '../../src/render/theme.ts';
import type { CellMetrics } from '../../src/render/theme.ts';

/**
 * Row placement on the painted board.
 *
 * `rowToY` measures a scene row from the top of the board *content* (the spawn band), while
 * `frameY` already includes the band's height. Anchoring rows at `frameY + rowToY(...)` therefore
 * double-counts the band and pushes the whole stack down by one band height: with the default
 * 0.45 sliver the bottom row loses 45% of its height to the clip and reads as "sinking into the
 * stage". These tests render through the same software rasterizer the preview tool uses and
 * assert where a block's top edge actually lands, so the anchor cannot drift again unnoticed.
 */
const COLS = 10;
const VISIBLE_ROWS = 20;
const SLIVER_ROWS = 1;

function geometryFor(availableWidth: number, availableHeight: number, dpr: number): PlayfieldGeometry {
  return computePlayfieldGeometry({
    availableWidth,
    availableHeight,
    cols: COLS,
    visibleRows: VISIBLE_ROWS,
    sliverRows: SLIVER_ROWS,
    dpr,
  });
}

function emptyScene(): BoardScene {
  return {
    cols: COLS,
    visibleRows: VISIBLE_ROWS,
    sliverRows: SLIVER_ROWS,
    cells: new Uint8Array((SLIVER_ROWS + VISIBLE_ROWS) * COLS).fill(CELL_EMPTY),
    activeId: null,
    activeCells: [],
    ghostId: null,
    ghostCells: [],
    clearingRows: [],
    clearProgress: 0,
    dangerLevel: 0,
    pendingGarbage: 0,
    dropStreak: null,
    theme: DEFAULT_THEME_OPTIONS,
    dimmed: false,
  };
}

function sceneWithBlock(sceneRow: number, col: number): BoardScene {
  const scene = emptyScene();
  scene.cells[sceneRow * COLS + col] = CELL_BLOCK;
  return scene;
}

/** `emptyScene` with the read-only fields replaced, for the ghost and streak cases. */
function sceneWith(overrides: Partial<Omit<BoardScene, 'cells'>> & { blockAt?: [number, number] }): BoardScene {
  const { blockAt, ...rest } = overrides;
  const base = emptyScene();
  if (blockAt) base.cells[blockAt[0] * COLS + blockAt[1]] = CELL_BLOCK;
  return { ...base, ...rest };
}

function render(geometry: PlayfieldGeometry, scene: BoardScene): RasterDrawTarget {
  const size = boardSize(geometry.layout);
  const target = new RasterDrawTarget(
    Math.ceil(size.width),
    Math.ceil(size.height),
    PALETTE.inkDeep,
  );
  const options = { layout: geometry.layout, metrics: geometry.metrics };
  paintPlayfieldBackground(target, scene, options);
  paintBoardContents(target, scene, options);
  return target;
}

/**
 * First row (in device pixels) at which the painted board differs from an empty one, scanning
 * down the centre of `col` inside the well. Returns null when the column shows nothing.
 */
function firstPaintedRow(geometry: PlayfieldGeometry, scene: BoardScene, col: number): number | null {
  const layout = geometry.layout;
  const size = boardSize(layout);
  const withContent = render(geometry, scene);
  const baseline = render(geometry, emptyScene());
  const x = Math.round(size.frameX + col * layout.cell + layout.cell / 2);
  const startY = Math.floor(size.bandY);
  const endY = Math.ceil(size.bandY + size.bandH + size.frameH);
  for (let y = startY; y < endY; y++) {
    const a = withContent.pixelAt(x, y);
    const b = baseline.pixelAt(x, y);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return y;
  }
  return null;
}

/** True when anything was painted into the gutter below the well's bottom hairline. */
function paintsBelowWell(geometry: PlayfieldGeometry, scene: BoardScene, col: number): boolean {
  const layout = geometry.layout;
  const size = boardSize(layout);
  const withContent = render(geometry, scene);
  const baseline = render(geometry, emptyScene());
  const x = Math.round(size.frameX + col * layout.cell + layout.cell / 2);
  const wellBottom = Math.floor(size.frameY + size.frameH);
  for (let y = wellBottom; y < Math.ceil(size.height); y++) {
    const a = withContent.pixelAt(x, y);
    const b = baseline.pixelAt(x, y);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return true;
  }
  return false;
}

/** True when the given row band differs from the empty board at the centre of `col`. */
function rowBandIsPainted(
  geometry: PlayfieldGeometry,
  scene: BoardScene,
  sceneRow: number,
  col: number,
  fractionOfCell: number,
): boolean {
  const layout = geometry.layout;
  const size = boardSize(layout);
  const withContent = render(geometry, scene);
  const baseline = render(geometry, emptyScene());
  const x = Math.round(size.frameX + col * layout.cell + layout.cell / 2);
  const y = Math.round(size.frameY + (sceneRow - layout.sliverRows) * layout.cell + layout.cell * fractionOfCell);
  const a = withContent.pixelAt(x, y);
  const b = baseline.pixelAt(x, y);
  return a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2];
}

describe('board row placement', () => {
  // dpr 1 keeps the arithmetic in whole CSS pixels, so the expectations below are exact.
  const geometry = geometryFor(320, 640, 1);
  const layout: BoardLayout = geometry.layout;
  const metrics: CellMetrics = geometry.metrics;
  const size = boardSize(layout);
  const firstFieldRow = layout.sliverRows;
  const lastFieldRow = layout.sliverRows + layout.visibleRows - 1;

  it('derives a sane cell size and band', () => {
    expect(layout.cell).toBeGreaterThan(8);
    expect(layout.sliverHeight).toBeGreaterThan(0);
    expect(size.frameY).toBeCloseTo(layout.padding + size.bandH, 6);
    expect(metrics.size).toBeCloseTo(layout.cell, 6);
  });

  it('anchors the top visible row at the top of the well', () => {
    const top = firstPaintedRow(geometry, sceneWithBlock(firstFieldRow, 4), 4);
    expect(top).not.toBeNull();
    // A block is inset by `metrics.inset`, so its plate starts a pixel or two inside the cell.
    expect(Math.abs((top as number) - (size.frameY + metrics.inset))).toBeLessThanOrEqual(2);
  });

  it('anchors the bottom visible row at the last cell of the well', () => {
    const top = firstPaintedRow(geometry, sceneWithBlock(lastFieldRow, 4), 4);
    expect(top).not.toBeNull();
    const expected = size.frameY + (layout.visibleRows - 1) * layout.cell + metrics.inset;
    expect(Math.abs((top as number) - expected)).toBeLessThanOrEqual(2);
  });

  it('paints the bottom row across its full cell height, not just its lower half', () => {
    const scene = sceneWithBlock(lastFieldRow, 4);
    // Just inside the top of the last cell: empty when the stack has sunk by a band height.
    expect(rowBandIsPainted(geometry, scene, lastFieldRow, 4, 0.2)).toBe(true);
    // And still painted near the bottom of the same cell.
    expect(rowBandIsPainted(geometry, scene, lastFieldRow, 4, 0.8)).toBe(true);
  });

  it('keeps every row of a full stack inside the well', () => {
    const scene = emptyScene();
    for (let row = firstFieldRow; row <= lastFieldRow; row++) {
      scene.cells[row * COLS + 2] = CELL_BLOCK;
    }
    // The 20th row is drawn, and the rows above it are all still inside the frame.
    expect(rowBandIsPainted(geometry, scene, lastFieldRow, 2, 0.2)).toBe(true);
    expect(rowBandIsPainted(geometry, scene, firstFieldRow, 2, 0.5)).toBe(true);
    expect(paintsBelowWell(geometry, scene, 2)).toBe(false);
  });

  it('never paints into the gutter below the well', () => {
    expect(paintsBelowWell(geometry, sceneWithBlock(lastFieldRow, 7), 7)).toBe(false);
  });

  it('places the ghost piece on the same grid as locked blocks', () => {
    const scene = sceneWith({ ghostId: 'I', ghostCells: [{ x: 3, y: lastFieldRow }] });
    const top = firstPaintedRow(geometry, scene, 3);
    expect(top).not.toBeNull();
    const expected = size.frameY + (layout.visibleRows - 1) * layout.cell;
    expect(Math.abs((top as number) - expected)).toBeLessThanOrEqual(3);
  });

  it('starts a drop streak at the row it was given', () => {
    const scene = sceneWith({ dropStreak: { x: 5, fromY: firstFieldRow + 4, toY: lastFieldRow } });
    const top = firstPaintedRow(geometry, scene, 5);
    expect(top).not.toBeNull();
    const expected = size.frameY + 4 * layout.cell;
    expect(Math.abs((top as number) - expected)).toBeLessThanOrEqual(2);
  });

  it('holds the row anchor at other device pixel ratios', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const scaled = geometryFor(360, 720, dpr);
      const scaledSize = boardSize(scaled.layout);
      const row = scaled.layout.sliverRows + scaled.layout.visibleRows - 1;
      const top = firstPaintedRow(scaled, sceneWithBlock(row, 4), 4);
      expect(top, `dpr ${dpr}`).not.toBeNull();
      const expected = scaledSize.frameY + (scaled.layout.visibleRows - 1) * scaled.layout.cell;
      // Sub-pixel snapping at fractional dprs can move the edge by a device pixel.
      expect(Math.abs((top as number) - expected), `dpr ${dpr}`).toBeLessThanOrEqual(3);
    }
  });
});
