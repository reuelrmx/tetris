import { MODES } from '../../engine/index.ts';
import type { ModeStats, ScoreRecord } from '../../storage/records.ts';
import { button, el, formatDuration, formatNumber } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * Records: per-mode totals and the recent score history, straight out of the records store.
 *
 * The tables are rebuilt whenever the store changes, and the empty state explains how to fill
 * them instead of showing a row of dashes.
 */
export function createRecordsScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  const container = el('div', { class: 'records' });
  const element = el('section', { class: 'screen' }, [
    el('div', { class: 'stack-title' }, [
      el('div', {}, [
        el('h1', { text: 'Records' }),
        el('p', {
          class: 'muted',
          text: 'Scores, statistics and best times stored on this device. Nothing is uploaded.',
        }),
      ]),
      button('Back', { class: 'btn', on: { click: () => context.back() } }),
    ]),
    container,
  ]);

  const render = async (): Promise<void> => {
    while (container.firstChild) container.removeChild(container.firstChild);
    const modes = Object.values(MODES);
    const sections = await Promise.all(
      modes.map(async (mode) => {
        const stats = deps.stats.get(mode.id) ?? (await deps.records.getStats(mode.id));
        const recent = await deps.records.getRecentScores(mode.id, 8);
        return statsSection(mode.name, stats, recent);
      }),
    );
    for (const section of sections) container.appendChild(section);
    if (sections.every((section) => section.dataset.empty === 'true')) {
      container.prepend(
        el('p', {
          class: 'panel',
          text: 'No games recorded yet. Finish a game in any single-player mode and it will appear here.',
        }),
      );
    }
  };

  void render();

  return { element, title: 'Records' };
}

function statsSection(name: string, stats: ModeStats, recent: ScoreRecord[]): HTMLElement {
  const empty = stats.plays === 0;
  const section = el('div', { class: 'records__section', dataset: { empty: String(empty) } }, [
    el('div', { class: 'panel__head' }, [
      el('h2', { class: 'panel__title', text: name }),
      el('span', {
        class: 'faint num',
        text: empty ? 'no games' : `${formatNumber(stats.plays)} games · ${formatDuration(stats.totalTimeMs)} played`,
      }),
    ]),
    el('div', { class: 'records__grid' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Best score' }),
          el('span', { class: 'readout__value readout__value--accent', text: formatNumber(stats.bestScore) }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Most lines' }),
          el('span', { class: 'readout__value', text: formatNumber(stats.bestLines) }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Fastest 40 lines' }),
          el('span', {
            class: 'readout__value',
            text: stats.bestTimeMs === null ? '—' : formatDuration(stats.bestTimeMs),
          }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Average score' }),
          el('span', {
            class: 'readout__value',
            text: stats.plays === 0 ? '—' : formatNumber(stats.totalScore / stats.plays),
          }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Four-line clears' }),
          el('span', { class: 'readout__value', text: formatNumber(stats.quads) }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'T-Spins' }),
          el('span', { class: 'readout__value', text: formatNumber(stats.tspins) }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Perfect clears' }),
          el('span', { class: 'readout__value', text: formatNumber(stats.perfectClears) }),
        ]),
        el('div', { class: 'readout' }, [
          el('span', { class: 'readout__label', text: 'Longest combo' }),
          el('span', { class: 'readout__value', text: stats.maxCombo === 0 ? '—' : `×${stats.maxCombo}` }),
        ]),
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel__head' }, [el('span', { class: 'panel__title', text: 'Recent games' })]),
        el('table', { class: 'table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Score' }),
              el('th', { class: 'num', text: 'Lines' }),
              el('th', { class: 'num', text: 'Time' }),
              el('th', { text: 'Ended by' }),
              el('th', { class: 'num', text: 'Seed' }),
            ]),
          ]),
          el('tbody', {}, recent.length === 0
            ? [el('tr', { dataset: { empty: 'true' } }, [el('td', { attrs: { colspan: '5' }, text: 'No games yet.' })])]
            : recent.map((record) =>
                el('tr', {}, [
                  el('td', { class: 'num', text: formatNumber(record.score) }),
                  el('td', { class: 'num', text: formatNumber(record.lines) }),
                  el('td', { class: 'num', text: formatDuration(record.durationMs) }),
                  el('td', { text: describeEnd(record.reason) }),
                  el('td', { class: 'num', text: String(record.seed) }),
                ]),
              )),
        ]),
      ]),
    ]),
  ]);
  return section;
}

function describeEnd(reason: string): string {
  switch (reason) {
    case 'blockout':
      return 'Block out';
    case 'lockout':
      return 'Lock out';
    case 'goal':
      return 'Goal reached';
    case 'time':
      return 'Time up';
    case 'quit':
      return 'Quit';
    case 'forfeit':
      return 'Forfeited';
    default:
      return reason;
  }
}
