import type { PieceId } from '../engine/types.ts';

/**
 * STRATA's visual identity.
 *
 * Design rules, applied everywhere:
 *
 *  - The chrome is monochrome: warm ink surfaces and bone-coloured text. The *only* saturated
 *    colour on screen belongs to the blocks, so the playfield always reads first.
 *  - One accent (oxide) is reserved for state the player must notice: records, warnings,
 *    focus, and the danger band at the top of the well.
 *  - Hairlines (1px) and printed corner marks, never glow or blur.
 *  - Cells are chamfered on two corners so adjacent minoes stay legible when stacked, and
 *    each cell carries a top highlight and a bottom shadow instead of a drop shadow.
 *
 * The palette is duplicated as CSS custom properties in `src/styles/base.css`; a host test
 * (`test/host/theme-sync.test.ts`) fails if the two ever drift apart.
 */
export interface Palette {
  readonly inkDeep: string;
  readonly ink: string;
  readonly inkRaised: string;
  readonly inkWell: string;
  readonly line: string;
  readonly lineStrong: string;
  readonly bone: string;
  readonly boneDim: string;
  readonly boneFaint: string;
  readonly accent: string;
  readonly accentDim: string;
  readonly danger: string;
  readonly garbage: string;
  readonly garbageEdge: string;
  /** Neutral locked block: fixtures, previews and documentation diagrams. */
  readonly block: string;
  readonly pieces: Readonly<Record<PieceId, string>>;
}

export const PALETTE: Palette = {
  inkDeep: '#0b0e10',
  ink: '#12171a',
  inkRaised: '#181e22',
  inkWell: '#0e1315',
  line: '#2a3237',
  lineStrong: '#3b464d',
  bone: '#e8e5dd',
  boneDim: '#9ba3a6',
  boneFaint: '#666f73',
  accent: '#c9782c',
  accentDim: '#7a4a1c',
  danger: '#b4453c',
  garbage: '#39424a',
  garbageEdge: '#4a555e',
  block: '#5c666d',
  pieces: {
    // Guideline hues (light blue, dark blue, orange, yellow, green, red, magenta), tuned for a
    // dark board: desaturated, mid-lightness, and distinguishable for the most common forms of
    // colour vision deficiency when the glyph option is enabled.
    I: '#4f9dd6',
    J: '#3f63ad',
    L: '#d9862f',
    O: '#dcb941',
    S: '#5f9e58',
    T: '#a45fad',
    Z: '#c9584a',
  },
};

/** Colour-vision option: letter glyphs inside each cell, so shape+letter+colour all agree. */
export const PIECE_GLYPHS: Readonly<Record<PieceId, string>> = {
  I: 'I',
  J: 'J',
  L: 'L',
  O: 'O',
  S: 'S',
  T: 'T',
  Z: 'Z',
};

export interface CellMetrics {
  /** Cell pitch in CSS pixels (includes the seam). */
  readonly size: number;
  /** Inner padding so blocks do not visually touch. */
  readonly inset: number;
  /** Chamfer size for the top-left and bottom-right corners. */
  readonly chamfer: number;
  /** Hairline width, always >= 1 device pixel. */
  readonly hairline: number;
}

export function defaultMetrics(cellSize: number): CellMetrics {
  const size = Math.max(8, Math.round(cellSize));
  return {
    size,
    inset: size >= 22 ? 1 : 0,
    chamfer: Math.max(2, Math.round(size * 0.16)),
    hairline: 1,
  };
}

export interface ThemeOptions {
  /** Draw a letter inside each block (colour-vision assistance). */
  readonly glyphs: boolean;
  /** Fade the playfield backdrop so blocks carry more contrast. */
  readonly highContrast: boolean;
}

export const DEFAULT_THEME_OPTIONS: ThemeOptions = { glyphs: false, highContrast: false };

export function pieceColor(id: PieceId): string {
  return PALETTE.pieces[id];
}
