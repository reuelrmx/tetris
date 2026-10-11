import { buildLookup } from './bindings.ts';
import type { ActionId, Bindings } from './bindings.ts';
import type { ActionRouter, IntentDetail } from './router.ts';

/**
 * Keyboard driver with DAS/ARR.
 *
 * Auto-shift is implemented here rather than with the browser's key auto-repeat: repeat timing is
 * a gameplay setting (167/33 ms by default, per `docs/RULESET.md` §14), and the OS repeat rate is
 * far too slow and not configurable from the page.
 *
 * The driver is driven by the game loop (`tick(deltaMs)`), so auto-shift pauses with the game.
 */
export interface KeyboardOptions {
  readonly bindings: Bindings;
  readonly dasMs: number;
  /** 0 means "every frame": the piece crosses the field within one rendered frame. */
  readonly arrMs: number;
}

export interface KeyboardTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, options?: AddEventListenerOptions): void;
  addEventListener(type: 'keyup', listener: (event: KeyboardEvent) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keyup', listener: (event: KeyboardEvent) => void): void;
}

interface HeldMove {
  readonly action: ActionId;
  /** Milliseconds since the key went down. */
  heldMs: number;
  /** Milliseconds since the last emitted move; `Infinity` until DAS elapses. */
  sinceRepeatMs: number;
  /** True once DAS has elapsed and movement is repeating. */
  repeating: boolean;
}

export class KeyboardDriver {
  private readonly target: KeyboardTarget;
  private lookup: Map<string, ActionId[]>;
  private dasMs: number;
  private arrMs: number;
  private router: ActionRouter | null = null;
  private held = new Map<string, HeldMove>();
  private softDropCodes = new Set<string>();
  private capturing = false;
  private captureHandler: ((code: string) => void) | null = null;
  private started = false;

  constructor(target: KeyboardTarget, options: KeyboardOptions) {
    this.target = target;
    this.lookup = buildLookup(options.bindings);
    this.dasMs = options.dasMs;
    this.arrMs = options.arrMs;
  }

  start(router: ActionRouter): void {
    if (this.started) return;
    this.started = true;
    this.router = router;
    this.target.addEventListener('keydown', this.onKeyDown, { passive: false });
    this.target.addEventListener('keyup', this.onKeyUp);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.held.clear();
    this.softDropCodes.clear();
    this.router = null;
  }

  update(options: Partial<KeyboardOptions>): void {
    if (options.bindings) this.lookup = buildLookup(options.bindings);
    if (typeof options.dasMs === 'number') this.dasMs = options.dasMs;
    if (typeof options.arrMs === 'number') this.arrMs = options.arrMs;
  }

  /** True while the settings screen is waiting for the player to press a key. */
  beginCapture(handler: (code: string) => void): void {
    this.capturing = true;
    this.captureHandler = handler;
  }

  endCapture(): void {
    this.capturing = false;
    this.captureHandler = null;
  }

  /** Auto-shift tick; called from the game loop with the frame delta. */
  tick(deltaMs: number): void {
    if (this.held.size === 0) return;
    for (const state of this.held.values()) {
      if (state.action !== 'moveLeft' && state.action !== 'moveRight') continue;
      state.heldMs += deltaMs;
      if (!state.repeating) {
        if (state.heldMs >= this.dasMs) {
          state.repeating = true;
          state.sinceRepeatMs = 0;
          this.emit(state, 'repeat');
        }
        continue;
      }
      state.sinceRepeatMs += deltaMs;
      if (this.arrMs <= 0) {
        // Instant ARR: shift all the way in this frame (the engine stops at the wall).
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        this.emit(state, 'repeat');
        state.sinceRepeatMs = 0;
        continue;
      }
      while (state.sinceRepeatMs >= this.arrMs) {
        state.sinceRepeatMs -= this.arrMs;
        this.emit(state, 'repeat');
      }
    }
  }

  /** Clears held-key state, e.g. when the window loses focus mid-press. */
  releaseAll(): void {
    this.held.clear();
    this.softDropCodes.clear();
    this.router?.softDrop(false, 'release');
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.capturing) {
      event.preventDefault();
      const handler = this.captureHandler;
      this.endCapture();
      handler?.(event.code);
      return;
    }
    const router = this.router;
    if (!router) return;
    const actions = this.lookup.get(event.code);
    if (!actions) return;

    // Auto-repeat must not re-trigger one-shot actions.
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (isEditable(event.target)) return;

    event.preventDefault();
    for (const action of actions) {
      switch (action) {
        case 'moveLeft':
        case 'moveRight': {
          const direction = action === 'moveLeft' ? -1 : 1;
          router.move(direction, 'press');
          this.held.set(event.code, {
            action,
            heldMs: 0,
            sinceRepeatMs: 0,
            repeating: false,
          });
          break;
        }
        case 'softDrop':
          this.softDropCodes.add(event.code);
          router.softDrop(true, 'press');
          break;
        case 'hardDrop':
          router.hardDrop();
          break;
        case 'rotateCW':
          router.rotate(1, 'press');
          break;
        case 'rotateCCW':
          router.rotate(-1, 'press');
          break;
        case 'hold':
          router.hold();
          break;
        case 'pause':
          router.pause();
          break;
        case 'restart':
          router.restart();
          break;
      }
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const router = this.router;
    if (!router) return;
    const actions = this.lookup.get(event.code);
    if (!actions) return;
    for (const action of actions) {
      if (action === 'moveLeft' || action === 'moveRight') {
        this.held.delete(event.code);
        continue;
      }
      if (action === 'softDrop') {
        this.softDropCodes.delete(event.code);
        if (this.softDropCodes.size === 0) router.softDrop(false, 'release');
      }
    }
  };

  private emit(state: HeldMove, detail: IntentDetail): void {
    this.router?.move(state.action === 'moveLeft' ? -1 : 1, detail);
  }
}

/** True when the event target is a text field or similar, where keys must keep their meaning. */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const element = target as HTMLInputElement;
    if (tag === 'input' && (element.type === 'checkbox' || element.type === 'radio' || element.type === 'range')) {
      return false;
    }
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}
