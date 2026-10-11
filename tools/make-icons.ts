/**
 * Generates the PNG app icons from the game's own block artwork.
 *
 *   node tools/make-icons.ts
 *
 * Uses the drawing code in `src/render` and the PNG encoder in `src/render/raster.ts`, so the
 * icons are produced by the project itself rather than by an external image tool — and they can
 * never contradict the palette in `src/render/theme.ts`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { drawBlock } from '../src/render/draw.ts';
import { RasterDrawTarget, encodePng } from '../src/render/raster.ts';
import { PALETTE } from '../src/render/theme.ts';

const SIZES = [192, 512, 1024];

/** Four blocks in a square, each in a different piece colour, chamfered like the board art. */
function drawIcon(size: number): RasterDrawTarget {
  const target = new RasterDrawTarget(size, size, PALETTE.inkDeep);
  const inset = Math.round(size * 0.05);
  const gap = Math.round(size * 0.02);
  const half = Math.round((size - inset * 2 - gap) / 2);
  const metrics = { size: half, inset: 0, chamfer: Math.round(half * 0.2), hairline: 1 };
  const colours = [PALETTE.pieces.I, PALETTE.pieces.T, PALETTE.pieces.L, PALETTE.pieces.Z];
  const positions: Array<[number, number]> = [
    [inset, inset],
    [inset + half + gap, inset],
    [inset, inset + half + gap],
    [inset + half + gap, inset + half + gap],
  ];
  positions.forEach(([x, y], index) => {
    drawBlock(target, x, y, half, colours[index] as string, metrics);
  });
  // A hairline border ties the icon to the board frame.
  const border = Math.max(1, Math.round(size * 0.008));
  target.fillRect(inset, inset, half * 2 + gap, border, PALETTE.lineStrong);
  target.fillRect(inset, inset + half * 2 + gap - border, half * 2 + gap, border, PALETTE.lineStrong);
  target.fillRect(inset, inset, border, half * 2 + gap, PALETTE.lineStrong);
  target.fillRect(inset + half * 2 + gap - border, inset, border, half * 2 + gap, PALETTE.lineStrong);
  return target;
}

for (const size of SIZES) {
  const target = drawIcon(size);
  const png = encodePng(target.image, (data) => deflateSync(data, { level: 9 }));
  const file = resolve(`public/icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
