import { CELL_BLOCK, CELL_EMPTY, CELL_GARBAGE } from './types.ts';
import type { Vector } from './types.ts';

/**
 * The playfield grid.
 *
 * Stored as a flat `Uint8Array` in row-major order, row 0 at the top of the hidden buffer
 * and row `rows - 1` at the bottom of the visible field. Cell 0 is empty, 1..7 are the seven
 * tetromino colours, 8 is garbage.
 */
export class Board {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: Uint8Array;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Uint8Array(cols * rows);
  }

  clear(): void {
    this.cells.fill(CELL_EMPTY);
  }

  private index(x: number, y: number): number {
    return y * this.cols + x;
  }

  /** Raw cell code; out-of-bounds reads return 0 so renderers can be sloppy safely. */
  get(x: number, y: number): number {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return CELL_EMPTY;
    return this.cells[this.index(x, y)] as number;
  }

  /** Writes a cell; out-of-bounds writes are ignored. */
  set(x: number, y: number, code: number): void {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    this.cells[this.index(x, y)] = code;
  }

  /**
   * True when a cell can be occupied by a piece: inside the grid horizontally, at or below
   * the top of the grid (a piece may not rise out of the buffer) and currently empty.
   */
  isFree(x: number, y: number): boolean {
    if (x < 0 || x >= this.cols) return false;
    if (y < 0 || y >= this.rows) return false;
    return this.cells[this.index(x, y)] === CELL_EMPTY;
  }

  collides(cells: readonly Vector[]): boolean {
    for (const cell of cells) {
      if (!this.isFree(cell.x, cell.y)) return true;
    }
    return false;
  }

  /** Stamps permanent cells (locked piece or garbage). */
  lock(cells: readonly Vector[], code: number): void {
    for (const cell of cells) this.set(cell.x, cell.y, code);
  }

  /** Rows that are completely filled, ascending. */
  findFullRows(): number[] {
    const full: number[] = [];
    for (let y = 0; y < this.rows; y++) {
      let filled = true;
      for (let x = 0; x < this.cols; x++) {
        if (this.cells[this.index(x, y)] === CELL_EMPTY) {
          filled = false;
          break;
        }
      }
      if (filled) full.push(y);
    }
    return full;
  }

  /** Removes the given rows and compacts everything above them downward. */
  clearRows(rows: readonly number[]): void {
    if (rows.length === 0) return;
    const doomed = new Set(rows);
    let write = this.rows - 1;
    for (let read = this.rows - 1; read >= 0; read--) {
      if (doomed.has(read)) continue;
      if (write !== read) this.copyRow(read, write);
      write--;
    }
    for (let y = write; y >= 0; y--) this.fillRow(y, CELL_EMPTY);
  }

  private copyRow(from: number, to: number): void {
    const src = this.index(0, from);
    const dst = this.index(0, to);
    this.cells.copyWithin(dst, src, src + this.cols);
  }

  private fillRow(y: number, code: number): void {
    this.cells.fill(code, this.index(0, y), this.index(0, y) + this.cols);
  }

  isEmpty(): boolean {
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== CELL_EMPTY) return false;
    }
    return true;
  }

  countBlocks(): number {
    let count = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== CELL_EMPTY) count++;
    }
    return count;
  }

  /** Height of the tallest column measured from the floor, 0 for an empty board. */
  stackHeight(): number {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.cells[this.index(x, y)] !== CELL_EMPTY) return this.rows - y;
      }
    }
    return 0;
  }

  /**
   * Pushes the stack up by `count` rows and inserts garbage at the bottom, leaving a single
   * hole per row in `holeColumn`.
   *
   * Returns `{ ok: false, overflow: true }` when the stack does not fit any more, which the
   * caller turns into a top-out. The board is left untouched in that case.
   */
  insertGarbage(count: number, holeColumn: number): { ok: boolean; overflow: boolean } {
    if (count <= 0) return { ok: true, overflow: false };
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.cells[this.index(x, y)] !== CELL_EMPTY) return { ok: false, overflow: true };
      }
    }
    // Copy rows downward. Ascending order is safe because every source row is read
    // (step y) strictly before it can be clobbered as a destination (step y + count).
    for (let y = 0; y < this.rows - count; y++) {
      this.copyRow(y + count, y);
    }
    for (let y = this.rows - count; y < this.rows; y++) {
      this.fillRow(y, CELL_GARBAGE);
      this.set(holeColumn, y, CELL_EMPTY);
    }
    return { ok: true, overflow: false };
  }

  /**
   * Copies the visible field (rows below `firstVisibleRow`) into `target` in row-major order.
   * `target` must hold `cols * (rows - firstVisibleRow)` entries.
   */
  copyVisibleInto(target: Uint8Array, firstVisibleRow: number): void {
    const visibleRows = this.rows - firstVisibleRow;
    const needed = this.cols * visibleRows;
    if (target.length < needed) {
      throw new RangeError(`copyVisibleInto target too small: need ${needed}, got ${target.length}`);
    }
    target.set(this.cells.subarray(this.index(0, firstVisibleRow), this.index(0, firstVisibleRow) + needed));
  }

  /** Direct read-only access for renderers that want the whole grid. */
  raw(): Uint8Array {
    return this.cells;
  }

  clone(): Board {
    const copy = new Board(this.cols, this.rows);
    copy.cells.set(this.cells);
    return copy;
  }

  /**
   * Tooling helper: loads an ASCII map anchored to the bottom of the grid.
   * `.` empty, `#`/`X` a neutral locked block, `G` garbage, the letters `I J L O S T Z` a
   * coloured block, ` ` ignored. Unknown characters throw so typos fail loudly. `toAscii`
   * round-trips this alphabet exactly, so fixture failures are readable.
   */
  loadFromAscii(rows: readonly string[]): void {
    this.clear();
    const startY = this.rows - rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as string;
      for (let x = 0; x < row.length && x < this.cols; x++) {
        const ch = row[x] as string;
        if (ch === '.' || ch === ' ') continue;
        if (ch === 'G') {
          this.set(x, startY + i, CELL_GARBAGE);
          continue;
        }
        if (ch === '#' || ch === 'X') {
          this.set(x, startY + i, CELL_BLOCK);
          continue;
        }
        const pieceIndex = 'IJLOSTZ'.indexOf(ch.toUpperCase());
        if (pieceIndex < 0) throw new Error(`loadFromAscii: unsupported character ${JSON.stringify(ch)}`);
        this.set(x, startY + i, pieceIndex + 1);
      }
    }
  }

  /** Test helper: renders the bottom `height` rows as ASCII for readable assertions. */
  toAscii(height = this.rows): string[] {
    const out: string[] = [];
    for (let y = this.rows - height; y < this.rows; y++) {
      let line = '';
      for (let x = 0; x < this.cols; x++) {
        const code = this.get(x, y);
        if (code === CELL_EMPTY) line += '.';
        else if (code === CELL_GARBAGE) line += 'G';
        else if (code === CELL_BLOCK) line += '#';
        else line += 'IJLOSTZ'[code - 1] ?? '?';
      }
      out.push(line);
    }
    return out;
  }
}
