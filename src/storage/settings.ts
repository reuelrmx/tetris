import { DEFAULT_BINDINGS, cloneBindings, sanitiseBindings } from '../input/bindings.ts';
import type { Bindings } from '../input/bindings.ts';

/**
 * Player settings.
 *
 * Settings are small, must be readable before the first frame (so the board can render with the
 * right theme immediately) and are written on every change, so they live in `localStorage`.
 * Records and per-mode statistics are structured and grow over time, so they live in IndexedDB
 * (`src/storage/records.ts`).
 */
export const SETTINGS_KEY = 'strata.settings.v1';
export const SETTINGS_VERSION = 1;

export type ReducedMotionPreference = 'system' | 'reduce' | 'allow';

export interface Settings {
  readonly version: number;
  readonly bindings: Bindings;
  /** Delayed auto shift, milliseconds. */
  readonly dasMs: number;
  /** Auto repeat rate, milliseconds; 0 means "as fast as the frame allows". */
  readonly arrMs: number;
  readonly softDropMode: 'guideline' | 'instant';
  readonly ghostPiece: boolean;
  readonly gridLines: boolean;
  readonly glyphs: boolean;
  readonly highContrast: boolean;
  readonly showTicker: boolean;
  readonly sfxVolume: number;
  readonly musicVolume: number;
  readonly muted: boolean;
  readonly reducedMotion: ReducedMotionPreference;
  /** Player name used for anonymous multiplayer sessions. */
  readonly playerName: string;
  /** Overrides the WebSocket endpoint; empty means "same origin". */
  readonly versusEndpoint: string;
  /** Marathon starting level chosen on the mode screen. */
  readonly marathonStartLevel: number;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  bindings: cloneBindings(DEFAULT_BINDINGS),
  dasMs: 167,
  arrMs: 33,
  softDropMode: 'guideline',
  ghostPiece: true,
  gridLines: true,
  glyphs: false,
  highContrast: false,
  showTicker: true,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  muted: false,
  reducedMotion: 'system',
  playerName: '',
  versusEndpoint: '',
  marathonStartLevel: 1,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory fallback for environments without `localStorage` (tests, private modes). */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export function loadSettings(storage: StorageLike): Settings {
  const raw = safeGet(storage, SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return normaliseSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: StorageLike, settings: Settings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota or a locked-down environment: settings stay in memory for this session.
  }
}

/**
 * Accepts any parsed object and returns a valid `Settings`. Unknown keys are dropped, missing
 * keys fall back to defaults and out-of-range numbers are clamped, so a corrupt or older record
 * can never break the interface.
 */
export function normaliseSettings(input: unknown): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return {
    version: SETTINGS_VERSION,
    bindings: sanitiseBindings(source.bindings),
    dasMs: clampNumber(source.dasMs, 0, 500, DEFAULT_SETTINGS.dasMs),
    arrMs: clampNumber(source.arrMs, 0, 200, DEFAULT_SETTINGS.arrMs),
    softDropMode: source.softDropMode === 'instant' ? 'instant' : 'guideline',
    ghostPiece: bool(source.ghostPiece, DEFAULT_SETTINGS.ghostPiece),
    gridLines: bool(source.gridLines, DEFAULT_SETTINGS.gridLines),
    glyphs: bool(source.glyphs, DEFAULT_SETTINGS.glyphs),
    highContrast: bool(source.highContrast, DEFAULT_SETTINGS.highContrast),
    showTicker: bool(source.showTicker, DEFAULT_SETTINGS.showTicker),
    sfxVolume: clampNumber(source.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
    musicVolume: clampNumber(source.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    muted: bool(source.muted, DEFAULT_SETTINGS.muted),
    reducedMotion:
      source.reducedMotion === 'reduce' || source.reducedMotion === 'allow'
        ? source.reducedMotion
        : 'system',
    playerName: typeof source.playerName === 'string' ? source.playerName.slice(0, 16) : '',
    versusEndpoint: typeof source.versusEndpoint === 'string' ? source.versusEndpoint.slice(0, 200) : '',
    marathonStartLevel: clampNumber(source.marathonStartLevel, 1, 20, 1),
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** The storage the app should use, with a memory fallback when the browser blocks it. */
export function detectStorage(): StorageLike {
  try {
    const probe = '__strata_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return createMemoryStorage();
  }
}
