import { describe, expect, it } from 'vitest';
import {
  STRATA_STANDARD_V1,
  baseActionPoints,
  clearLabel,
  computeAttack,
  isDifficultClear,
  scoreLock,
} from '../../src/engine/index.ts';
import type { AttackInput, ClearType, ScoreInput, SpinKind } from '../../src/engine/index.ts';

const rules = STRATA_STANDARD_V1.scoring;
const attackRules = STRATA_STANDARD_V1.attack;

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    clearType: 'none',
    lines: 0,
    spin: 'none',
    level: 1,
    backToBack: false,
    combo: 0,
    perfectClear: false,
    drop: { softDropCells: 0, hardDropCells: 0 },
    ...overrides,
  };
}

function attack(overrides: Partial<AttackInput> = {}): AttackInput {
  return {
    clearType: 'none',
    lines: 0,
    spin: 'none',
    backToBack: false,
    combo: 0,
    perfectClear: false,
    ...overrides,
  };
}

const CLEARS: ReadonlyArray<{ clear: ClearType; lines: number; base: number }> = [
  { clear: 'single', lines: 1, base: 100 },
  { clear: 'double', lines: 2, base: 300 },
  { clear: 'triple', lines: 3, base: 500 },
  { clear: 'quad', lines: 4, base: 800 },
];

describe('base action score', () => {
  it('uses the sighted line-clear table', () => {
    for (const entry of CLEARS) {
      expect(baseActionPoints(entry.clear, 'none', entry.lines, rules.base)).toBe(entry.base);
    }
  });

  it('scores T-Spins above the equivalent plain clear', () => {
    expect(baseActionPoints('single', 'tspin', 1, rules.base)).toBe(800);
    expect(baseActionPoints('double', 'tspin', 2, rules.base)).toBe(1200);
    expect(baseActionPoints('triple', 'tspin', 3, rules.base)).toBe(1600);
    expect(baseActionPoints('none', 'tspin', 0, rules.base)).toBe(400);
  });

  it('scores Mini T-Spins lower', () => {
    expect(baseActionPoints('single', 'mini', 1, rules.base)).toBe(200);
    expect(baseActionPoints('double', 'mini', 2, rules.base)).toBe(400);
    expect(baseActionPoints('none', 'mini', 0, rules.base)).toBe(100);
  });

  it('scores nothing for an ordinary no-line lock', () => {
    expect(baseActionPoints('none', 'none', 0, rules.base)).toBe(0);
  });
});

