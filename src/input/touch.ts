import type { ActionRouter } from './router.ts';

/**
 * Touch controls.
 *
 * Two layers, because one is never enough on a phone:
 *
 *   1. An on-screen pad with generous keys (48px+ tall, in reach of both thumbs) using pointer
 *      events. Movement keys press-and-hold: the first press moves immediately and the router's
 *      auto-shift keeps repeating while the finger stays down, which is the same code path as a
 *      held arrow key.
 *   2. Gestures directly on the board for players who prefer them: drag horizontally to move,
 *      drag down to soft drop, flick down to hard drop, tap to rotate, swipe up to hold.
 *
 * Everything is pointer-event based (not touch events), so a stylus or a trackpad works too, and
 * `touch-action: none` is set on the elements in CSS rather than by preventing events globally.
 */
export interface TouchPadOptions {
  /** Vertical distance, in CSS pixels, that a drag must cover to lock into a mode. */
  readonly dragThreshold?: number;
  /** Horizontal step for one column of movement during a drag. */
  readonly dragCellStep?: number;
  /** Downward speed (px/ms) above which a downward flick is a hard drop. */
  readonly flickSpeed?: number;
}

const DEFAULTS: Required<TouchPadOptions> = {
  dragThreshold: 12,
  dragCellStep: 22,
  flickSpeed: 0.9,
};

export interface TouchPadHandles {
  destroy(): void;
  /** Re-reads element bounding boxes after a resize or a screen change. */
  refresh(): void;
}

type PadAction =
  | { readonly kind: 'move'; readonly direction: -1 | 1 }
  | { readonly kind: 'softDrop' }
  | { readonly kind: 'rotate'; readonly direction: 1 | -1 }
  | { readonly kind: 'hold' }
  | { readonly kind: 'hardDrop' }
  | { readonly kind: 'pause' };

/**
 * Wires the buttons inside `pad` (matched by `data-action`) to the router. Keys with
 * `data-hold="true"` keep their action held until the pointer is released or cancelled.
 */
export function attachTouchPad(pad: HTMLElement, router: ActionRouter): TouchPadHandles {
  const held = new Map<number, PadAction>();
  const listeners: Array<[HTMLElement, string, EventListener]> = [];

  const actionFor = (element: HTMLElement): PadAction | null => {
    const action = element.dataset.action;
    switch (action) {
      case 'left':
        return { kind: 'move', direction: -1 };
      case 'right':
        return { kind: 'move', direction: 1 };
      case 'softDrop':
        return { kind: 'softDrop' };
      case 'rotateCW':
        return { kind: 'rotate', direction: 1 };
      case 'rotateCCW':
        return { kind: 'rotate', direction: -1 };
      case 'hold':
        return { kind: 'hold' };
      case 'hardDrop':
        return { kind: 'hardDrop' };
      case 'pause':
        return { kind: 'pause' };
      default:
        return null;
    }
  };

  const press = (element: HTMLElement, pointerId: number): void => {
    const action = actionFor(element);
    if (!action) return;
    held.set(pointerId, action);
    element.dataset.pressed = 'true';
    switch (action.kind) {
      case 'move':
        router.move(action.direction, 'press');
        break;
      case 'softDrop':
        router.softDrop(true, 'press');
        break;
      case 'rotate':
        router.rotate(action.direction, 'press');
        break;
      case 'hold':
        router.hold();
        break;
      case 'hardDrop':
        router.hardDrop();
        break;
      case 'pause':
        router.pause();
        break;
    }
  };

  const release = (pointerId: number): void => {
    const action = held.get(pointerId);
    if (!action) return;
    held.delete(pointerId);
    if (action.kind === 'softDrop') router.softDrop(false, 'release');
    for (const element of pad.querySelectorAll<HTMLElement>('[data-pressed="true"]')) {
      element.dataset.pressed = 'false';
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!element || !pad.contains(element)) return;
    event.preventDefault();
    // Capture so a finger that slides off the key still delivers its release.
    element.setPointerCapture?.(event.pointerId);
    press(element, event.pointerId);
  };

  const onPointerUp = (event: PointerEvent): void => release(event.pointerId);
  const onPointerCancel = (event: PointerEvent): void => release(event.pointerId);
  const onContextMenu = (event: Event): void => event.preventDefault();

  for (const [type, handler] of [
    ['pointerdown', onPointerDown],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel],
    ['lostpointercapture', onPointerUp],
    ['contextmenu', onContextMenu],
  ] as const) {
    pad.addEventListener(type, handler as EventListener, { passive: false });
    listeners.push([pad, type, handler as EventListener]);
  }

  return {
    destroy(): void {
      for (const [element, type, handler] of listeners) element.removeEventListener(type, handler);
      listeners.length = 0;
      held.clear();
    },
    refresh(): void {
      // Bounding boxes are read per gesture, so nothing to do; kept for API symmetry with
      // resizing code that may need to re-measure in future layouts.
    },
  };
}

