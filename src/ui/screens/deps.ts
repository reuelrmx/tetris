import type { GameAudio } from '../../audio/index.ts';
import type { KeyboardDriver } from '../../input/keyboard.ts';
import type { ActionRouter } from '../../input/router.ts';
import type { RecordsStore, ModeStats } from '../../storage/records.ts';
import type { Settings, StorageLike } from '../../storage/settings.ts';
import type { OverlayHost, ToastHost } from '../overlay.ts';

/**
 * Everything the screens need from the application, passed explicitly.
 *
 * This is the seam that keeps the UI testable (a host test can build a `ScreenDeps` with a fake
 * records store and a silent audio layer) and keeps modules free of globals.
 */
export interface ScreenDeps {
  readonly settings: Settings;
  /** Persists a settings change and applies it to the live systems. */
  readonly updateSettings: (patch: Partial<Settings>) => void;
  readonly storage: StorageLike;
  readonly records: RecordsStore;
  readonly audio: GameAudio;
  readonly router: ActionRouter;
  readonly keyboard: KeyboardDriver | null;
  readonly overlays: OverlayHost;
  readonly toasts: ToastHost;
  /** Cached per-mode statistics, refreshed after every finished game. */
  readonly stats: Map<string, ModeStats>;
  readonly refreshStats: () => Promise<void>;
  /** True when the browser reports a coarse pointer. */
  readonly touchControls: boolean;
  /** Network capability reported by the connection layer (set by the versus screens). */
  readonly multiplayer: {
    readonly enabled: boolean;
    readonly reason: string;
    readonly status: () => string;
  };
}
