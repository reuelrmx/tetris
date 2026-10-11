/**
 * Level progression and the fall-speed curve.
 *
 * The curve is the community-documented `Tetris Worlds`-derived formula
 * `secondsPerRow(level) = (0.8 - 0.007 * (level - 1)) ^ (level - 1)`, which we verified
 * numerically against the published approximation table (see `docs/RULESET.md` §5).
 * `levelsPerRow` above level 19 is not agreed on anywhere, so `speedCapLevel` (default 15)
 * freezes the curve and the lock delay shrinks instead — a decision, not a claim.
 */

/** 20G: one row per frame at 60 Hz, i.e. a full 20-row field in a single frame. */
export const MAX_CELLS_PER_SECOND = 20 * 60;

export interface GravitySettings {
  /** Ten lines per level by default (fixed-goal progression). */
  readonly linesPerLevel: number;
  /** Level at which the speed curve stops increasing; `null` means "keep going until 20G". */
  readonly speedCapLevel: number | null;
  /** Soft drop speed as a multiple of the current level's gravity. */
  readonly softDropMultiplier: number;
  /** Soft drop never falls slower than this. */
  readonly minSoftDropCellsPerSecond: number;
  readonly lockDelayMs: number;
  /** Lock delay reduction once gravity hits 20G. */
  readonly highGravityLockDelay: {
    readonly fromLevel: number;
    readonly stepMs: number;
    readonly minMs: number;
  };
}

/** Per-mode level behaviour: rulesets decide the curve, modes decide the starting point. */
export interface LevelSettings {
  /** Level the player starts on; lines needed for level *n* are `(n - startLevel) * linesPerLevel`. */
  readonly startLevel: number;
  /** When false the level never changes (Sprint, Ultra, Versus). */
  readonly levelProgression: boolean;
}

export type GravityConfig = GravitySettings & LevelSettings;

/** Seconds for the active piece to descend one row at `level`. */
export function secondsPerRow(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.pow(0.8 - 0.007 * (l - 1), l - 1);
}

/** Applies the speed cap to the curve without changing the displayed level. */
export function curveLevel(level: number, speedCapLevel: number | null): number {
  return speedCapLevel === null ? level : Math.min(level, speedCapLevel);
}

/** Fall speed in cells per second, clamped to 20G. */
export function gravityCellsPerSecond(level: number, speedCapLevel: number | null): number {
  const seconds = secondsPerRow(curveLevel(level, speedCapLevel));
  return Math.min(1 / seconds, MAX_CELLS_PER_SECOND);
}

/** Soft drop speed: a multiple of gravity with a floor, clamped to 20G. */
export function softDropCellsPerSecond(config: GravityConfig, level: number): number {
  const gravity = gravityCellsPerSecond(level, config.speedCapLevel);
  return Math.min(Math.max(gravity * config.softDropMultiplier, config.minSoftDropCellsPerSecond), MAX_CELLS_PER_SECOND);
}

/** True once gravity is effectively instantaneous (20G). */
export function isMaxGravity(level: number, speedCapLevel: number | null): boolean {
  return gravityCellsPerSecond(level, speedCapLevel) >= MAX_CELLS_PER_SECOND;
}

/** Lock delay for a level: 0.5 s, shrinking only when gravity has hit 20G. */
export function lockDelayMsForLevel(config: GravityConfig, level: number): number {
  if (!isMaxGravity(level, config.speedCapLevel)) return config.lockDelayMs;
  const over = Math.max(0, level - config.highGravityLockDelay.fromLevel);
  return Math.max(config.highGravityLockDelay.minMs, config.lockDelayMs - over * config.highGravityLockDelay.stepMs);
}

/** Level shown for a running total of cleared lines. */
export function levelForLines(config: GravityConfig, lines: number): number {
  if (!config.levelProgression) return config.startLevel;
  return config.startLevel + Math.floor(Math.max(0, lines) / config.linesPerLevel);
}

/** Lines still needed to reach the next level, and progress within the current level. */
export function levelProgress(config: GravityConfig, lines: number): { intoLevel: number; needed: number } {
  if (!config.levelProgression) return { intoLevel: 0, needed: 0 };
  const perLevel = config.linesPerLevel;
  if (perLevel <= 0) return { intoLevel: 0, needed: 0 };
  return { intoLevel: Math.max(0, lines) % perLevel, needed: perLevel };
}
