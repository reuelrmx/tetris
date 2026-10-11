import type { PieceId, PiecePlacement } from '../engine/index.ts';

/**
 * Poster positions used by the title screen.
 *
 * They are ordinary engine scenarios (`Game.applyScenario`), so the menu figure is drawn by the
 * same code path as the game itself: if the rules or the artwork change, the poster changes with
 * them. Each one shows a different aspect of play: a mid-game stack, a T-spin slot, and a
 * near-empty board with an active piece about to drop into a well.
 */
export interface Poster {
  readonly caption: string;
  readonly board: readonly string[];
  readonly active: PiecePlacement | null;
  readonly hold: PieceId | null;
}

export const POSTERS: readonly Poster[] = [
  {
    caption: 'Marathon · level 9',
    board: [
      '..........',
      '...TT.....',
      '...T......',
      '..LL.....S',
      '..LLL..SSS',
      'I..JJJ..S.',
      'II.JJ....',
      'ZZ..OO..L.',
      'ZZ..OO.LLL',
      'IIIIII.L.Z',
    ],
    active: { id: 'T', rotation: 0, x: 3, y: 24 },
    hold: 'I',
  },
  {
    caption: 'T-spin set-up',
    board: [
      '..........',
      '..........',
      '.....ZZ...',
      '.....Z....',
      'SSS..ZZ...',
      'SS.ZZ..OO.',
      'JJ.ZZ..OO.',
      'JJ.SS.....',
      'II.SS.LL..',
      'IIIII.LLZZ',
    ],
    active: { id: 'T', rotation: 1, x: 4, y: 23 },
    hold: 'L',
  },
  {
    caption: 'Sprint · 12 to go',
    board: ['..........', '..........', '..........', '..........', '...ZZ.....', 'SS.ZZ..OO.', 'SS....OO..'],
    active: { id: 'I', rotation: 0, x: 3, y: 30 },
    hold: null,
  },
];
