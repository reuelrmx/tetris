import type { GravitySettings, LevelSettings } from './gravity.ts';

/**
 * The rules profile, as data.
 *
 * Everything the engine can be tuned by lives here, so alternate profiles (or a test profile)
 * can be dropped in without touching the state machine. Values marked [OFFICIAL], [COMMUNITY]
 * or [DECISION] in `docs/RULESET.md` are referenced by section number in the comments.
 */

export type ModeId = 'marathon' | 'sprint' | 'ultra' | 'versus';

export interface ScoreTable {
  readonly single: number;
  readonly double: number;
  readonly triple: number;
  readonly quad: number;
  readonly miniSpinNoLines: number;
  readonly spinNoLines: number;
  readonly miniSpinSingle: number;
  readonly spinSingle: number;
  readonly miniSpinDouble: number;
  readonly spinDouble: number;
  readonly spinTriple: number;
}

export interface PerfectClearTable {
  readonly single: number;
  readonly double: number;
  readonly triple: number;
  readonly quad: number;
  readonly backToBackQuad: number;
}

export interface ScoringRules {
  /** Base values, multiplied by the level in effect before the clear. RULESET §8. */
  readonly base: ScoreTable;
  readonly softDropPerCell: number;
  readonly hardDropPerCell: number;
  /**
   * The publisher's page ends its score table with "All scores are multiplied by the current
   * level", while the community table lists drop points without a multiplier. We follow the
   * community reading by default (drops are flat) and keep the alternative available. RULESET §8.
   */
  readonly multiplyDropsByLevel: boolean;
  readonly backToBackMultiplier: number;
  readonly comboBase: number;
  /** `null` disables perfect-clear bonuses entirely. */
  readonly perfectClear: PerfectClearTable | null;
}

export interface AttackRules {
  readonly enabled: boolean;
  /** Garbage sent for each clear type. RULESET §13. */
  readonly base: {
    readonly single: number;
    readonly double: number;
    readonly triple: number;
    readonly quad: number;
    readonly miniSpinNoLines: number;
    readonly spinNoLines: number;
    readonly miniSpinSingle: number;
    readonly miniSpinDouble: number;
    readonly spinSingle: number;
    readonly spinDouble: number;
    readonly spinTriple: number;
  };
  readonly backToBack: {
    readonly miniSpinSingle: number;
    readonly miniSpinDouble: number;
    readonly spinSingle: number;
    readonly spinDouble: number;
    readonly quad: number;
    readonly spinTriple: number;
  };
  readonly comboStep: number;
  readonly comboCap: number;
  readonly perfectClear: number;
}

export interface GarbageRules {
  /** At most this many rows arrive in one insertion; the rest stays queued. RULESET §13. */
  readonly maxRowsPerInsertion: number;
  readonly holesPerRow: number;
  /** Consecutive bursts never share the same hole column. */
  readonly avoidRepeatingHole: boolean;
  /** Garbage is not delivered before both players have locked a piece. */
  readonly requireInitialLock: boolean;
}

export interface RuleSet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cols: number;
  readonly rows: number;
  readonly hiddenRows: number;
  readonly previewCount: number;
  readonly holdEnabled: boolean;
  readonly ghostEnabled: boolean;
  readonly allowSoftDropScoring: boolean;
  /** Lock-delay reset policy: move reset with a hard limit. RULESET §6. */
  readonly lockResetLimit: number;
  /** How long cleared rows stay on screen before compaction (presentation pacing). */
  readonly lineClearDelayMs: number;
  /** Entry delay before the next piece spawns. RULESET §6. */
  readonly spawnDelayMs: number;
  readonly gravity: GravitySettings;
  readonly scoring: ScoringRules;
  readonly attack: AttackRules;
  readonly garbage: GarbageRules;
}

