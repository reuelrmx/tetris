import { MODE_ORDER, MODES } from '../../engine/index.ts';
import type { ModeDefinition, ModeId } from '../../engine/index.ts';
import { keyLabel } from '../../input/bindings.ts';
import { button, el, formatDuration, formatNumber } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * Mode select.
 *
 * A printed list rather than a grid of cards: each mode gets one row with its name, its rule, its
 * stored best and a start control. Marathon additionally offers a starting level, which is a real
 * setting the engine takes (`GameOptions.startLevel`), not decoration.
 */
export function createModesScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  const rows: HTMLElement[] = [];
  let firstAction: HTMLElement | null = null;

  for (const id of MODE_ORDER) {
    const mode = MODES[id];
    const stats = deps.stats.get(id);
    const best = bestLine(mode, stats);
    const startButton = button(startLabel(mode), {
      class: id === 'versus' ? 'btn' : 'btn btn--primary',
      on: {
        click: () => {
          if (id === 'versus') context.go('versus');
          else context.go('play', { modeId: id, startLevel: deps.settings.marathonStartLevel, seed: null });
        },
      },
    });
    firstAction ??= startButton;

    const extras: HTMLElement[] = [];
    if (id === 'marathon') {
      const select = el('select', { attrs: { 'aria-label': 'Starting level' } });
      for (const level of mode.startLevelChoices) {
        const option = el('option', { text: `Level ${level}` });
        option.value = String(level);
        if (level === deps.settings.marathonStartLevel) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        deps.updateSettings({ marathonStartLevel: Number(select.value) });
      });
      extras.push(el('label', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Start at' }),
        select,
      ]));
    }

    rows.push(
      el('article', { class: 'mode-row' }, [
        el('div', {}, [
          el('h2', { class: 'mode-row__name', text: mode.name }),
          el('div', { class: 'mode-row__tagline', text: mode.tagline }),
        ]),
        el('div', { class: 'mode-row__body' }, [
          el('p', { class: 'mode-row__desc', text: mode.description }),
          el('p', { class: 'mode-row__best', attrs: { 'data-best': id } }, [best]),
        ]),
        el('div', { class: 'mode-row__action' }, [startButton, ...extras]),
      ]),
    );
  }

  const quickPlay = button('Quick play', {
    class: 'btn',
    on: {
      click: () =>
        context.go('play', { modeId: 'marathon', startLevel: deps.settings.marathonStartLevel, seed: null }),
    },
  });

  const element = el('section', { class: 'screen' }, [
    el('div', { class: 'stack-title' }, [
      el('div', {}, [
        el('h1', { text: 'Choose a mode' }),
        el('p', {
          class: 'muted',
          text: 'Every mode runs on the same ruleset: SRS rotation, seven-bag pieces, half a second of lock delay.',
        }),
      ]),
      el('div', { class: 'btn-row' }, [
        button('Controls', { class: 'btn', on: { click: () => context.go('help') } }),
        quickPlay,
      ]),
    ]),
    el('div', { class: 'mode-list' }, rows),
    el('p', {
      class: 'hint',
      text: 'Personal bests are stored on this device. Versus needs the STRATA server or a local one — see the settings screen for the endpoint.',
    }),
  ]);

  return { element, firstFocus: firstAction, title: 'Mode select' };
}

function startLabel(mode: ModeDefinition): string {
  switch (mode.goal.kind) {
    case 'lines':
      return `Sprint ${mode.goal.lines}`;
    case 'time':
      return 'Start 2:00';
    case 'versus':
      return 'Find match';
    default:
      return 'Start';
  }
}

/** One line of stored results, in the mode's own currency. */
function bestLine(mode: ModeDefinition, stats: { bestScore: number; bestLines: number; bestTimeMs: number | null; plays: number } | undefined): string {
  if (!stats || stats.plays === 0) return 'No games recorded yet';
  const parts: string[] = [];
  if (mode.records === 'time' && stats.bestTimeMs !== null) {
    parts.push(`Best ${formatDuration(stats.bestTimeMs)}`);
  } else {
    parts.push(`Best ${formatNumber(stats.bestScore)}`);
  }
  if (mode.goal.kind === 'endless') parts.push(`${formatNumber(stats.bestLines)} lines`);
  parts.push(`${formatNumber(stats.plays)} ${stats.plays === 1 ? 'game' : 'games'}`);
  return parts.join(' · ');
}

/** Rendered key legend reused by the help screen. */
export function bindingRows(bindings: ScreenDeps['settings']['bindings']): HTMLElement {
  const actions = ['moveLeft', 'moveRight', 'softDrop', 'hardDrop', 'rotateCW', 'rotateCCW', 'hold', 'pause', 'restart'] as const;
  const labels: Record<(typeof actions)[number], string> = {
    moveLeft: 'Move left',
    moveRight: 'Move right',
    softDrop: 'Soft drop (+1 point per cell)',
    hardDrop: 'Hard drop (+2 points per cell, locks)',
    rotateCW: 'Rotate clockwise',
    rotateCCW: 'Rotate anticlockwise',
    hold: 'Hold piece (once per piece)',
    pause: 'Pause or resume',
    restart: 'Restart the mode',
  };
  const list = el('div', { class: 'bindings' });
  for (const action of actions) {
    list.appendChild(
      el('div', { class: 'binding' }, [
        el('span', { class: 'binding__action', text: labels[action] }),
        el('span', { class: 'binding__key', text: bindings[action].map(keyLabel).join(' / ') || 'unbound' }),
      ]),
    );
  }
  return list;
}

export function modeByIdOrThrow(id: string): ModeDefinition {
  const mode = MODES[id as ModeId];
  if (!mode) throw new Error(`Unknown mode ${id}`);
  return mode;
}
