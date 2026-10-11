/**
 * Headless art preview.
 *
 * Renders the game's own drawing code through the software rasteriser and writes PNGs to
 * `tmp/preview/`. This is the project's visual self-review loop: no browser is involved, but the
 * pixels come from exactly the same scene builder and `DrawTarget` calls the game uses.
 *
 *   node tools/render-preview.ts [outputDirectory]
 *
 * It is a development tool, not part of the shipped app.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';

import { Game, MODES, PIECE_IDS, STRATA_STANDARD_V1, shapeCells } from '../src/engine/index.ts';
import type { GameSnapshot, PieceId } from '../src/engine/index.ts';
import { drawPieceTile, drawScene, boardSize } from '../src/render/draw.ts';
import { computePlayfieldGeometry } from '../src/render/layout.ts';
import { encodePng, RasterDrawTarget } from '../src/render/raster.ts';
import { buildBoardScene } from '../src/render/scene.ts';
import { PALETTE, defaultMetrics } from '../src/render/theme.ts';
import type { DropStreak } from '../src/render/scene.ts';

const OUT_DIR = resolve(process.argv[2] ?? 'tmp/preview');
const CELL_DEVICE = 56;
const PADDING_DEVICE = 6;

interface Shot {
  readonly name: string;
  readonly snapshot: GameSnapshot;
  readonly clearProgress?: number;
  readonly dropStreak?: DropStreak | null;
  readonly dimmed?: boolean;
  readonly glyphs?: boolean;
}

function newGame(seed = 20260101): Game {
  const game = new Game({ rules: STRATA_STANDARD_V1, mode: MODES.marathon, seed, autoStart: false });
  game.start();
  return game;
}

/** A stack with a T-spin slot, a couple of garbage rows and every piece colour on show. */
function midgameGame(): Game {
  const game = newGame(7);
  game.applyScenario({
    board: [
      'ZZ........',
      'ZZ....LLL.',
      'ZZ..SSLLL.',
      'IISS..OO..',
      'G.GG..OO..',
      'GGGG.GGGGG',
    ],
    active: { id: 'T', rotation: 1, x: 4, y: 24 },
    hold: 'S',
  });
  return game;
}

function garbageGame(): Game {
  const game = newGame(11);
  game.applyScenario({
    board: [
      'JJ........',
      'JJ....LLL.',
      'JJ......L.',
      'GGG.GGGGGG',
      'GGGGGGG.GG',
      'GGGG.GGGGG',
    ],
    active: { id: 'L', rotation: 0, x: 3, y: 22 },
  });
  game.queueGarbage(6, 3);
  return game;
}

/**
 * The moment after a spawn: the fresh piece is still in the hidden rows, so only its bottom row
 * shows in the spawn band above the well. This is the shot that catches band-registration bugs.
 */
function spawnGame(seed: number): Game {
  const game = newGame(seed);
  game.applyScenario({ board: ['..........', '.......ZZ.', '..OO...ZZ.', '..OO..SS..'], hold: null });
  return game;
}

function dangerGame(): Game {
  const game = newGame(21);
  game.applyScenario({
    // A realistic near-top-out stack: sixteen rows of mixed clears with the height creeping into
    // the frame's warning band, and a T-spin slot still open on the right.
    board: [
      'TT....SS..',
      'T.....SS..',
      'SS.....T..',
      'SS....TTT.',
      'JJ....T...',
      'JJ...LLL..',
      'JJ...LLL..',
      'II..SS....',
      'II..SS....',
      'Z...ZZ....',
      'ZZ..ZZ.LL.',
      'JJ...OO.L.',
      '.II..OO...',
      'SS..II..T.',
      'SS..II.TTT',
      'JJ.ZZZ.T..',
      'JJ.ZZZ....',
      'IIIIIII.OO',
    ],
    active: { id: 'T', rotation: 1, x: 4, y: 22 },
  });
  return game;
}

function clearingGame(): Game {
  const game = newGame(5);
  game.applyScenario({
    // A two-wide well in the bottom two rows: dropping the O fills it for a double.
    board: ['..........', 'I.......I.', 'IIIIIIII..', 'JJJJJJJJ..'],
    active: { id: 'O', rotation: 0, x: 8, y: 38 },
  });
  game.hardDrop();
  return game;
}