describe('lock scoring', () => {
  it('multiplies the base value by the level that was active before the clear', () => {
    const result = scoreLock(input({ clearType: 'single', lines: 1, level: 5 }), rules);
    expect(result.base).toBe(500);
    expect(result.points).toBe(500);
    expect(result.breakdown).toEqual([{ label: 'Single', points: 500 }]);
  });

  it('applies back-to-back as half the base again', () => {
    const result = scoreLock(input({ clearType: 'quad', lines: 4, backToBack: true }), rules);
    expect(result.base).toBe(800);
    expect(result.backToBackApplied).toBe(true);
    expect(result.points).toBe(1200);
    expect(result.breakdown).toEqual([
      { label: 'Four-line clear', points: 800 },
      { label: 'Back-to-Back', points: 400 },
    ]);
  });

  it('chains T-Spins back to back', () => {
    const result = scoreLock(input({ clearType: 'double', lines: 2, spin: 'tspin', backToBack: true }), rules);
    expect(result.breakdown).toEqual([
      { label: 'T-Spin Double', points: 1200 },
      { label: 'Back-to-Back', points: 600 },
    ]);
    expect(result.points).toBe(1800);
  });

  it('does not start a back-to-back chain from a single', () => {
    expect(isDifficultClear(1, 'none')).toBe(false);
    expect(isDifficultClear(4, 'none')).toBe(true);
    expect(isDifficultClear(1, 'tspin')).toBe(true);
    expect(isDifficultClear(0, 'tspin')).toBe(false);
    const result = scoreLock(input({ clearType: 'single', lines: 1, backToBack: true }), rules);
    expect(result.backToBackApplied).toBe(false);
    expect(result.points).toBe(100);
  });

  it('pays a combo bonus from the second consecutive clear', () => {
    expect(scoreLock(input({ clearType: 'single', lines: 1, combo: 1 }), rules).comboBonus).toBe(0);
    expect(scoreLock(input({ clearType: 'single', lines: 1, combo: 2 }), rules).comboBonus).toBe(50);
    expect(scoreLock(input({ clearType: 'single', lines: 1, combo: 3 }), rules).comboBonus).toBe(100);
    const level5 = scoreLock(input({ clearType: 'single', lines: 1, combo: 4, level: 5 }), rules);
    expect(level5.comboBonus).toBe(50 * 3 * 5);
    expect(level5.breakdown).toEqual([
      { label: 'Single', points: 500 },
      { label: 'Combo ×4', points: 750 },
    ]);
  });

  it('stacks combo, back-to-back and level', () => {
    const result = scoreLock(
      input({ clearType: 'quad', lines: 4, level: 2, backToBack: true, combo: 3 }),
      rules,
    );
    expect(result.base).toBe(1600);
    expect(result.breakdown).toContainEqual({ label: 'Back-to-Back', points: 800 });
    expect(result.comboBonus).toBe(200);
    expect(result.points).toBe(2600);
  });

  it('awards perfect clear bonuses on top of the clear', () => {
    const quad = scoreLock(input({ clearType: 'quad', lines: 4, perfectClear: true }), rules);
    expect(quad.perfectClearBonus).toBe(2000);
    expect(quad.points).toBe(2800);

    const backToBackQuad = scoreLock(
      input({ clearType: 'quad', lines: 4, perfectClear: true, backToBack: true }),
      rules,
    );
    expect(backToBackQuad.perfectClearBonus).toBe(3200);
    expect(backToBackQuad.points).toBe(800 + 400 + 3200);

    expect(scoreLock(input({ clearType: 'single', lines: 1, perfectClear: true }), rules).perfectClearBonus).toBe(800);
    expect(scoreLock(input({ clearType: 'double', lines: 2, perfectClear: true }), rules).perfectClearBonus).toBe(1200);
    expect(scoreLock(input({ clearType: 'triple', lines: 3, perfectClear: true }), rules).perfectClearBonus).toBe(1800);
  });

  it('ignores a perfect clear on a lock that cleared nothing', () => {
    expect(scoreLock(input({ perfectClear: true }), rules).perfectClearBonus).toBe(0);
  });

  it('adds soft and hard drop points', () => {
    const result = scoreLock(input({ drop: { softDropCells: 5, hardDropCells: 10 } }), rules);
    expect(result.points).toBe(25);
    expect(result.breakdown).toEqual([{ label: 'Drop', points: 25 }]);
  });

  it('leaves drop points unscaled by level unless the ruleset says otherwise', () => {
    const scaled = { ...rules, multiplyDropsByLevel: true };
    expect(scoreLock(input({ level: 4, drop: { softDropCells: 3, hardDropCells: 0 } }), rules).points).toBe(3);
    expect(scoreLock(input({ level: 4, drop: { softDropCells: 3, hardDropCells: 0 } }), scaled).points).toBe(12);
  });

  it('labels clears for the HUD', () => {
    expect(clearLabel('single', 'none')).toBe('Single');
    expect(clearLabel('double', 'tspin')).toBe('T-Spin Double');
    expect(clearLabel('triple', 'mini')).toBe('Mini T-Spin Triple');
    expect(clearLabel('quad', 'none')).toBe('Four-line clear');
    expect(clearLabel('none', 'none')).toBe('No clear');
  });
});

