import type { ActionOutcome, Game } from '../engine/index.ts';

/**
 * The single path from any input device to the engine.
 *
 * Keyboard, touch pad, on-screen buttons and (later) multiplayer spectators all call these
 * methods, so every device gets identical handling of repetition, buffering and pause rules.
 * `detail` lets callers ask for a specific repeat behaviour:
 *
 *   - `press`   the initial press: moves immediately, starts the auto-shift timer.
 *   - `repeat`  an auto-shift tick: only valid for movement.
 *   - `release` ends a held action (soft drop off).
 */
export type IntentDetail = 'press' | 'repeat' | 'release';

export interface ActionRouterHooks {
  /** Called when a pause/resume request should be handled by the host (dialogs, match rules). */
  readonly onPauseRequest?: () => void;
  readonly onRestartRequest?: () => void;
  /** Called whenever an action produced an outcome, for audio and HUD feedback. */
  readonly onAction?: (action: string, outcome: ActionOutcome, detail: IntentDetail) => void;
}

export class ActionRouter {
  private game: Game | null = null;
  private hooks: ActionRouterHooks = {};
  private enabled = true;

  attach(game: Game | null, hooks: ActionRouterHooks = {}): void {
    this.game = game;
    this.hooks = hooks;
  }

  /** Disables play actions (but keeps the object alive) while a dialog owns the keyboard. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  get active(): boolean {
    return this.enabled && this.game !== null;
  }

  move(direction: -1 | 1, detail: IntentDetail = 'press'): void {
    if (!this.active) return;
    const outcome = this.game?.moveHorizontal(direction) ?? { performed: false, blocked: false };
    this.hooks.onAction?.(direction < 0 ? 'moveLeft' : 'moveRight', outcome, detail);
  }

  rotate(direction: 1 | -1, detail: IntentDetail = 'press'): void {
    if (!this.active) return;
    const outcome = this.game?.rotate(direction) ?? { performed: false, blocked: false };
    this.hooks.onAction?.(direction > 0 ? 'rotateCW' : 'rotateCCW', outcome, detail);
  }

  /** Soft drop is a held state rather than a discrete action. */
  softDrop(down: boolean, detail: IntentDetail = 'press'): void {
    if (!this.active) return;
    this.game?.setSoftDrop(down);
    this.hooks.onAction?.('softDrop', { performed: down, blocked: false }, detail);
  }

  hardDrop(): void {
    if (!this.active) return;
    const outcome = this.game?.hardDrop() ?? { performed: false, blocked: false };
    this.hooks.onAction?.('hardDrop', outcome, 'press');
  }

  hold(): void {
    if (!this.active) return;
    const outcome = this.game?.hold() ?? { performed: false, blocked: false };
    this.hooks.onAction?.('hold', outcome, 'press');
  }

  pause(): void {
    if (!this.enabled) return;
    this.hooks.onPauseRequest?.();
  }

  restart(): void {
    if (!this.enabled) return;
    this.hooks.onRestartRequest?.();
  }

  /** Called on pause, blur or mode change so a held key cannot leak into the next game. */
  releaseAll(): void {
    this.game?.setSoftDrop(false);
  }
}
