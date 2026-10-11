import type { AttackResult, ClearType, DropPoints, ScoreLine, SpinKind } from './types.ts';
import type { AttackRules, ScoringRules } from './ruleset.ts';

/**
 * Scoring and attack maths.
 *
 * Pure functions over the tables in `RuleSet`: no state, no randomness, no DOM. The order of
 * operations is fixed by `docs/RULESET.md` §8 and asserted in `test/unit/scoring.test.ts`:
 *
 *   drop points → base action score × level → back-to-back → combo → perfect clear
 */

export interface ScoreInput {
  readonly clearType: ClearType;
  readonly lines: number;
  readonly spin: SpinKind;
  /** Level **before** the clear (the level used for every multiplication). */
  readonly level: number;
  /** Whether the previous line-clearing lock was a difficult clear. */
  readonly backToBack: boolean;
  /** Consecutive line-clearing locks including this one; 0 or 1 means no combo bonus. */
  readonly combo: number;
  readonly perfectClear: boolean;
  readonly drop: DropPoints;
}

export interface ScoreOutput {
  readonly points: number;
  readonly breakdown: readonly ScoreLine[];
  readonly backToBackApplied: boolean;
  readonly comboBonus: number;
  readonly perfectClearBonus: number;
  readonly base: number;
}

/** Base action score before the level multiplier. */
export function baseActionPoints(clearType: ClearType, spin: SpinKind, lines: number, table: ScoringRules['base']): number {
  if (spin === 'tspin') {
    if (lines <= 0) return table.spinNoLines;
    if (lines === 1) return table.spinSingle;
    if (lines === 2) return table.spinDouble;
    return table.spinTriple;
  }
  if (spin === 'mini') {
    if (lines <= 0) return table.miniSpinNoLines;
    if (lines === 1) return table.miniSpinSingle;
    // A Mini T-Spin Triple is not reachable with SRS geometry; treat it as the double value.
    return table.miniSpinDouble;
  }
  switch (clearType) {
    case 'single':
      return table.single;
    case 'double':
      return table.double;
    case 'triple':
      return table.triple;
    case 'quad':
      return table.quad;
    default:
      return 0;
  }
}

/** "Difficult" clears are the ones that extend a back-to-back chain. RULESET §8. */
export function isDifficultClear(lines: number, spin: SpinKind): boolean {
  if (lines <= 0) return false;
  if (lines >= 4) return true;
  return spin === 'tspin' || spin === 'mini';
}

/** Human-readable name for a clear, used in the HUD and the summary screen. */
export function clearLabel(clearType: ClearType, spin: SpinKind): string {
  const prefix = spin === 'tspin' ? 'T-Spin ' : spin === 'mini' ? 'Mini T-Spin ' : '';
  switch (clearType) {
    case 'single':
      return `${prefix}Single`;
    case 'double':
      return `${prefix}Double`;
    case 'triple':
      return `${prefix}Triple`;
    case 'quad':
      return 'Four-line clear';
    default:
      return prefix ? prefix.trim() : 'No clear';
  }
}

export function scoreLock(input: ScoreInput, rules: ScoringRules): ScoreOutput {
  const breakdown: ScoreLine[] = [];
  const base = baseActionPoints(input.clearType, input.spin, input.lines, rules.base) * input.level;
  let points = 0;

  if (base > 0) {
    breakdown.push({ label: clearLabel(input.clearType, input.spin), points: base });
    points += base;
  }

  const difficult = isDifficultClear(input.lines, input.spin);
  const backToBackApplied = difficult && input.backToBack && base > 0;
  let backToBackBonus = 0;
  if (backToBackApplied) {
    backToBackBonus = Math.floor(base * (rules.backToBackMultiplier - 1));
    breakdown.push({ label: 'Back-to-Back', points: backToBackBonus });
    points += backToBackBonus;
  }

  let comboBonus = 0;
  if (input.combo >= 2) {
    comboBonus = rules.comboBase * (input.combo - 1) * input.level;
    breakdown.push({ label: `Combo ×${input.combo}`, points: comboBonus });
    points += comboBonus;
  }

  let perfectClearBonus = 0;
  if (input.perfectClear && rules.perfectClear && input.lines > 0) {
    const table = rules.perfectClear;
    const isBackToBackQuad = input.lines >= 4 && backToBackApplied;
    const value = isBackToBackQuad
      ? table.backToBackQuad
      : input.lines === 1
        ? table.single
        : input.lines === 2
          ? table.double
          : input.lines === 3
            ? table.triple
            : table.quad;
    perfectClearBonus = value * input.level;
    breakdown.push({ label: 'Perfect Clear', points: perfectClearBonus });
    points += perfectClearBonus;
  }

  const dropPoints = Math.round(
    (input.drop.softDropCells * rules.softDropPerCell + input.drop.hardDropCells * rules.hardDropPerCell) *
      (rules.multiplyDropsByLevel ? input.level : 1),
  );
  if (dropPoints > 0) {
    breakdown.push({ label: 'Drop', points: dropPoints });
    points += dropPoints;
  }

  return { points, breakdown, backToBackApplied, comboBonus, perfectClearBonus, base };
}

export interface AttackInput {
  readonly clearType: ClearType;
  readonly lines: number;
  readonly spin: SpinKind;
  readonly backToBack: boolean;
  readonly combo: number;
  readonly perfectClear: boolean;
}

/**
 * Garbage sent for one lock. The server recomputes this from the same function, so a client
 * that lies about its clears is still questioned — see `docs/PROTOCOL.md` for the limits.
 */
export function computeAttack(input: AttackInput, rules: AttackRules): AttackResult {
  if (!rules.enabled) return { lines: 0, base: 0, backToBackBonus: 0, comboBonus: 0, perfectClearBonus: 0 };

  let base = 0;
  if (input.spin === 'tspin') {
    base =
      input.lines <= 0
        ? rules.base.spinNoLines
        : input.lines === 1
          ? rules.base.spinSingle
          : input.lines === 2
            ? rules.base.spinDouble
            : rules.base.spinTriple;
  } else if (input.spin === 'mini') {
    base =
      input.lines <= 0
        ? rules.base.miniSpinNoLines
        : input.lines === 1
          ? rules.base.miniSpinSingle
          : rules.base.miniSpinDouble;
  } else {
    base =
      input.lines <= 0
        ? 0
        : input.lines === 1
          ? rules.base.single
          : input.lines === 2
            ? rules.base.double
            : input.lines === 3
              ? rules.base.triple
              : rules.base.quad;
  }

  let backToBackBonus = 0;
  if (input.backToBack && isDifficultClear(input.lines, input.spin)) {
    if (input.spin === 'tspin') {
      backToBackBonus =
        input.lines === 1
          ? rules.backToBack.spinSingle
          : input.lines === 2
            ? rules.backToBack.spinDouble
            : input.lines >= 3
              ? rules.backToBack.spinTriple
              : 0;
    } else if (input.spin === 'mini') {
      backToBackBonus = input.lines === 1 ? rules.backToBack.miniSpinSingle : rules.backToBack.miniSpinDouble;
    } else if (input.lines >= 4) {
      backToBackBonus = rules.backToBack.quad;
    }
  }

  const comboBonus =
    input.combo >= 2 && rules.comboStep > 0
      ? Math.min((input.combo - 1) * rules.comboStep, rules.comboCap)
      : 0;

  const perfectClearBonus = input.perfectClear && input.lines > 0 ? rules.perfectClear : 0;

  return {
    lines: base + backToBackBonus + comboBonus + perfectClearBonus,
    base,
    backToBackBonus,
    comboBonus,
    perfectClearBonus,
  };
}