describe('attack table', () => {
  const expected: ReadonlyArray<[string, Partial<AttackInput>, number]> = [
    ['single', { clearType: 'single', lines: 1 }, 0],
    ['double', { clearType: 'double', lines: 2 }, 1],
    ['triple', { clearType: 'triple', lines: 3 }, 2],
    ['quad', { clearType: 'quad', lines: 4 }, 4],
    ['T-Spin Single', { clearType: 'single', lines: 1, spin: 'tspin' }, 2],
    ['T-Spin Double', { clearType: 'double', lines: 2, spin: 'tspin' }, 4],
    ['T-Spin Triple', { clearType: 'triple', lines: 3, spin: 'tspin' }, 6],
    ['Mini T-Spin Single', { clearType: 'single', lines: 1, spin: 'mini' }, 0],
    ['Mini T-Spin Double', { clearType: 'double', lines: 2, spin: 'mini' }, 1],
    ['no clear', {}, 0],
  ];

  it.each(expected)('sends %s -> %i lines', (_label, overrides, lines) => {
    expect(computeAttack(attack(overrides), attackRules).lines).toBe(lines);
  });

  it('adds back-to-back bonuses', () => {
    expect(computeAttack(attack({ clearType: 'quad', lines: 4, backToBack: true }), attackRules)).toMatchObject({
      base: 4,
      backToBackBonus: 2,
      lines: 6,
    });
    expect(
      computeAttack(attack({ clearType: 'double', lines: 2, spin: 'tspin', backToBack: true }), attackRules),
    ).toMatchObject({ base: 4, backToBackBonus: 2 });
    expect(
      computeAttack(attack({ clearType: 'triple', lines: 3, spin: 'tspin', backToBack: true }), attackRules),
    ).toMatchObject({ base: 6, backToBackBonus: 3 });
  });

  it('does not pay back-to-back on a non-difficult clear', () => {
    expect(computeAttack(attack({ clearType: 'single', lines: 1, backToBack: true }), attackRules).backToBackBonus).toBe(0);
  });

  it('adds one line per combo step, capped', () => {
    expect(computeAttack(attack({ clearType: 'double', lines: 2, combo: 1 }), attackRules).comboBonus).toBe(0);
    expect(computeAttack(attack({ clearType: 'double', lines: 2, combo: 2 }), attackRules).comboBonus).toBe(1);
    expect(computeAttack(attack({ clearType: 'double', lines: 2, combo: 5 }), attackRules).comboBonus).toBe(4);
    expect(computeAttack(attack({ clearType: 'double', lines: 2, combo: 50 }), attackRules).comboBonus).toBe(4);
  });

  it('adds a flat perfect clear bonus', () => {
    expect(computeAttack(attack({ clearType: 'quad', lines: 4, perfectClear: true }), attackRules).perfectClearBonus).toBe(10);
  });

  it('is disabled for single-player modes', () => {
    const disabled = { ...attackRules, enabled: false };
    expect(computeAttack(attack({ clearType: 'quad', lines: 4, backToBack: true, combo: 9 }), disabled)).toEqual({
      lines: 0,
      base: 0,
      backToBackBonus: 0,
      comboBonus: 0,
      perfectClearBonus: 0,
    });
  });

  it('caps the raw combo bonus before adding other terms', () => {
    const result = computeAttack(attack({ clearType: 'quad', lines: 4, combo: 12, perfectClear: true }), attackRules);
    expect(result).toEqual({ lines: 4 + 0 + 4 + 10, base: 4, backToBackBonus: 0, comboBonus: 4, perfectClearBonus: 10 });
  });

  it('keeps the documented attack table in one place', () => {
    expect(attackRules.base).toEqual({
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
    });
  });
});

describe('spin classification helpers', () => {
  it('treats quads and spins as difficult', () => {
    const spins: SpinKind[] = ['none', 'mini', 'tspin'];
    expect(spins.filter((spin) => isDifficultClear(1, spin))).toEqual(['mini', 'tspin']);
    expect(isDifficultClear(2, 'none')).toBe(false);
    expect(isDifficultClear(4, 'none')).toBe(true);
  });
});
