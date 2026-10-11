/**
 * A tiny built-in bitmap font for the seven tetromino letters.
 *
 * The colour-vision option marks each block with its letter instead of relying on hue alone.
 * Drawing the letters as rectangles (rather than using `fillText`) keeps the renderer free of
 * font dependencies: the game ships no font files for the playfield, the headless preview
 * renderer produces pixel-identical output, and there is no text layout cost per frame.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  L: ['#..', '#..', '#..', '#..', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
};

export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;

export interface GlyphRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Rects for one letter, scaled to `size` (the height of the letter box) and positioned so the
 * glyph is centred inside a `size` × `size` box whose top-left corner is (originX, originY).
 */
export function glyphRects(letter: string, originX: number, originY: number, size: number): GlyphRect[] {
  const rows = GLYPHS[letter.toUpperCase()];
  if (!rows) return [];
  const pixel = Math.max(1, Math.floor(size / GLYPH_HEIGHT));
  const width = GLYPH_WIDTH * pixel;
  const height = GLYPH_HEIGHT * pixel;
  const offsetX = originX + Math.round((size - width) / 2);
  const offsetY = originY + Math.round((size - height) / 2);
  const rects: GlyphRect[] = [];
  for (let row = 0; row < rows.length; row++) {
    const line = rows[row] as string;
    for (let col = 0; col < line.length; col++) {
      if (line[col] === '#') {
        rects.push({ x: offsetX + col * pixel, y: offsetY + row * pixel, w: pixel, h: pixel });
      }
    }
  }
  return rects;
}

export function hasGlyph(letter: string): boolean {
  return GLYPHS[letter.toUpperCase()] !== undefined;
}
