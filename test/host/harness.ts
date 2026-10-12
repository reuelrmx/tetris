// @vitest-environment happy-dom

/**
 * Shared harness for the host (DOM) tests.
 *
 * happy-dom implements the DOM but neither layout nor canvas, so every test that looks at sizes or
 * pixels has to say explicitly what the browser would have reported. Keeping those stubs in one
 * place is what lets `play-layout.test.ts` describe a *realistic* box model — a canvas wrapper that
 * shrink-wraps its canvas — instead of the flat "every element is 320×640" the suite started with,
 * which hid the board-sizing feedback loop entirely.
 */

/** The shell from `index.html`, minus the parts the tests never touch. */
export const APP_HTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="app" id="app">
    <header class="topbar">
      <div class="brand"><span class="brand__mark"></span><span class="brand__name">STRATA</span>
        <span class="brand__sub" id="topbar-mode">Falling-block puzzle</span></div>
      <nav class="topbar__actions" aria-label="Game actions">
        <button type="button" class="btn btn--ghost" id="btn-pause" hidden>Pause</button>
        <button type="button" class="btn btn--ghost" id="btn-sound" aria-pressed="true">
          <span class="sr-only">Sound: </span><span data-sound-label>on</span></button>
        <button type="button" class="btn btn--ghost" id="btn-settings">Settings</button>
      </nav>
    </header>
    <main id="main" class="main" tabindex="-1"><div id="screen-root" class="screen-root"></div></main>
    <footer class="statusbar">
      <span class="statusbar__item" id="status-multiplayer">Offline play ready</span>
      <span class="statusbar__item statusbar__item--dim" id="status-build"></span>
    </footer>
  </div>
  <div id="overlay-root"></div>
  <div id="toast-root" class="toast-root" aria-live="polite"></div>
  <div id="live-region" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
`;

interface TestHooks {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

/** Replaces the frame loop with one the test advances by hand. */
export function installAnimationFrameShim(): { frames: FrameRequestCallback[]; flush(count?: number): void } {
  const frames: FrameRequestCallback[] = [];
  const hooks = globalThis as unknown as TestHooks;
  hooks.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    frames.push(callback);
    return frames.length;
  };
  hooks.cancelAnimationFrame = (): void => undefined;
  return {
    frames,
    flush(count = 1): void {
      for (let i = 0; i < count; i++) {
        const pending = frames.splice(0, frames.length);
        for (const callback of pending) callback(performance.now());
      }
    },
  };
}

/** Dispatches a key event the way the app's listeners will see it. */
export function press(code: string, type: 'keydown' | 'keyup' = 'keydown'): void {
  // `KeyboardEvent.code` is read-only in happy-dom, so construct the event with it directly.
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  (document.activeElement ?? document.body).dispatchEvent(event);
}

/** Mounts the shell and imports the real entry point. */
export async function bootApp(): Promise<void> {
  document.body.innerHTML = APP_HTML;
  window.location.href = 'http://localhost:5173/';
  await import('../../src/main.ts');
  // Allow the async parts of startup (records store, stats) to settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function screenRoot(): HTMLElement {
  return document.getElementById('screen-root') as HTMLElement;
}

/** Clicks the first button whose label starts with `label`. */
export function clickButton(label: string, root: ParentNode = document): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll('button'));
  const match = buttons.find((button) => (button.textContent ?? '').trim().startsWith(label));
  if (!match) {
    throw new Error(`No button labelled "${label}". Found: ${buttons.map((b) => b.textContent).join(' | ')}`);
  }
  match.click();
  return match;
}

/** happy-dom has no canvas implementation: give the renderer just enough surface to draw. */
export function installCanvasStubs(): void {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement) {
      const noop = (): void => undefined;
      return {
        canvas: this,
        globalAlpha: 1,
        fillStyle: '',
        setTransform: noop,
        clearRect: noop,
        fillRect: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        fill: noop,
        rect: noop,
        clip: noop,
        save: noop,
        restore: noop,
        translate: noop,
      } as unknown as CanvasRenderingContext2D;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { x: 0, y: 0, width: 320, height: 640, top: 0, left: 0, right: 320, bottom: 640, toJSON: () => ({}) };
    },
  });
}

export interface ElementBox {
  readonly width: number;
  readonly height: number;
  /**
   * What `offsetHeight` reports. Left out it defaults to 0, which is what an empty row measures —
   * deliberately *not* `height`, because the two mean different things and the board sizing reads
   * both: `clientHeight` for the space on offer, `offsetHeight` for the chip row it must reserve.
   */
  readonly offsetHeight?: number;
}

/**
 * Stubs `clientWidth`/`clientHeight`/`offsetHeight` per element, since happy-dom reports 0 for all
 * of them. `resolve` is called with the element being measured, so a test can model a real box —
 * for example a wrapper whose size is derived from the canvas inside it.
 */
export function stubElementSizes(resolve: (element: HTMLElement) => ElementBox): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return resolve(this).width;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return resolve(this).height;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return resolve(this).offsetHeight ?? 0;
    },
  });
}

/** The CSS pixel size an element's inline style declares, or `fallback` when it has none yet. */
export function styledSize(element: Element | null, axis: 'width' | 'height', fallback: number): number {
  if (!element) return fallback;
  const value = parseFloat((element as HTMLElement).style[axis] ?? '');
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
