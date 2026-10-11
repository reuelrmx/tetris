import { MODES } from '../../engine/index.ts';
import type { GameSummary, ModeDefinition } from '../../engine/index.ts';
import { GameSession, nextSeed } from '../game-session.ts';
import { attachTouchPad } from '../../input/touch.ts';
import { button, el, formatDuration, formatNumber } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * The play screen.
 *
 * Owns one `GameSession`, the pause overlay and the summary overlay, and writes finished games to
 * the records store. It also decides what "restart" means per mode: a fresh seed every time, with
 * the option to replay the exact same seed from the summary — which is only meaningful because the
 * engine is deterministic from its seed.
 */
export interface PlayParams {
  readonly modeId: string;
  readonly startLevel?: number;
  /** A specific seed, or null for a fresh one. */
  readonly seed?: number | null;
}

export function createPlayScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  const params = (context.params ?? {}) as PlayParams;
  const mode: ModeDefinition = MODES[params.modeId as keyof typeof MODES] ?? MODES.marathon;
  let seed = params.seed ?? nextSeed();
  let session: GameSession | null = null;
  let pausedByOverlay = false;
  let finished = false;

  const element = el('section', { class: 'screen' });
  const mount = (freshSeed: number): void => {
    seed = freshSeed;
    session?.dispose();
    removeTouchPad();
    while (element.firstChild) element.removeChild(element.firstChild);
    const best = deps.stats.get(mode.id)?.bestScore ?? 0;
    session = new GameSession({
      mode,
      seed,
      startLevel: params.startLevel ?? (mode.id === 'marathon' ? deps.settings.marathonStartLevel : undefined),
      settings: deps.settings,
      audio: deps.audio,
      router: deps.router,
      keyboard: deps.keyboard,
      personalBest: best,
      callbacks: {
        onRequestPause: () => togglePause(),
        onFinished: (summary, record) => void onFinished(summary, record),
      },
    });
    element.appendChild(session.view.element);
    attachTouchPadToView(session.view.touchPad);
    session.start();
  };

  // ---------------------------------------------------------------- touch pad

  const padHandles: Array<{ destroy(): void }> = [];
  const removeTouchPad = (): void => {
    for (const handle of padHandles.splice(0)) handle.destroy();
  };
  const attachTouchPadToView = (pad: HTMLElement): void => {
    padHandles.push(attachTouchPad(pad, deps.router));
  };

  // ---------------------------------------------------------------- pause

  const togglePause = (): void => {
    const current = session;
    if (!current || finished) return;
    if (current.isPaused) {
      deps.overlays.close();
      current.setPaused(false);
      pausedByOverlay = false;
      return;
    }
    current.setPaused(true);
    pausedByOverlay = true;
    const overlay = deps.overlays.open({
      title: 'Paused',
      subtitle: mode.name,
      onClose: () => {
        if (pausedByOverlay) {
          pausedByOverlay = false;
          session?.setPaused(false);
        }
      },
    });
    const snapshot = current.snapshot;
    overlay.body.append(
      el('div', { class: 'readout' }, [
        el('span', { class: 'readout__label', text: 'Score' }),
        el('span', { class: 'readout__value readout__value--big', text: formatNumber(snapshot.score) }),
      ]),
      el('div', { class: 'readout' }, [
        el('span', { class: 'readout__label', text: 'Lines' }),
        el('span', { class: 'readout__value', text: formatNumber(snapshot.lines) }),
      ]),
      el('div', { class: 'readout' }, [
        el('span', { class: 'readout__label', text: 'Level' }),
        el('span', { class: 'readout__value', text: String(snapshot.level) }),
      ]),
      el('div', { class: 'readout' }, [
        el('span', { class: 'readout__label', text: 'Time' }),
        el('span', { class: 'readout__value', text: formatDuration(snapshot.elapsedMs) }),
      ]),
      el('hr', { class: 'rule' }),
      el('div', { class: 'btn-row' }, [
        quickToggle('Ghost', deps.settings.ghostPiece, (value) => {
          deps.updateSettings({ ghostPiece: value });
        }),
        quickToggle('Glyphs', deps.settings.glyphs, (value) => deps.updateSettings({ glyphs: value })),
        quickToggle('Grid', deps.settings.gridLines, (value) => deps.updateSettings({ gridLines: value })),
        quickToggle('Sound', !deps.settings.muted, (value) => deps.updateSettings({ muted: !value })),
      ]),
    );
    const resume = button('Resume', {
      class: 'btn btn--primary',
      on: {
        click: () => {
          deps.overlays.close();
        },
      },
    });
    overlay.footer.append(
      button('Quit to modes', {
        class: 'btn',
        on: {
          click: () => {
            deps.overlays.close();
            session?.dispose();
            context.reset('modes');
          },
        },
      }),
      button('Restart', {
        class: 'btn',
        on: {
          click: () => {
            deps.overlays.close();
            startFresh();
          },
        },
      }),
      resume,
    );
    overlay.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        deps.overlays.close();
      } else if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        deps.overlays.close();
      }
    });
  };

  const startFresh = (freshSeed = nextSeed()): void => {
    finished = false;
    pausedByOverlay = false;
    deps.overlays.close();
    deps.router.setEnabled(true);
    mount(freshSeed);
  };

  // ---------------------------------------------------------------- summary

  const onFinished = async (summary: GameSummary, record: boolean): Promise<void> => {
    if (finished) return;
    finished = true;
    pausedByOverlay = false;
    deps.router.setEnabled(true);
    await deps.records.recordGame(mode.id, summary);
    await deps.refreshStats();
    const best = deps.stats.get(mode.id);
    showSummary(summary, record, best?.bestScore ?? summary.score);
  };

  const showSummary = (summary: GameSummary, record: boolean, best: number): void => {
    const won = summary.result === 'won';
    const overlay = deps.overlays.open({
      title: won ? `${mode.name} complete` : 'Game over',
      subtitle: record ? 'Personal best' : mode.name,
      blocking: true,
      wide: true,
    });

    overlay.body.append(
      el('div', { class: 'result-headline' }, [
        el('span', { class: 'result-headline__score', text: formatNumber(summary.score) }),
        el('span', { class: 'eyebrow', text: record ? 'New personal best' : `Best ${formatNumber(best)}` }),
      ]),
      el('div', { class: 'result-grid' }, [
        resultLine('Lines', formatNumber(summary.lines)),
        resultLine('Level', String(summary.level)),
        resultLine('Time', formatDuration(summary.durationMs)),
        resultLine('Pieces', formatNumber(summary.stats.piecesPlaced)),
        resultLine('Pieces/s', summary.piecesPerSecond.toFixed(2)),
        resultLine('Lines/min', summary.linesPerMinute.toFixed(1)),
        resultLine('Four-line clears', formatNumber(summary.stats.quads)),
        resultLine('T-Spins', formatNumber(summary.stats.tspins + summary.stats.miniTspins)),
        resultLine('Perfect clears', formatNumber(summary.stats.perfectClears)),
        resultLine('Longest combo', summary.stats.maxCombo === 0 ? '—' : `×${summary.stats.maxCombo}`),
        resultLine('Holds', formatNumber(summary.stats.holds)),
        resultLine('Ended by', describeEnd(summary.reason)),
      ]),
      el('p', {
        class: 'hint',
        text: `Seed ${summary.seed}. The same seed and the same inputs always produce the same game — retry with this seed replays the piece order exactly.`,
      }),
    );

    overlay.footer.append(
      button('Back to modes', {
        class: 'btn',
        on: {
          click: () => {
            deps.overlays.close();
            context.reset('modes');
          },
        },
      }),
      button('Replay seed', {
        class: 'btn',
        on: {
          click: () => startFresh(summary.seed),
        },
      }),
      button('Play again', {
        class: 'btn btn--primary',
        on: {
          click: () => startFresh(),
        },
      }),
    );
  };

  // ---------------------------------------------------------------- lifecycle

  const onVisibility = (): void => {
    if (document.hidden && session && !session.isPaused && !finished) {
      session.setPaused(true);
      pausedByOverlay = true;
      deps.toasts.show('Paused — the tab lost focus', 'info', 2000);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  mount(seed);

  return {
    element,
    title: mode.name,
    firstFocus: (session as GameSession | null)?.view.canvas ?? null,
    onEscape: () => {
      if (deps.overlays.isOpen) return false;
      togglePause();
      return true;
    },
    destroy: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      removeTouchPad();
      session?.dispose();
      session = null;
    },
  };
}

function resultLine(label: string, value: string): HTMLElement {
  return el('div', { class: 'result-line' }, [
    el('span', { class: 'result-line__label', text: label }),
    el('span', { class: 'result-line__value', text: value }),
  ]);
}

function quickToggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
  checkbox.checked = value;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  return el('label', { class: 'toggle' }, [checkbox, el('span', { text: label })]);
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
