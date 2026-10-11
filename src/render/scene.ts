import { CELL_EMPTY } from '../engine/types.ts';
import type { GameSnapshot } from '../engine/types.ts';
import type { BoardScene } from './draw.ts';
import { DEFAULT_THEME_OPTIONS } from './theme.ts';
import type { ThemeOptions } from './theme.ts';

/**
 * Builds a render scene from an engine snapshot.
 *
 * `PlayerBoardView` already reports *view* coordinates: row 0 is the sliver band above the
 * visible field, rows `sliverRows..height-1` are the 20 visible rows, and cell codes, the active
 * piece, the ghost and flashing rows all share that frame. So this module is a thin, explicit
 * adapter — it exists to keep the renderer from depending on the engine's snapshot type at all.
 */
export interface DropStreak {
  /** Column of the dropped piece's left wall. */
  readonly x: number;
  /** Width in cells. */
  readonly width: number;
  /** View rows the drop travelled between (the top and bottom of the trail). */
  readonly fromY: number;
  readonly toY: number;
}

export interface SceneInputs {
  readonly snapshot: GameSnapshot;
  readonly theme?: ThemeOptions;
  /** 0..1 progress of the line-clear flash. */
  readonly clearProgress?: number;
  readonly dropStreak?: DropStreak | null;
  readonly dimmed?: boolean;
}

export function buildBoardScene(inputs: SceneInputs): BoardScene {
  const { snapshot } = inputs;
  const theme = inputs.theme ?? DEFAULT_THEME_OPTIONS;
  const view = snapshot.board;
  const playing = snapshot.status === 'playing' || snapshot.status === 'paused';

  return {
    cols: view.width,
    visibleRows: view.height - view.sliverRows,
    sliverRows: view.sliverRows,
    cells: view.cells,
    activeId: view.activeId,
    activeCells: view.activeCells,
    ghostId: playing ? view.activeId : null,
    ghostCells: playing ? view.ghostCells : [],
    clearingRows: view.clearingRows,
    clearProgress: inputs.clearProgress ?? 0,
    dangerLevel: dangerLevel(view.cells, view.width, view.height, view.sliverRows),
    pendingGarbage: snapshot.pendingGarbage,
    dropStreak: inputs.dropStreak ?? null,
    theme,
    dimmed: inputs.dimmed ?? false,
  };
}

/**
 * How close the stack is to the top of the field, 0..1. The frame picks up its warning tint
 * from 0.62 upward; below that the field is simply busy.
 */
export function dangerLevel(cells: Uint8Array, cols: number, height: number, sliverRows: number): number {
  const topFilled = topFilledRow(cells, cols, height, sliverRows);
  const visibleRows = height - sliverRows;
  const stackHeight = height - topFilled;
  const softStart = visibleRows * 0.55;
  const range = Math.max(1, visibleRows - softStart);
  return clamp01((stackHeight - softStart) / range);
}

/** Height of the stack in visible rows (0 = empty field). */
export function stackHeight(cells: Uint8Array, cols: number, height: number, sliverRows: number): number {
  return height - topFilledRow(cells, cols, height, sliverRows);
}

function topFilledRow(cells: Uint8Array, cols: number, height: number, sliverRows: number): number {
  for (let row = sliverRows; row < height; row++) {
    const base = row * cols;
    for (let col = 0; col < cols; col++) {
      if ((cells[base + col] ?? CELL_EMPTY) !== CELL_EMPTY) return row;
    }
  }
  return height;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
