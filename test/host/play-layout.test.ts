// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRATA_STANDARD_V1 } from '../../src/engine/index.ts';
import { computePlayfieldGeometry } from '../../src/render/layout.ts';
import {
  bootApp,
  clickButton,
  installAnimationFrameShim,
  installCanvasStubs,
  screenRoot,
  styledSize,
  stubElementSizes,
} from './harness.ts';

/**
 * The board must be sized from the space the layout *offers*, not from the canvas it produced.
 *
 * `.canvas-frame` wraps the canvas and shrink-wraps to it, so measuring that wrapper hands the
 * renderer its own previous output. The geometry always comes out no larger than the space offered,
 * which turns each pass into a reduction: from the canvas's default 300×150 box the stage collapsed
 * to an 80×158 strip — roughly a fifth of the width the screen actually offered — and every window
 * resize or observer callback shrank it again. These tests reproduce that box model faithfully, so
 * a regression shows up as a smaller stage rather than passing silently.
 */

/** What a desktop grid cell really offers the board (`.play` centre column). */
const AREA_WIDTH = 900;
const AREA_HEIGHT = 700;

/** The offer the size stubs report; a test mutates this to simulate a window resize. */
let offeredWidth = AREA_WIDTH;
let offeredHeight = AREA_HEIGHT;
/** The canvas element's default box, before the renderer has written any CSS size. */
const DEFAULT_CANVAS_WIDTH = 300;
const DEFAULT_CANVAS_HEIGHT = 150;

const RULES = STRATA_STANDARD_V1;
const SHAPE = {
  cols: RULES.cols,
  visibleRows: RULES.rows - RULES.hiddenRows,
  sliverRows: 1,
};

function currentDpr(): number {
  return Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
}

/** The stage size the offered space implies — computed independently of the session. */
function expectedGeometry(availableWidth: number, availableHeight: number) {
  return computePlayfieldGeometry({
    availableWidth,
    availableHeight,
    cols: SHAPE.cols,
    visibleRows: SHAPE.visibleRows,
    sliverRows: SHAPE.sliverRows,
    dpr: currentDpr(),
  });
}

function boardCanvas(): HTMLCanvasElement {
  const canvas = screenRoot().querySelector('canvas.board-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('the play screen did not mount a board canvas');
  return canvas;
}

async function startGame(): Promise<HTMLCanvasElement> {
  await bootApp();
  clickButton('Play');
  clickButton('Start'); // Marathon row
  return boardCanvas();
}

describe('play screen board sizing', () => {
  let raf: ReturnType<typeof installAnimationFrameShim>;

  beforeEach(() => {
    vi.resetModules();
    raf = installAnimationFrameShim();
    installCanvasStubs();
    offeredWidth = AREA_WIDTH;
    offeredHeight = AREA_HEIGHT;
    // Model the real box: the grid cell offers a fixed area, while the canvas wrapper reports
    // whatever CSS size the canvas currently has (300×150 until the renderer writes one).
    stubElementSizes((element) => {
      if (element.classList.contains('play__board')) {
        return { width: offeredWidth, height: offeredHeight };
      }
      if (element.classList.contains('canvas-frame')) {
        const canvas = element.querySelector('canvas');
        return {
          width: styledSize(canvas, 'width', DEFAULT_CANVAS_WIDTH),
          height: styledSize(canvas, 'height', DEFAULT_CANVAS_HEIGHT),
        };
      }
      // The chip row is empty at the start of a game, so it reserves no height.
      return { width: 0, height: 0 };
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('sizes the stage from the grid cell it is given', async () => {
    const canvas = await startGame();
    const expected = expectedGeometry(AREA_WIDTH, AREA_HEIGHT);

    expect(expected.cssWidth).toBeGreaterThan(300); // a real stage, not the collapsed strip
    expect(parseFloat(canvas.style.width)).toBeCloseTo(expected.cssWidth, 1);
    expect(parseFloat(canvas.style.height)).toBeCloseTo(expected.cssHeight, 1);
    // The backing store is device-pixel correct for the CSS box it declares.
    expect(canvas.width).toBe(expected.deviceWidth);
    expect(canvas.height).toBe(expected.deviceHeight);
  });

  it('does not shrink when layout runs again against its own output', async () => {
    const canvas = await startGame();
    const expected = expectedGeometry(AREA_WIDTH, AREA_HEIGHT);
    const firstWidth = styledSize(canvas, 'width', 0);

    // Each of these re-runs layout; with the wrapper as the measurement source the board lost
    // size on every pass and settled far below the offer.
    for (let pass = 0; pass < 5; pass++) {
      globalThis.dispatchEvent(new Event('resize'));
      raf.flush(1);
      expect(styledSize(canvas, 'width', 0), `pass ${pass + 1}`).toBeCloseTo(firstWidth, 1);
    }

    expect(firstWidth).toBeCloseTo(expected.cssWidth, 1);
  });

  it('reserves the status-chip row when the chips take up height', async () => {
    vi.resetModules();
    raf = installAnimationFrameShim();
    installCanvasStubs();
    const chipHeight = 28;
    const gap = 12; // matches CHIP_ROW_GAP in src/ui/game-session.ts
    stubElementSizes((element) => {
      if (element.classList.contains('play__board')) {
        return { width: AREA_WIDTH, height: AREA_HEIGHT };
      }
      if (element.classList.contains('status-chips')) {
        return { width: AREA_WIDTH, height: chipHeight, offsetHeight: chipHeight };
      }
      if (element.classList.contains('canvas-frame')) {
        const canvas = element.querySelector('canvas');
        return {
          width: styledSize(canvas, 'width', DEFAULT_CANVAS_WIDTH),
          height: styledSize(canvas, 'height', DEFAULT_CANVAS_HEIGHT),
        };
      }
      return { width: 0, height: 0 };
    });

    const canvas = await startGame();
    const expected = expectedGeometry(AREA_WIDTH, AREA_HEIGHT - chipHeight - gap);

    expect(parseFloat(canvas.style.height)).toBeCloseTo(expected.cssHeight, 1);
    // Sanity: reserving the row must make the stage shorter, not taller.
    expect(expected.cssHeight).toBeLessThan(expectedGeometry(AREA_WIDTH, AREA_HEIGHT).cssHeight);
  });

  it('takes the new space when the window grows, and gives it back when it shrinks', async () => {
    const canvas = await startGame();
    const initial = styledSize(canvas, 'width', 0);

    offeredWidth = 1200;
    offeredHeight = 900;
    globalThis.dispatchEvent(new Event('resize'));
    raf.flush(1);
    const grown = expectedGeometry(1200, 900);
    expect(parseFloat(canvas.style.width)).toBeCloseTo(grown.cssWidth, 1);
    expect(grown.cssWidth).toBeGreaterThan(initial);

    offeredWidth = 420;
    offeredHeight = 500;
    globalThis.dispatchEvent(new Event('resize'));
    raf.flush(1);
    const shrunk = expectedGeometry(420, 500);
    expect(parseFloat(canvas.style.width)).toBeCloseTo(shrunk.cssWidth, 1);
    expect(shrunk.cssWidth).toBeLessThan(grown.cssWidth);
    // Still a playable stage, never the collapsed strip the feedback loop produced.
    expect(shrunk.cssWidth).toBeGreaterThan(180);
  });
});
