import { ACTIONS, DEFAULT_BINDINGS, cloneBindings, keyLabel, rebind, resetAction } from '../../input/bindings.ts';
import type { ActionId } from '../../input/bindings.ts';
import type { Settings } from '../../storage/settings.ts';
import { button, el } from '../dom.ts';
import type { ScreenContext, ScreenInstance } from '../navigation.ts';
import { confirmDialog } from '../overlay.ts';
import type { ScreenDeps } from './deps.ts';

/**
 * Settings.
 *
 * Sections are plain rows: label on the left, control on the right, hairline between. Rebinding
 * uses a capture mode stepper (click a key, press the new one, Escape cancels) because a free-form
 * text field invites invalid values. Changes apply immediately and are written to localStorage by
 * the host, so a reload cannot lose them.
 */
export function createSettingsScreen(deps: ScreenDeps, context: ScreenContext): ScreenInstance {
  let listening: { action: ActionId; element: HTMLElement; cleanup: () => void } | null = null;

  const bindingGrid = el('div', { class: 'bindings' });
  const renderBindings = (): void => {
    while (bindingGrid.firstChild) bindingGrid.removeChild(bindingGrid.firstChild);
    for (const action of ACTIONS) {
      const codes = deps.settings.bindings[action.id];
      const key = button('', {
        class: 'binding__key',
        dataset: { listening: 'false' },
        attrs: { 'aria-label': `Change binding for ${action.label}` },
        on: {
          click: () => beginListening(action.id, key),
        },
      });
      key.textContent = codes.map(keyLabel).join(' / ') || 'unbound';
      bindingGrid.appendChild(
        el('div', { class: 'binding' }, [
          el('div', {}, [
            el('span', { class: 'binding__action', text: action.label }),
            el('div', { class: 'settings__hint', text: action.hint }),
          ]),
          el('div', { class: 'settings__control' }, [
            key,
            button('Reset', {
              class: 'btn btn--ghost',
              attrs: { 'aria-label': `Reset ${action.label} to its default key` },
              on: {
                click: () => {
                  deps.updateSettings({ bindings: resetAction(deps.settings.bindings, action.id) });
                  renderBindings();
                },
              },
            }),
          ]),
        ]),
      );
    }
  };

  const beginListening = (action: ActionId, element: HTMLButtonElement): void => {
    listening?.cleanup();
    element.dataset.listening = 'true';
    element.textContent = 'Press a key…';
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        cleanup();
        renderBindings();
        return;
      }
      if (event.code === 'Tab') return;
      deps.updateSettings({ bindings: rebind(deps.settings.bindings, action, event.code) });
      cleanup();
      renderBindings();
    };
    const cleanup = (): void => {
      document.removeEventListener('keydown', onKeyDown, true);
      listening = null;
    };
    document.addEventListener('keydown', onKeyDown, true);
    listening = { action, element, cleanup };
  };

  renderBindings();

  // ------------------------------------------------------------ sections

  const timingPresets: Array<{ label: string; das: number; arr: number; note: string }> = [
    { label: 'Guideline', das: 167, arr: 33, note: '167 / 33 ms' },
    { label: 'Fast', das: 133, arr: 17, note: '133 / 17 ms' },
    { label: 'Instant', das: 117, arr: 0, note: '117 / 0 ms' },
  ];

  const element = el('section', { class: 'screen' }, [
    el('div', { class: 'stack-title' }, [
      el('div', {}, [
        el('h1', { text: 'Settings' }),
        el('p', { class: 'muted', text: 'Changes apply immediately and are stored on this device.' }),
      ]),
      button('Back', { class: 'btn', on: { click: () => context.back() } }),
    ]),
    el('div', { class: 'settings' }, [
      // ------------------------------------------------- inputs
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Input' }),
        el('div', { class: 'toggle-row' }, timingPresets.map((preset) =>
          button(preset.label, {
            class:
              deps.settings.dasMs === preset.das && deps.settings.arrMs === preset.arr
                ? 'btn btn--primary'
                : 'btn',
            title: preset.note,
            on: {
              click: () => {
                deps.updateSettings({ dasMs: preset.das, arrMs: preset.arr });
                context.go('settings', undefined, { replace: true });
              },
            },
          }),
        )),
        row(
          'Auto shift (DAS)',
          slider(deps.settings.dasMs, 0, 400, 1, (value) => {
            deps.updateSettings({ dasMs: value });
          }, (value) => `${value} ms`),
          'Delay before a held direction repeats.',
        ),
        row(
          'Repeat rate (ARR)',
          slider(deps.settings.arrMs, 0, 120, 1, (value) => {
            deps.updateSettings({ arrMs: value });
          }, (value) => (value === 0 ? 'instant' : `${value} ms`)),
          'Speed of the repeat after the delay.',
        ),
        row(
          'Soft drop',
          select(
            [
              { value: 'guideline', label: 'Twenty times gravity' },
              { value: 'instant', label: 'Instant' },
            ],
            deps.settings.softDropMode,
            (value) => deps.updateSettings({ softDropMode: value as Settings['softDropMode'] }),
          ),
          'Soft drop never locks the piece by itself.',
        ),
      ]),

      // ------------------------------------------------- board
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Board' }),
        toggle('Ghost piece', deps.settings.ghostPiece, (value) => deps.updateSettings({ ghostPiece: value }), 'Outline at the landing position.'),
        toggle('Grid lines', deps.settings.gridLines, (value) => deps.updateSettings({ gridLines: value }), 'Hairlines inside the well.'),
        toggle(
          'Letter glyphs',
          deps.settings.glyphs,
          (value) => deps.updateSettings({ glyphs: value }),
          'Draw the piece letter in every block: makes the board readable without relying on colour.',
        ),
        toggle(
          'High contrast',
          deps.settings.highContrast,
          (value) => deps.updateSettings({ highContrast: value }),
          'Brighter block edges against the well.',
        ),
        row(
          'Motion',
          select(
            [
              { value: 'system', label: 'Follow system' },
              { value: 'reduce', label: 'Reduce' },
              { value: 'allow', label: 'Allow' },
            ],
            deps.settings.reducedMotion,
            (value) => deps.updateSettings({ reducedMotion: value as Settings['reducedMotion'] }),
          ),
          'Reduce removes the drop trail and the line-clear shrink animation.',
        ),
        toggle('Event log', deps.settings.showTicker, (value) => deps.updateSettings({ showTicker: value }), 'The list of recent clears beside the board.'),
      ]),

      // ------------------------------------------------- audio
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Audio' }),
        toggle('Mute everything', deps.settings.muted, (value) => deps.updateSettings({ muted: value })),
        row(
          'Effects',
          slider(deps.settings.sfxVolume, 0, 1, 0.05, (value) => deps.updateSettings({ sfxVolume: value }), (value) =>
            `${Math.round(value * 100)}%`,
          ),
        ),
        row(
          'Music',
          slider(deps.settings.musicVolume, 0, 1, 0.05, (value) => deps.updateSettings({ musicVolume: value }), (value) =>
            value === 0 ? 'off' : `${Math.round(value * 100)}%`,
          ),
          'A slow generated piece. Off by default.',
        ),
        el('p', {
          class: 'hint',
          text: 'Sounds are generated in the browser — the game ships no audio files. Browsers only allow audio after a click or key press, so the first sound waits for your first input.',
        }),
      ]),

      // ------------------------------------------------- keys
      el('div', { class: 'settings__section settings__section--wide' }, [
        el('h2', { class: 'panel__title', text: 'Key bindings' }),
        bindingGrid,
        el('div', { class: 'btn-row' }, [
          button('Restore defaults', {
            class: 'btn',
            on: {
              click: () => {
                deps.updateSettings({ bindings: cloneBindings(DEFAULT_BINDINGS) });
                renderBindings();
              },
            },
          }),
        ]),
      ]),

      // ------------------------------------------------- multiplayer
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Multiplayer' }),
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Display name' }),
          input(deps.settings.playerName, 'text', 'Anonymous', (value) => deps.updateSettings({ playerName: value })),
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'WebSocket endpoint' }),
          input(deps.settings.versusEndpoint, 'text', 'Same origin (ws://…/ws)', (value) =>
            deps.updateSettings({ versusEndpoint: value }),
          ),
        ]),
        el('p', {
          class: 'hint',
          text: 'Leave the endpoint empty to use the server that served this page. The name is only sent when you join a match, and no account is created.',
        }),
        el('p', { class: 'hint', id: 'mp-status', text: deps.multiplayer.status() }),
      ]),

      // ------------------------------------------------- data
      el('div', { class: 'settings__section' }, [
        el('h2', { class: 'panel__title', text: 'Data' }),
        el('p', {
          class: 'hint',
          text: `Records and statistics are stored in ${deps.records.kind === 'indexeddb' ? 'IndexedDB' : deps.records.kind === 'localstorage' ? 'localStorage' : 'memory (this session only)'} on this device.`,
        }),
        el('div', { class: 'btn-row' }, [
          button('Clear records and statistics', {
            class: 'btn btn--danger',
            on: {
              click: async () => {
                const confirmed = await confirmDialog(deps.overlays, {
                  title: 'Clear stored records?',
                  message: 'Every score, statistic and personal best on this device will be deleted. Settings and key bindings are kept.',
                  confirmLabel: 'Delete records',
                  danger: true,
                });
                if (!confirmed) return;
                await deps.records.clearAll();
                await deps.refreshStats();
                deps.toasts.show('Records cleared', 'ok');
                context.go('settings', undefined, { replace: true });
              },
            },
          }),
          button('Reset settings and keys', {
            class: 'btn',
            on: {
              click: async () => {
                const confirmed = await confirmDialog(deps.overlays, {
                  title: 'Reset settings?',
                  message: 'Key bindings, input timing, audio and display options return to their defaults.',
                  confirmLabel: 'Reset settings',
                });
                if (!confirmed) return;
                deps.updateSettings({ ...DEFAULT_SETTINGS_PATCH });
                deps.toasts.show('Settings reset', 'ok');
                context.go('settings', undefined, { replace: true });
              },
            },
          }),
        ]),
      ]),
    ]),
  ]);

  return { element, title: 'Settings', destroy: () => listening?.cleanup() };
}