export interface BoardGestureHandles {
  destroy(): void;
}

/**
 * Gestures on the board canvas. Movement is emitted per `dragCellStep` pixels of horizontal
 * travel, soft drop engages once the drag is clearly downward, and a fast downward flick becomes
 * a hard drop. A tap (no meaningful travel) rotates clockwise.
 */
export function attachBoardGestures(
  surface: HTMLElement,
  router: ActionRouter,
  options: TouchPadOptions = {},
): BoardGestureHandles {
  const config = { ...DEFAULTS, ...options };
  interface Gesture {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    mode: 'undecided' | 'horizontal' | 'softDrop' | 'none';
    emittedCells: number;
    startedAt: number;
    softDropping: boolean;
  }
  let gesture: Gesture | null = null;
  const listeners: Array<[HTMLElement, string, EventListener]> = [];

  const down = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (gesture) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      mode: 'undecided',
      emittedCells: 0,
      startedAt: event.timeStamp,
      softDropping: false,
    };
    surface.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const move = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.mode === 'undecided') {
      if (Math.abs(dx) >= config.dragThreshold && Math.abs(dx) > Math.abs(dy) * 1.2) {
        gesture.mode = 'horizontal';
      } else if (dy >= config.dragThreshold && dy > Math.abs(dx) * 1.2) {
        gesture.mode = 'softDrop';
        router.softDrop(true, 'press');
        gesture.softDropping = true;
        gesture.lastY = event.clientY;
      } else if (dy < -config.dragThreshold && Math.abs(dy) > Math.abs(dx) * 1.5) {
        // Upward swipe: hold.
        gesture.mode = 'none';
        router.hold();
        return;
      } else {
        return;
      }
    }
    if (gesture.mode === 'horizontal') {
      const steps = Math.trunc(dx / config.dragCellStep);
      const pending = steps - gesture.emittedCells;
      if (pending !== 0) {
        const direction = pending > 0 ? 1 : -1;
        for (let i = 0; i < Math.abs(pending); i++) router.move(direction, 'repeat');
        gesture.emittedCells = steps;
      }
      return;
    }
    if (gesture.mode === 'softDrop') {
      const now = event.timeStamp;
      const dt = Math.max(1, now - gesture.lastTime);
      const speed = (event.clientY - gesture.lastY) / dt;
      gesture.lastY = event.clientY;
      gesture.lastTime = now;
      if (speed > config.flickSpeed && event.clientY - gesture.startY > config.dragThreshold * 3) {
        // A deliberate flick: release the drop and slam the piece.
        if (gesture.softDropping) {
          router.softDrop(false, 'release');
          gesture.softDropping = false;
        }
        router.hardDrop();
        gesture.mode = 'none';
      }
    }
  };

  const up = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const finished = gesture;
    gesture = null;
    if (finished.softDropping) router.softDrop(false, 'release');
    const dx = Math.abs(event.clientX - finished.startX);
    const dy = Math.abs(event.clientY - finished.startY);
    const elapsed = event.timeStamp - finished.startedAt;
    if (finished.mode === 'undecided' && dx < config.dragThreshold && dy < config.dragThreshold && elapsed < 400) {
      router.rotate(1, 'press');
    }
  };

  const cancel = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.softDropping) router.softDrop(false, 'release');
    gesture = null;
  };

  for (const [type, handler] of [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', cancel],
  ] as const) {
    surface.addEventListener(type, handler as EventListener, { passive: false });
    listeners.push([surface, type, handler as EventListener]);
  }

  return {
    destroy(): void {
      for (const [element, type, handler] of listeners) element.removeEventListener(type, handler);
      listeners.length = 0;
    },
  };
}

/** True when the device reports a coarse pointer (phone/tablet) — used to show the pad. */
export function prefersTouchControls(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