/** "STRATA Standard v1" — the profile documented in `docs/RULESET.md`. */
export const STRATA_STANDARD_V1: RuleSet = {
  id: 'strata-standard-1',
  name: 'STRATA Standard',
  description:
    'SRS rotation with 7-bag randomiser, 0.5 s lock delay with 15 move resets, guideline-compatible scoring.',
  cols: 10,
  rows: 40,
  hiddenRows: 20,
  previewCount: 5,
  holdEnabled: true,
  ghostEnabled: true,
  allowSoftDropScoring: true,
  lockResetLimit: 15,
  lineClearDelayMs: 150,
  spawnDelayMs: 0,
  gravity: {
    linesPerLevel: 10,
    speedCapLevel: 15,
    softDropMultiplier: 20,
    minSoftDropCellsPerSecond: 10,
    lockDelayMs: 500,
    highGravityLockDelay: { fromLevel: 19, stepMs: 30, minMs: 200 },
  },
  scoring: {
    base: {
      single: 100,
      double: 300,
      triple: 500,
      quad: 800,
      miniSpinNoLines: 100,
      spinNoLines: 400,
      miniSpinSingle: 200,
      spinSingle: 800,
      miniSpinDouble: 400,
      spinDouble: 1200,
      spinTriple: 1600,
    },
    softDropPerCell: 1,
    hardDropPerCell: 2,
    multiplyDropsByLevel: false,
    backToBackMultiplier: 1.5,
    comboBase: 50,
    perfectClear: { single: 800, double: 1200, triple: 1800, quad: 2000, backToBackQuad: 3200 },
  },
  attack: {
    enabled: true,
    base: {
      single: 0,
      double: 1,
      triple: 2,
      quad: 4,
      miniSpinNoLines: 0,
      spinNoLines: 0,
      miniSpinSingle: 0,
      miniSpinDouble: 1,
      spinSingle: 2,
      spinDouble: 4,
      spinTriple: 6,
    },
    backToBack: {
      miniSpinSingle: 1,
      miniSpinDouble: 1,
      spinSingle: 1,
      spinDouble: 2,
      quad: 2,
      spinTriple: 3,
    },
    comboStep: 1,
    comboCap: 4,
    perfectClear: 10,
  },
  garbage: {
    maxRowsPerInsertion: 8,
    holesPerRow: 1,
    avoidRepeatingHole: true,
    requireInitialLock: true,
  },
};

export type ModeGoal =
  | { readonly kind: 'endless' }
  | { readonly kind: 'lines'; readonly lines: number }
  | { readonly kind: 'time'; readonly durationMs: number }
  | { readonly kind: 'versus' };

export interface ModeDefinition {
  readonly id: ModeId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly rulesId: string;
  readonly levels: LevelSettings;
  readonly gravityMode: 'leveled' | 'fixed';
  readonly goal: ModeGoal;
  readonly allowAttacks: boolean;
  readonly allowPause: boolean;
  readonly records: 'score' | 'time';
  /** Marathon lets the player pick a starting level; the others are fixed for comparability. */
  readonly startLevelChoices: readonly number[];
}

export const MODES: Readonly<Record<ModeId, ModeDefinition>> = {
  marathon: {
    id: 'marathon',
    name: 'Marathon',
    tagline: 'Endless climb',
    description:
      'Ten lines per level, speed rising with the community-documented curve and capped at level 15. Play until you top out.',
    rulesId: STRATA_STANDARD_V1.id,
    levels: { startLevel: 1, levelProgression: true },
    gravityMode: 'leveled',
    goal: { kind: 'endless' },
    allowAttacks: false,
    allowPause: true,
    records: 'score',
    startLevelChoices: [1, 2, 3, 5, 8, 10, 12, 15],
  },
  sprint: {
    id: 'sprint',
    name: 'Sprint',
    tagline: '40 lines, fast',
    description: 'Clear 40 lines as quickly as you can. Gravity stays at level 1, so the clock is yours to lose.',
    rulesId: STRATA_STANDARD_V1.id,
    levels: { startLevel: 1, levelProgression: false },
    gravityMode: 'fixed',
    goal: { kind: 'lines', lines: 40 },
    allowAttacks: false,
    allowPause: true,
    records: 'time',
    startLevelChoices: [1],
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra',
    tagline: 'Two minutes',
    description: 'Score as much as possible in two minutes. Gravity stays at level 1; the board is the only obstacle.',
    rulesId: STRATA_STANDARD_V1.id,
    levels: { startLevel: 1, levelProgression: false },
    gravityMode: 'fixed',
    goal: { kind: 'time', durationMs: 120_000 },
    allowAttacks: false,
    allowPause: true,
    records: 'score',
    startLevelChoices: [1],
  },
  versus: {
    id: 'versus',
    name: 'Versus',
    tagline: 'Online duel with garbage',
    description:
      'Two players, identical piece sequences, constant gravity. Clear lines to send garbage; cancel incoming rows with your own clears.',
    rulesId: STRATA_STANDARD_V1.id,
    levels: { startLevel: 1, levelProgression: false },
    gravityMode: 'fixed',
    goal: { kind: 'versus' },
    allowAttacks: true,
    allowPause: false,
    records: 'score',
    startLevelChoices: [1],
  },
};

export const MODE_ORDER: readonly ModeId[] = ['marathon', 'sprint', 'ultra', 'versus'];

export function getMode(id: ModeId): ModeDefinition {
  return MODES[id];
}
