import { announce, clear, focusElement } from './dom.ts';

/**
 * Screen router.
 *
 * Screens are plain functions that build a DOM subtree and return a teardown. Navigation keeps a
 * short back stack so Escape and the browser Back button behave the way players expect, moves
 * focus to the new screen's heading for keyboard and screen-reader users, and announces the
 * screen change.
 */
export interface ScreenContext {
  /** Navigates to a screen by id, optionally replacing the current entry. */
  readonly go: (id: string, params?: unknown, options?: { replace?: boolean }) => void;
  /** Replaces the whole back stack (used to leave a match for the menu). */
  readonly reset: (id: string, params?: unknown) => void;
  readonly back: () => void;
  readonly params: unknown;
}

export interface ScreenInstance {
  readonly element: HTMLElement;
  /** Called when the screen is removed from the DOM. */
  destroy?: () => void;
  /** Called when Escape is pressed while the screen is active; return true if handled. */
  onEscape?: () => boolean;
  /** Element that should receive focus when the screen opens. */
  readonly firstFocus?: HTMLElement | null;
  /** Retitles the top bar (mode name, lobby, …). */
  readonly title?: string;
}

export type ScreenFactory = (context: ScreenContext) => ScreenInstance;

interface Entry {
  readonly id: string;
  readonly params: unknown;
}

export interface NavigationOptions {
  readonly root: HTMLElement;
  /** Called after every change, for the top bar and the status line. */
  readonly onNavigate?: (id: string, instance: ScreenInstance) => void;
  readonly history?: boolean;
}

export class Navigation {
  private readonly root: HTMLElement;
  private readonly factories = new Map<string, ScreenFactory>();
  private readonly options: NavigationOptions;
  private stack: Entry[] = [];
  private current: ScreenInstance | null = null;
  private closed = false;

  constructor(options: NavigationOptions) {
    this.root = options.root;
    this.options = options;
  }

  register(id: string, factory: ScreenFactory): void {
    this.factories.set(id, factory);
  }

  get activeId(): string | null {
    return this.stack[this.stack.length - 1]?.id ?? null;
  }

  get active(): ScreenInstance | null {
    return this.current;
  }

  go(id: string, params?: unknown, options: { replace?: boolean } = {}): void {
    if (this.closed) return;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`No screen registered as "${id}"`);
    const entry: Entry = { id, params };
    if (options.replace && this.stack.length > 0) this.stack[this.stack.length - 1] = entry;
    else this.stack.push(entry);
    this.mount();
  }

  /** Replaces the entire stack, e.g. when leaving a match back to the menu. */
  reset(id: string, params?: unknown): void {
    this.stack = [{ id, params }];
    this.mount();
  }

  back(): void {
    if (this.closed) return;
    if (this.stack.length <= 1) return;
    this.stack.pop();
    this.mount();
  }

  /** Rebuilds the current screen (after a settings change, for example). */
  refresh(): void {
    if (this.closed || this.stack.length === 0) return;
    this.mount();
  }

  close(): void {
    this.closed = true;
    this.current?.destroy?.();
    this.current = null;
    clear(this.root);
  }

  private mount(): void {
    const entry = this.stack[this.stack.length - 1];
    if (!entry) return;
    const factory = this.factories.get(entry.id);
    if (!factory) return;
    this.current?.destroy?.();
    clear(this.root);
    const instance = factory({
      go: (id, params, options) => this.go(id, params, options),
      reset: (id, params) => this.reset(id, params),
      back: () => this.back(),
      params: entry.params,
    });
    this.current = instance;
    this.root.appendChild(instance.element);
    if (instance.firstFocus) focusElement(instance.firstFocus);
    else focusElement(this.root);
    announce(`${instance.title ?? entry.id} screen`);
    this.options.onNavigate?.(entry.id, instance);
  }
}
