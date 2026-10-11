import { Game, MODES, STRATA_STANDARD_V1 } from '../engine/index.ts';
import type { PieceId, PiecePlacement } from '../engine/index.ts';
import { PlayfieldRenderer } from '../render/renderer.ts';
import { el } from './dom.ts';
import type { Poster } from '../data/posters.ts';

/**
 * Board figures for the title screen, drawn with the real renderer.
 *
 * Each poster is an ordinary engine scenario, so the artwork in the menu cannot drift away from
 * the artwork in the game. The stack crossfades every few seconds; the caption underneath always
 * names what is on screen, and the canvases are hidden from assistive technology.
 */
export interface PosterOptions {
  readonly caption: string;
  readonly board: readonly string[];
  readonly active: PiecePlacement | null;
  readonly hold: PieceId | null;
}

export interface PosterStackHandle {
  readonly element: HTMLElement;
  destroy(): void;
}

function drawPoster(canvas: HTMLCanvasElement, poster: PosterOptions, cell: number, dpr: number): void {
  const renderer = new PlayfieldRenderer(canvas);
  const game = new Game({ rules: STRATA_STANDARD_V1, mode: MODES.marathon, seed: 1, autoStart: false });
  game.start();
  game.applyScenario({ board: poster.board, active: poster.active, hold: poster.hold });
  renderer.resize(cell * 10 + 8, cell * 21 + 8, dpr, { cols: 10, visibleRows: 20, sliverRows: 1 });
  renderer.render(game.snapshot());
}

export function createPosterStack(
  posters: readonly Poster[],
  dpr: number,
  cell = 22,
  intervalMs = 5200,
): PosterStackHandle {
  const stack = el('div', { class: 'poster-stack', attrs: { 'aria-hidden': 'true' } });
  const frames: HTMLElement[] = [];
  for (const poster of posters) {
    const canvas = el('canvas');
    drawPoster(canvas, poster, cell, dpr);
    const frame = el('div', { class: 'poster-stack__item' }, [canvas]);
    frames.push(frame);
    stack.appendChild(frame);
  }
  frames[0]?.classList.add('is-active');

  const caption = el('div', { class: 'eyebrow', text: posters[0]?.caption ?? '' });
  let active = 0;
  const timer = globalThis.setInterval(() => {
    frames[active]?.classList.remove('is-active');
    active = (active + 1) % Math.max(1, frames.length);
    frames[active]?.classList.add('is-active');
    caption.textContent = posters[active]?.caption ?? '';
  }, intervalMs);

  return {
    element: el('figure', { class: 'menu__figure' }, [stack, el('figcaption', {}, [caption])]),
    destroy: () => globalThis.clearInterval(timer),
  };
}