const DEFAULT_SETTINGS_PATCH: Partial<Settings> = {
  bindings: cloneBindings(DEFAULT_BINDINGS),
  dasMs: 167,
  arrMs: 33,
  softDropMode: 'guideline',
  ghostPiece: true,
  gridLines: true,
  glyphs: false,
  highContrast: false,
  showTicker: true,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  muted: false,
  reducedMotion: 'system',
};

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el('div', { class: 'settings__row' }, [
    el('div', { class: 'settings__label' }, [
      el('span', { text: label }),
      hint ? el('span', { class: 'settings__hint', text: hint }) : null,
    ]),
    el('div', { class: 'settings__control' }, [control]),
  ]);
}

function toggle(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
  hint?: string,
): HTMLElement {
  const checkbox = el('input', { type: 'checkbox', attrs: { 'aria-label': label } }) as HTMLInputElement;
  checkbox.checked = value;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  return row(label, el('label', { class: 'toggle' }, [checkbox]), hint);
}

function select(
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const element = el('select');
  for (const option of options) {
    const node = el('option', { text: option.label });
    node.value = option.value;
    if (option.value === value) node.selected = true;
    element.appendChild(node);
  }
  element.addEventListener('change', () => onChange(element.value));
  return element;
}

function slider(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
  format: (value: number) => string,
): HTMLElement {
  const range = el('input', { type: 'range' }) as HTMLInputElement;
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  const readout = el('span', { class: 'num', text: format(value) });
  range.addEventListener('input', () => {
    readout.textContent = format(Number(range.value));
  });
  range.addEventListener('change', () => onChange(Number(range.value)));
  return el('div', { class: 'slider' }, [range, readout]);
}

function input(value: string, type: string, placeholder: string, onInput: (value: string) => void): HTMLInputElement {
  const element = el('input', { type }) as HTMLInputElement;
  element.value = value;
  element.placeholder = placeholder;
  element.autocomplete = 'off';
  element.maxLength = 16;
  element.addEventListener('change', () => onInput(element.value.trim()));
  return element;
}
