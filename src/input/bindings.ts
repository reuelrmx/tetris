/**
 * Key bindings.
 *
 * Bindings are stored as `KeyboardEvent.code` values (physical keys), not `key` values, so a
 * binding made on a QWERTY keyboard still points at the same physical key on AZERTY — the
 * behaviour competitive players expect.
 */
export type ActionId =
  | 'moveLeft'
  | 'moveRight'
  | 'softDrop'
  | 'hardDrop'
  | 'rotateCW'
  | 'rotateCCW'
  | 'hold'
  | 'pause'
  | 'restart';

export interface ActionMeta {
  readonly id: ActionId;
  readonly label: string;
  readonly hint: string;
  /** Whether holding the key repeats the action (movement) or fires once (rotations). */
  readonly repeat: boolean;
  /** Whether the action is safe to bind to several physical keys by default. */
  readonly multi: boolean;
}

export const ACTIONS: readonly ActionMeta[] = [
  { id: 'moveLeft', label: 'Move left', hint: 'Shift the piece one column left', repeat: true, multi: true },
  { id: 'moveRight', label: 'Move right', hint: 'Shift the piece one column right', repeat: true, multi: true },
  { id: 'softDrop', label: 'Soft drop', hint: 'Push the piece down, scoring 1 point per cell', repeat: false, multi: true },
  { id: 'hardDrop', label: 'Hard drop', hint: 'Slam the piece down and lock it, 2 points per cell', repeat: false, multi: false },
  { id: 'rotateCW', label: 'Rotate clockwise', hint: 'Rotate with SRS wall kicks', repeat: false, multi: true },
  { id: 'rotateCCW', label: 'Rotate anticlockwise', hint: 'Rotate the other way', repeat: false, multi: true },
  { id: 'hold', label: 'Hold', hint: 'Store the piece once per piece', repeat: false, multi: true },
  { id: 'pause', label: 'Pause', hint: 'Pause or resume', repeat: false, multi: true },
  { id: 'restart', label: 'Restart', hint: 'Restart the current mode', repeat: false, multi: false },
];

export type Bindings = Record<ActionId, readonly string[]>;

export const ACTION_ORDER: readonly ActionId[] = ACTIONS.map((action) => action.id);

export const DEFAULT_BINDINGS: Bindings = {
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD'],
  softDrop: ['ArrowDown', 'KeyS'],
  hardDrop: ['Space'],
  rotateCW: ['ArrowUp', 'KeyX'],
  rotateCCW: ['KeyZ', 'ControlLeft', 'ControlRight'],
  hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
};

export function cloneBindings(bindings: Bindings): Bindings {
  const out = {} as Record<ActionId, readonly string[]>;
  for (const id of ACTION_ORDER) out[id] = [...(bindings[id] ?? [])];
  return out;
}

/** Human-readable label for a `KeyboardEvent.code`, for the settings screen. */
export function keyLabel(code: string): string {
  if (!code) return '—';
  const named: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    ShiftLeft: 'Shift (L)',
    ShiftRight: 'Shift (R)',
    ControlLeft: 'Ctrl (L)',
    ControlRight: 'Ctrl (R)',
    AltLeft: 'Alt (L)',
    AltRight: 'Alt (R)',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('F') && code.length <= 3) return code;
  return code;
}

/**
 * A key may only be bound to one action (except the left/right pairs, which are two actions and
 * never share a key in practice). Binding a key that is already used releases it from the old
 * action so the interface can never end up in an ambiguous state.
 */
export function rebind(bindings: Bindings, action: ActionId, code: string): Bindings {
  const next = cloneBindings(bindings);
  for (const id of ACTION_ORDER) {
    if (id === action) continue;
    next[id] = next[id].filter((existing) => existing !== code);
  }
  const kept = next[action].filter((existing) => existing !== code);
  next[action] = [...kept, code];
  return next;
}

export function unbind(bindings: Bindings, action: ActionId, code: string): Bindings {
  const next = cloneBindings(bindings);
  next[action] = next[action].filter((existing) => existing !== code);
  return next;
}

/** Restores the documented defaults for one action only. */
export function resetAction(bindings: Bindings, action: ActionId): Bindings {
  const next = cloneBindings(bindings);
  for (const code of next[action]) {
    for (const id of ACTION_ORDER) {
      if (id === action) continue;
      next[id] = next[id].filter((existing) => existing !== code);
    }
  }
  next[action] = [...DEFAULT_BINDINGS[action]];
  return next;
}

/** Reverse lookup used on every keystroke. */
export function buildLookup(bindings: Bindings): Map<string, ActionId[]> {
  const map = new Map<string, ActionId[]>();
  for (const id of ACTION_ORDER) {
    for (const code of bindings[id]) {
      const list = map.get(code) ?? [];
      list.push(id);
      map.set(code, list);
    }
  }
  return map;
}

/**
 * Validates bindings loaded from disk: every action keeps at least one key, unknown codes are
 * dropped, duplicate assignments are resolved in favour of the first action in `ACTION_ORDER`.
 */
export function sanitiseBindings(input: unknown): Bindings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const claimed = new Set<string>();
  const out = {} as Record<ActionId, readonly string[]>;
  for (const id of ACTION_ORDER) {
    const raw = source[id];
    const codes = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
    const unique = codes.filter((code) => code.length > 0 && !claimed.has(code));
    for (const code of unique) claimed.add(code);
    out[id] = unique.length > 0 ? unique : [...DEFAULT_BINDINGS[id]];
  }
  return out;
}

export function isActionId(value: string): value is ActionId {
  return (ACTION_ORDER as readonly string[]).includes(value);
}
