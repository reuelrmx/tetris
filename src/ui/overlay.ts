import { FocusTrap, button, el, qs } from './dom.ts';

/**
 * Overlays: the pause screen, end-of-game summary, settings dialog and confirmations.
 *
 * One overlay at a time, always with a labelled dialog, a focus trap and Escape-to-close
 * (unless the dialog is a blocking result that must be acknowledged). The game loop is paused by
 * the caller, not here.
 */
export interface OverlayOptions {
  readonly title: string;
  readonly subtitle?: string;
  /** Called when Escape is pressed or the close button is used. */
  readonly onClose?: () => void;
  /** Hides the close button and ignores Escape (used for mandatory results). */
  readonly blocking?: boolean;
  readonly wide?: boolean;
  /** Land focus on this element after opening; defaults to the first control. */
  readonly initialFocus?: () => HTMLElement | null;
}

export interface Overlay {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  close(): void;
}

export class OverlayHost {
  private readonly container: HTMLElement;
  private active: { root: HTMLElement; trap: FocusTrap; options: OverlayOptions } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  get isOpen(): boolean {
    return this.active !== null;
  }

  open(options: OverlayOptions): Overlay {
    this.close();
    const titleId = `overlay-title-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = el('div', {
      class: options.wide ? 'dialog dialog--wide' : 'dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    });
    const title = el('h2', { class: 'dialog__title', id: titleId, text: options.title });
    const head = el('div', { class: 'dialog__head' }, [
      el('div', {}, [title, options.subtitle ? el('p', { class: 'eyebrow', text: options.subtitle }) : null]),
      options.blocking
        ? null
        : button('Close', {
            class: 'btn btn--ghost',
            on: { click: () => this.close() },
            attrs: { 'aria-label': 'Close dialogue' },
          }),
    ]);
    const body = el('div', { class: 'dialog__body' });
    const footer = el('div', { class: 'dialog__foot' });
    dialog.append(head, body, footer);
    const overlayElement = el('div', { class: 'overlay' }, [dialog]);
    overlayElement.addEventListener('click', (event) => {
      if (event.target === overlayElement && !options.blocking) this.close();
    });
    this.container.appendChild(overlayElement);

    const trap = new FocusTrap(dialog);
    this.active = { root: overlayElement, trap, options };
    trap.activate(options.initialFocus?.() ?? null);
    if (!options.blocking) {
      overlayElement.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.close();
        }
      });
    }
    return {
      root: overlayElement,
      body,
      footer,
      close: () => this.close(),
    };
  }

  close(): void {
    if (!this.active) return;
    const { root, trap, options } = this.active;
    this.active = null;
    trap.deactivate();
    root.remove();
    options.onClose?.();
  }

  /** True when focus currently sits inside the active overlay. */
  containsFocus(): boolean {
    return this.active !== null && document.activeElement !== null && this.active.root.contains(document.activeElement);
  }
}

/** Convenience: a yes/no confirmation dialog. */
export function confirmDialog(
  host: OverlayHost,
  options: { title: string; message: string; confirmLabel: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      overlay.close();
      resolve(value);
    };
    const confirmButton = button(options.confirmLabel, {
      class: options.danger ? 'btn btn--danger' : 'btn btn--primary',
      on: { click: () => finish(true) },
    });
    const cancelButton = button(options.cancelLabel ?? 'Cancel', {
      class: 'btn',
      on: { click: () => finish(false) },
    });
    const overlay = host.open({
      title: options.title,
      onClose: () => finish(false),
      initialFocus: () => confirmButton,
    });
    overlay.body.append(el('p', { class: 'muted', text: options.message }));
    overlay.footer.append(cancelButton, confirmButton);
  });
}

/** A transient message at the bottom of the screen. */
export class ToastHost {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(message: string, kind: 'info' | 'ok' | 'error' = 'info', durationMs = 3200): void {
    const toast = el('div', {
      class: kind === 'info' ? 'toast' : `toast toast--${kind}`,
      text: message,
      attrs: { role: 'status' },
    });
    this.container.appendChild(toast);
    globalThis.setTimeout(() => {
      toast.style.transition = 'opacity 200ms linear';
      toast.style.opacity = '0';
      globalThis.setTimeout(() => toast.remove(), 220);
    }, durationMs);
    while (this.container.childElementCount > 3) {
      qs(this.container, '.toast')?.remove();
    }
  }
}
