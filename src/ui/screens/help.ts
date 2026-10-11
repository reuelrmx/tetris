import { button, el, formatNumber } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import { bindingRows } from './modes.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * How to play: the controls, the scoring table the game actually implements, and the rules that
 * surprise people (lock delay resets, hold once per piece, T-spin detection). The numbers come
 * from `STRATA_STANDARD_V1` and `docs/RULESET.md`, so the screen cannot advertise a rule the
 * engine does not play.
 */
export function createHelpScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  const scoring = el('table', { class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Clear' }),
        el('th', { class: 'num', text: 'Points × level' }),
      ]),
    ]),
    el('tbody', {}, [
      tableRow('Single', 100),
      tableRow('Double', 300),
      tableRow('Triple', 500),
      tableRow('Four-line clear', 800),
      tableRow('T-Spin, no lines', 400),
      tableRow('T-Spin Single', 800),
      tableRow('T-Spin Double', 1200),
      tableRow('T-Spin Triple', 1600),
      tableRow('Mini T-Spin Single', 200),
      tableRow('Mini T-Spin Double', 400),
      tableRow('Back-to-back (difficult clear in a row)', 0, '×1.5'),
      tableRow('Combo (each clear after the first)', 50, '+50 per step'),
      tableRow('Perfect clear, four-line', 2000),
      tableRow('Soft drop', 1, 'per cell'),
      tableRow('Hard drop', 2, 'per cell'),
    ]),
  ]);

  const element = el('section', { class: 'screen' }, [
    el('div', { class: 'stack-title' }, [
      el('div', {}, [
        el('h1', { text: 'How to play' }),
        el('p', {
          class: 'muted',
          text: 'Everything below is what this build implements, not a generic description of the genre.',
        }),
      ]),
      button('Back', { class: 'btn', on: { click: () => context.back() } }),
    ]),
    el('div', { class: 'settings' }, [
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Controls' }),
        bindingRows(deps.settings.bindings),
        el('p', {
          class: 'hint',
          text: 'Bindings can be changed on the settings screen. On touch screens the on-screen pad appears under the board, and dragging on the board moves the piece.',
        }),
      ]),
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Scoring' }),
        scoring,
        el('p', {
          class: 'hint',
          text: 'The level shown before the clear is the one that multiplies it. Drop points are never multiplied.',
        }),
      ]),
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Rules' }),
        el('ul', { class: 'rules-list' }, [
          rule('Well', '10 columns wide, 20 rows tall, with one hidden row shown above the field where pieces appear.'),
          rule('Pieces', 'All seven tetrominoes, dealt in seven-bag order: every piece appears once per bag.'),
          rule('Rotation', 'SRS with the standard wall-kick tables, including the I-piece table.'),
          rule('Lock delay', 'Half a second after a piece lands. Moving or rotating while grounded resets that timer up to fifteen times.'),
          rule('Hold', 'One exchange per piece; the stored piece returns when you press hold again.'),
          rule('Gravity', 'Level 1 starts at one row per second and the curve follows the community-documented formula, capped at level 15 in Marathon.'),
          rule('Top out', 'The game ends if a piece cannot appear, or if a piece locks entirely above the field.'),
          rule('T-Spins', 'Detected with the three-corner rule; a Mini is promoted when the last rotation used a long SRS kick.'),
        ]),
      ]),
    ]),
  ]);

  return { element, title: 'How to play' };
}

function rule(name: string, text: string): HTMLElement {
  return el('li', { class: 'rules-list__item' }, [
    el('span', { class: 'rules-list__name', text: name }),
    el('span', { class: 'rules-list__text', text: text }),
  ]);
}

function tableRow(label: string, value: number, note?: string): HTMLElement {
  return el('tr', {}, [
    el('td', {}, [label, note ? el('span', { class: 'faint', text: ` ${note}` }) : null]),
    el('td', { class: 'num', text: value === 0 ? '—' : formatNumber(value) }),
  ]);
}
