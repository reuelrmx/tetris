/**
 * DOM helpers.
 *
 * The interface is built with plain elements — no framework, no template language — so these
 * helpers are the whole vocabulary: create, query, update, and the formatting rules for numbers
 * and times that the game shows. Text is always set with `textContent`, never `innerHTML`, so a
 * player-supplied name can never become markup.
 */
export type Child = Node | string | null | undefined | false;

export interface ElementProps {
  readonly class?: string;
  readonly text?: string;
  readonly html?: never;
  readonly id?: string;
  readonly title?: string;
  readonly type?: string;
  readonly value?: string | number;
  readonly dataset?: Record<string, string | number | boolean | undefined>;
  readonly attrs?: Record<string, string | number | boolean | undefined>;
  readonly on?: Partial<{
    [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void;
  }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.id) element.id = props.id;
  if (props.title) element.title = props.title;
  if (props.type && 'type' in element) (element as unknown as { type: string }).type = props.type;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.value !== undefined && 'value' in element) {
    (element as unknown as { value: string }).value = String(props.value);
  }
  if (props.dataset) {
    for (const [key, value] of Object.entries(props.dataset)) {
      if (value === undefined) continue;
      element.dataset[key] = String(value);
    }
  }
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === undefined) continue;
      if (value === false) continue;
      element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (!handler) continue;
      element.addEventListener(type, handler as EventListener);
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function button(label: string, props: ElementProps = {}): HTMLButtonElement {
  const element = el('button', { ...props, type: 'button' });
  if (label) element.textContent = label;
  return element;
}

export function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Clears a container and returns it, for rebuild-on-change lists. */
export function clear(root: HTMLElement): HTMLElement {
  while (root.firstChild) root.removeChild(root.firstChild);
  return root;
}

/** Writes text only when it changed: avoids needless layout work in the per-frame HUD. */
export function setText(element: Element | null, value: string): void {
  if (!element) return;
  if (element.textContent !== value) element.textContent = value;
}

export function setDataset(element: HTMLElement | null, key: string, value: string): void {
  if (!element) return;
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

// ---------------------------------------------------------------- formatting

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(Math.round(value));
}

/** `m:ss.mmm` — precise enough for Sprint, readable enough for a summary line. */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(clamped % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** `m:ss` for countdowns and clocks. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** A signed, one-decimal rate such as `1.4 lines/s`. */
export function formatRate(value: number, unit: string): string {
  return `${value.toFixed(2)} ${unit}`;
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export function formatSpeed(cellsPerSecond: number): string {
  if (cellsPerSecond >= 20) return '20G';
  return `${cellsPerSecond.toFixed(1)} c/s`;
}

// ---------------------------------------------------------------- a11y

let liveRegion: HTMLElement | null = null;

/**
 * Announces text to assistive technology. The game is visual by nature, so every event that a
 * sighted player notices through animation (a quad, a level-up, a top-out) is also spoken.
 */
export function announce(message: string): void {
  liveRegion ??= document.getElementById('live-region');
  if (!liveRegion) return;
  // Re-announcing identical text needs a blank frame in between; browsers ignore it otherwise.
  liveRegion.textContent = '';
  globalThis.setTimeout(() => {
    if (liveRegion) liveRegion.textContent = message;
  }, 60);
}

/** Moves focus without scrolling the page for off-screen focus targets. */
export function focusElement(element: HTMLElement | null): void {
  if (!element) return;
  element.focus({ preventScroll: true });
}

/** Traps Tab inside a dialog and restores focus on close. */
export class FocusTrap {
  private readonly root: HTMLElement;
  private previous: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  activate(initialFocus?: HTMLElement | null): void {
    this.previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.addEventListener('keydown', this.onKeyDown, true);
    const target = initialFocus ?? this.firstFocusable() ?? this.root;
    focusElement(target);
  }

  deactivate(): void {
    this.root.removeEventListener('keydown', this.onKeyDown, true);
    if (this.previous && document.contains(this.previous)) focusElement(this.previous);
    this.previous = null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = this.focusable();
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private focusable(): HTMLElement[] {
    return qsa<HTMLElement>(
      this.root,
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ).filter((element) => !element.hasAttribute('hidden') && element.offsetParent !== null);
  }

  private firstFocusable(): HTMLElement | null {
    return this.focusable()[0] ?? null;
  }
}
