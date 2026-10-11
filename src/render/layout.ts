import type { BoardLayout } from './draw.ts';
import { defaultMetrics } from './theme.ts';
import type { CellMetrics } from './theme.ts';

/**
 * Responsive geometry for the playfield.
 *
 * The board is the one element whose proportions are fixed (10 × 20 cells with a slice of the
 * hidden row above), so its size is derived from the space the layout offers rather than from
 * CSS percentages: that keeps every cell an exact number of device pixels, so blocks and
 * hairlines stay crisp at any device pixel ratio.
 *
 * The gutter around the well is sized from the cell (`padding ≈ ⅓ cell`) so the printed corner
 * marks always have room outside the frame; time and height are the only inputs, so the same
 * viewport always produces the same board.
 */
export interface GeometryInput {
  /** Space the board may occupy, in CSS pixels. */
  readonly availableWidth: number;
  readonly availableHeight: number;
  readonly cols: number;
  readonly visibleRows: number;
  readonly sliverRows: number;
  readonly dpr: number;
  /** How much of a cell the spawn band shows (0.45 reads as deliberate, not accidental). */
  readonly sliverFraction?: number;
}

export interface PlayfieldGeometry {
  readonly layout: BoardLayout;
  readonly metrics: CellMetrics;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly deviceWidth: number;
  readonly deviceHeight: number;
  readonly dpr: number;
}

export const DEFAULT_SLIVER_FRACTION = 0.45;
const PADDING_RATIO = 0.34;
const MIN_PADDING_DEVICE = 4;
const MIN_CELL_DEVICE = 4;

export function computePlayfieldGeometry(input: GeometryInput): PlayfieldGeometry {
  const dpr = clamp(input.dpr || 1, 1, 4);
  const sliverFraction = clamp(input.sliverFraction ?? DEFAULT_SLIVER_FRACTION, 0, 1);
  const availableWidthDevice = Math.max(0, Math.round(input.availableWidth * dpr));
  const availableHeightDevice = Math.max(0, Math.round(input.availableHeight * dpr));

  // Padding is a function of the cell and the cell is a function of the padding, so settle the
  // pair by iteration (it converges in two passes) and then clamp once more to guarantee fit.
  let paddingDevice = Math.max(MIN_PADDING_DEVICE, Math.round(availableWidthDevice * 0.03));
  let cellDevice = MIN_CELL_DEVICE;
  for (let pass = 0; pass < 4; pass++) {
    cellDevice = cellFor(availableWidthDevice, availableHeightDevice, paddingDevice, input.cols, input.visibleRows, sliverFraction);
    paddingDevice = Math.max(MIN_PADDING_DEVICE, Math.round(cellDevice * PADDING_RATIO));
  }
  cellDevice = Math.min(
    cellDevice,
    cellFor(availableWidthDevice, availableHeightDevice, paddingDevice, input.cols, input.visibleRows, sliverFraction),
  );

  const sliverDevice = Math.max(0, Math.round(cellDevice * sliverFraction));
  const deviceWidth = input.cols * cellDevice + paddingDevice * 2;
  const deviceHeight = sliverDevice + input.visibleRows * cellDevice + paddingDevice * 2;
  const padding = paddingDevice / dpr;
  const cell = cellDevice / dpr;

  return {
    layout: {
      cell,
      sliverHeight: sliverDevice / dpr,
      cols: input.cols,
      visibleRows: input.visibleRows,
      sliverRows: input.sliverRows,
      padding,
    },
    metrics: metricsFor(cell, dpr),
    cssWidth: deviceWidth / dpr,
    cssHeight: deviceHeight / dpr,
    deviceWidth,
    deviceHeight,
    dpr,
  };
}

function cellFor(
  availableWidthDevice: number,
  availableHeightDevice: number,
  paddingDevice: number,
  cols: number,
  visibleRows: number,
  sliverFraction: number,
): number {
  const innerWidth = Math.max(1, availableWidthDevice - paddingDevice * 2);
  const innerHeight = Math.max(1, availableHeightDevice - paddingDevice * 2);
  const byWidth = innerWidth / cols;
  const byHeight = innerHeight / (visibleRows + sliverFraction);
  return Math.max(MIN_CELL_DEVICE, Math.floor(Math.min(byWidth, byHeight)));
}

/** Cell metrics in CSS pixels, snapped to the device grid. */
function metricsFor(cell: number, dpr: number): CellMetrics {
  const snap = (value: number): number => Math.max(1 / dpr, Math.round(value * dpr) / dpr);
  const base = defaultMetrics(Math.round(cell));
  return {
    size: cell,
    inset: cell >= 22 ? snap(1) : 0,
    chamfer: snap(base.chamfer),
    hairline: snap(1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
