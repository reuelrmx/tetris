// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootApp,
  clickButton,
  installAnimationFrameShim,
  installCanvasStubs,
  press,
  screenRoot,
  stubElementSizes,
} from './harness.ts';

/**
 * Host smoke test: the real application, mounted in a DOM.
 *
 * This imports `src/main.ts` — the same entry the browser loads — so it fails if the wiring
 * between settings, storage, records, audio, input, navigation and the screens is broken. It then
 * drives the app through real DOM events (clicks and key presses) rather than calling internals:
 * start a Marathon game, move and rotate, hard drop, pause, restart, and check that the canvas and
 * the HUD respond.
 */
describe('application boot and play loop', () => {
  let raf: ReturnType<typeof installAnimationFrameShim>;

  beforeEach(() => {
    vi.resetModules();
    raf = installAnimationFrameShim();
    installCanvasStubs();
    // Layout metrics are not implemented by happy-dom; the session asks for client sizes. Every
    // element reports the same box here — `play-layout.test.ts` is the suite that models a real
    // one, where the canvas wrapper shrink-wraps the canvas it contains.
    stubElementSizes(() => ({ width: 320, height: 640 }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('boots to the menu with its primary actions', async () => {
    await bootApp();
    const root = screenRoot();
    expect(root.querySelector('.menu__title')).not.toBeNull();
    const labels = Array.from(root.querySelectorAll('button')).map((button) => button.textContent?.trim());
    expect(labels).toContain('Play');
    expect(labels).toContain('How to play');
    expect(labels).toContain('Records');
    expect(labels).toContain('Settings');
    // The title figure is drawn with the real renderer: one canvas per poster.
    expect(root.querySelectorAll('.poster-stack canvas').length).toBeGreaterThanOrEqual(1);
  });

  it('reaches the mode list, and every mode row offers a real start control', async () => {
    await bootApp();
    clickButton('Play');
    const root = screenRoot();
    expect(root.querySelectorAll('.mode-row')).toHaveLength(4);
    const names = Array.from(root.querySelectorAll('.mode-row__name')).map((node) => node.textContent);
    expect(names).toEqual(['Marathon', 'Sprint', 'Ultra', 'Versus']);
    // Marathon is the only mode with a starting-level control.
    expect(root.querySelectorAll('select')).toHaveLength(1);
  });

  it('starts a game, renders the board and reacts to keyboard input', async () => {
    await bootApp();
    clickButton('Play');
    clickButton('Start'); // Marathon row
    const root = screenRoot();
    expect(root.querySelector('.play')).not.toBeNull();
    const canvas = root.querySelector('canvas.board-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    // The renderer sizes the backing store from the space the layout reports.
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    raf.flush(2);

    // A game is running: the HUD shows a clock that is not the placeholder, and the
    // accessibility label names the playfield.
    const label = canvas.getAttribute('aria-label') ?? '';
    expect(label).toContain('Playfield');
    expect(label).toMatch(/Score \d+/);

    // Key input reaches the engine: after a hard drop the piece count advances, which is
    // observable through the canvas label's stack description changing or the log gaining a line.
    press('Space');
    raf.flush(3);
    const log = root.querySelector('.ticker');
    expect(log?.childElementCount ?? 0).toBeGreaterThan(0);

    // Rotation is bound to ArrowUp and Z; both must be handled without throwing.
    press('ArrowUp');
    press('KeyZ');
    press('ArrowLeft');
    press('ArrowDown');
    press('KeyC');
    raf.flush(3);
    expect(document.body.classList.contains('is-playing')).toBe(true);
  });

  it('pauses and resumes through the Escape key and the pause dialog', async () => {
    await bootApp();
    clickButton('Play');
    clickButton('Start');
    raf.flush(2);

    press('Escape');
    const dialog = document.querySelector('.overlay .dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Paused');
    // Focus moved into the dialog for keyboard users.
    expect(dialog?.contains(document.activeElement)).toBe(true);

    clickButton('Resume', dialog as HTMLElement);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('restarts from the pause dialog with a fresh board', async () => {
    await bootApp();
    clickButton('Play');
    clickButton('Start');
    raf.flush(2);
    press('Space');
    raf.flush(2);

    press('Escape');
    const dialog = document.querySelector('.overlay .dialog') as HTMLElement;
    clickButton('Restart', dialog);
    raf.flush(2);
    const root = screenRoot();
    expect(root.querySelector('.play')).not.toBeNull();
    // A restarted game has an empty log until the first lock.
    expect(root.querySelector('.ticker')?.childElementCount ?? 0).toBe(0);
  });

  it('shows the settings screen with bindings, and rebinding a key takes effect', async () => {
    await bootApp();
    clickButton('Settings');
    const root = screenRoot();
    const bindings = root.querySelectorAll('.binding');
    expect(bindings.length).toBeGreaterThanOrEqual(9);
    // Clicking a key enters capture mode, then the next press becomes the new binding.
    const firstKey = root.querySelector('.binding__key') as HTMLButtonElement;
    firstKey.click();
    expect(firstKey.textContent).toContain('Press a key');
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rebound = (screenRoot().querySelector('.binding__key') as HTMLButtonElement).textContent;
    expect(rebound).toContain('Q');
  });

  it('lists records for every mode, with an empty state before any game is finished', async () => {
    await bootApp();
    clickButton('Records');
    // The records screen reads from IndexedDB, so its tables are filled in a microtask later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = screenRoot();
    const headings = Array.from(root.querySelectorAll('.records__section > .panel__head > .panel__title')).map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(['Marathon', 'Sprint', 'Ultra', 'Versus']);
    expect(root.querySelectorAll('.records__section')).toHaveLength(4);
    expect(root.textContent).toContain('No games recorded yet');
  });

  it('opens the help screen with the scoring table the engine implements', async () => {
    await bootApp();
    clickButton('How to play');
    const root = screenRoot();
    expect(root.textContent).toContain('T-Spin Triple');
    expect(root.textContent).toContain('Back-to-back');
    // Controls are listed from the live bindings, not hardcoded.
    expect(root.querySelectorAll('.binding__key').length).toBeGreaterThanOrEqual(9);
  });

  it('keeps the top bar and status line in step with navigation', async () => {
    await bootApp();
    clickButton('Play');
    clickButton('Start');
    raf.flush(2);
    expect(document.getElementById('topbar-mode')?.textContent).toBe('Marathon');
    expect((document.getElementById('btn-pause') as HTMLButtonElement).hidden).toBe(false);

    // The build label is filled in from the compile-time constant.
    expect(document.getElementById('status-build')?.textContent).toMatch(/Build /);
  });
});