function snapshots(): Shot[] {
  const mid = midgameGame();
  const garbage = garbageGame();
  const spawn = spawnGame(3);
  const danger = dangerGame();
  const clearing = clearingGame();

  return [
    { name: 'board-midgame', snapshot: mid.snapshot() },
    {
      name: 'board-midgame-glyphs',
      snapshot: mid.snapshot(),
      glyphs: true,
    },
    { name: 'board-garbage', snapshot: garbage.snapshot() },
    { name: 'board-spawn', snapshot: spawn.snapshot() },
    { name: 'board-danger', snapshot: danger.snapshot() },
    {
      name: 'board-clearing',
      snapshot: clearing.snapshot(),
      clearProgress: 0.45,
    },
    {
      name: 'board-harddrop',
      snapshot: mid.snapshot(),
      dropStreak: { x: 4, width: 3, fromY: 6, toY: 20 },
    },
    { name: 'board-paused', snapshot: mid.snapshot(), dimmed: true },
  ];
}

function renderBoard(shot: Shot): { width: number; height: number } {
  // Rendered at 1x: the rasteriser fills every pixel anyway, and dpr 1 keeps the preview
  // pixel-identical to what a 1x browser canvas would show.
  const geometry = computePlayfieldGeometry({
    availableWidth: CELL_DEVICE * shot.snapshot.board.width + PADDING_DEVICE * 2,
    availableHeight: CELL_DEVICE * 20 + PADDING_DEVICE * 2,
    cols: shot.snapshot.board.width,
    visibleRows: shot.snapshot.board.height - shot.snapshot.board.sliverRows,
    sliverRows: shot.snapshot.board.sliverRows,
    dpr: 1,
    sliverFraction: 0.45,
  });
  const target = new RasterDrawTarget(geometry.deviceWidth, geometry.deviceHeight, PALETTE.inkDeep);
  const scene = buildBoardScene({
    snapshot: shot.snapshot,
    theme: { glyphs: shot.glyphs ?? false, highContrast: false },
    clearProgress: shot.clearProgress ?? 0,
    dropStreak: shot.dropStreak ?? null,
    dimmed: shot.dimmed ?? false,
  });
  drawScene(target, scene, { layout: geometry.layout, metrics: geometry.metrics });
  writePng(shot.name, target);
  return { width: geometry.deviceWidth, height: geometry.deviceHeight };
}

/** A contact sheet of every piece at three sizes, to review the block artwork itself. */
function renderPieceSheet(): { width: number; height: number } {
  const tile = 132;
  const width = tile * 4;
  const height = tile * 2;
  const target = new RasterDrawTarget(width, height, PALETTE.inkDeep);
  const metrics = defaultMetrics(40);
  const ids: PieceId[] = [...PIECE_IDS];
  ids.forEach((id, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = col * tile;
    const y = row * tile;
    // Frame so the tile boundaries are visible while reviewing spacing.
    target.fillRect(x, y, tile, 1, PALETTE.line);
    target.fillRect(x, y, 1, tile, PALETTE.line);
    target.save();
    target.translate(x, y);
    drawPieceTile(target, id, shapeCells(id, 0), { width: tile, height: tile, cell: 40, metrics, glyphs: false });
    target.restore();
  });
  // The seven colours plus the neutral fixtures, drawn as single blocks for comparison.
  const paletteRow = height - 40;
  const swatches = [
    PALETTE.pieces.I,
    PALETTE.pieces.J,
    PALETTE.pieces.L,
    PALETTE.pieces.O,
    PALETTE.pieces.S,
    PALETTE.pieces.T,
    PALETTE.pieces.Z,
    PALETTE.garbage,
    PALETTE.block,
  ];
  swatches.forEach((color, index) => {
    target.fillRect(index * tile * 0.5 + 4, paletteRow, tile * 0.5 - 8, 32, color);
  });
  writePng('piece-sheet', target);
  return { width, height };
}

function writePng(name: string, target: RasterDrawTarget): void {
  const png = encodePng(target.image, (data) => deflateSync(data, { level: 9 }));
  const file = join(OUT_DIR, `${name}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${target.image.width}x${target.image.height})`);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const shot of snapshots()) renderBoard(shot);
  renderPieceSheet();
  // Frame geometry sanity check: the board frame must fill the canvas exactly.
  const geometry = computePlayfieldGeometry({
    availableWidth: 300,
    availableHeight: 600,
    cols: 10,
    visibleRows: 20,
    sliverRows: 1,
    dpr: 1,
  });
  const size = boardSize(geometry.layout);
  console.log(
    `geometry check: cell=${geometry.layout.cell} padding=${geometry.layout.padding} band=${size.bandH} frameY=${size.frameY} canvas=${size.width}x${size.height} (expected ${geometry.cssWidth}x${geometry.cssHeight})`,
  );
}

main();
