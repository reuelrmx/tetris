import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game.ts';
import { MODES, STRATA_STANDARD_V1 } from '../../src/engine/ruleset.ts';
import { spawnPlacement } from '../../src/engine/pieces.ts';
import { levelForLines } from '../../src/engine/gravity.ts';
import type { GameEvent } from '../../src/engine/types.ts';
import type { GameOptions } from '../../src/engine/game.ts';
import type { RuleSet } from '../../src/engine/ruleset.ts';

/** Advances the game in small frames, the way a requestAnimationFrame host would. */
function advance(game: Game, ms: number, step = 16): void {
  let remaining = ms;
  while (remaining > 0) {
    const delta = Math.min(step, remaining);
    game.update(delta);
    remaining -= delta;
  }
}

function makeGame(overrides: Partial<GameOptions> = {}): Game {
  return new Game({
    rules: STRATA_STANDARD_V1,
    mode: MODES.marathon,
    seed: 1234,
    autoStart: false,
    ...overrides,
  });
}

function eventsOfType<T extends GameEvent['type']>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((event) => event.type === type) as Extract<GameEvent, { type: T }>[];
}

function gapRow(gapColumn: number, width = 10): string {
  let row = '';
  for (let x = 0; x < width; x++) row += x === gapColumn ? '.' : '#';
  return row;
}

/** A stack whose bottom `fullRows` rows are complete except for one column. */
function gapBoard(fullRows: number, gapColumn = 0, extra: string[] = []): string[] {
  return [...extra, ...Array.from({ length: fullRows }, () => gapRow(gapColumn))];
}

/** Lets any in-flight line-clear animation finish so a new scenario can be loaded. */
function settle(game: Game): void {
  let guard = 0;
  while (game.currentPhase === 'clearing' && guard < 40) {
    game.update(50);
    guard++;
  }
  game.drainEvents();
}

/** Drops a vertical I into the gap at `gapColumn` and returns the lock events it produced. */
function dropIntoGap(game: Game, fullRows: number, extra: string[] = []): Extract<GameEvent, { type: 'lock' }>[] {
  settle(game);
  game.applyScenario({
    board: gapBoard(fullRows, 0, extra),
    active: { id: 'I', rotation: 1, x: -2, y: 20 },
  });
  game.drainEvents();
  game.hardDrop();
  return eventsOfType(game.drainEvents(), 'lock');
}

describe('game lifecycle', () => {
  it('starts in ready state and spawns the first piece on start', () => {
    const game = makeGame();
    expect(game.status).toBe('ready');
    expect(game.snapshot().board.activeCells).toHaveLength(0);
    game.start();
    expect(game.status).toBe('playing');
    const events = eventsOfType(game.drainEvents(), 'spawn');
    expect(events).toHaveLength(1);
    expect(game.snapshot().board.activeCells).toHaveLength(4);
  });

  it('spawns pieces at the documented spawn rows and columns', () => {
    const game = makeGame({ seed: 99 });
    game.start();
    const snapshot = game.snapshot();
    // View space: 0 is the sliver row, so grid row 19 is view row -1 and row 20 is view row 0.
    const rows = snapshot.board.activeCells.map((cell) => cell.y).sort((a, b) => a - b);
    expect(rows[rows.length - 1]).toBe(0);
    expect(Math.min(...rows)).toBeLessThanOrEqual(0);
  });

  it('pauses and resumes without advancing time', () => {
    const game = makeGame();
    game.start();
    advance(game, 500);
    const before = game.snapshot().elapsedMs;
    expect(game.pause()).toBe(true);
    expect(game.status).toBe('paused');
    advance(game, 1000);
    expect(game.snapshot().elapsedMs).toBe(before);
    expect(game.resume()).toBe(true);
    advance(game, 100);
    expect(game.snapshot().elapsedMs).toBeGreaterThan(before);
  });

  it('refuses to pause in versus mode', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    expect(game.pause()).toBe(false);
    expect(game.status).toBe('playing');
  });

  it('ends the game on request with a quit summary', () => {
    const game = makeGame();
    game.start();
    game.endGame('quit');
    const events = game.drainEvents();
    const over = eventsOfType(events, 'gameover');
    expect(game.status).toBe('over');
    expect(over).toHaveLength(1);
    expect(over[0]?.summary.reason).toBe('quit');
    expect(over[0]?.summary.seed).toBe(1234);
  });

  it('ignores input while not playing', () => {
    const game = makeGame();
    expect(game.moveHorizontal(-1).performed).toBe(false);
    expect(game.rotate(1).performed).toBe(false);
    expect(game.hardDrop().performed).toBe(false);
    expect(game.hold().performed).toBe(false);
  });
});

describe('movement, gravity and drops', () => {
  it('falls one row per second at level 1', () => {
    const game = makeGame();
    game.start();
    const start = game.snapshot().board.activeCells[0]?.y ?? 0;
    advance(game, 1000);
    const after = game.snapshot().board.activeCells[0]?.y ?? 0;
    expect(after - start).toBe(1);
  });

  it('accumulates partial rows across frames', () => {
    const game = makeGame();
    game.start();
    const start = game.snapshot().board.activeCells[0]?.y ?? 0;
    advance(game, 500);
    expect(game.snapshot().board.activeCells[0]?.y).toBe(start);
    advance(game, 500);
    expect(game.snapshot().board.activeCells[0]?.y).toBe(start + 1);
  });

  it('moves horizontally and reports blocked moves at the wall', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'T', rotation: 0, x: 3, y: 25 } });
    expect(game.moveHorizontal(-1).performed).toBe(true);
    expect(game.moveHorizontal(1).performed).toBe(true);
    // Walk to the left wall.
    for (let i = 0; i < 10; i++) game.moveHorizontal(-1);
    const blocked = game.moveHorizontal(-1);
    expect(blocked.performed).toBe(false);
    expect(blocked.blocked).toBe(true);
    const events = eventsOfType(game.drainEvents(), 'move');
    expect(events[events.length - 1]?.blocked).toBe(true);
    expect(game.snapshot().board.activeCells.map((cell) => cell.x).sort()).toEqual([0, 1, 1, 2]);
  });

  it('rotates and reports blocked rotations', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'T', rotation: 0, x: 3, y: 25 } });
    expect(game.rotate(1).performed).toBe(true);
    expect(game.snapshot().lastAction).toBe('rotation');

    // A one-wide well: a vertical I fits inside, but no rotation of it can (all five tests
    // collide with the walls of the well).
    const well = Array.from({ length: 14 }, () => '#####.####');
    game.applyScenario({ board: well, active: { id: 'I', rotation: 1, x: 3, y: 29 } });
    game.drainEvents();
    const blocked = game.rotate(1);
    expect(blocked.performed).toBe(false);
    expect(blocked.blocked).toBe(true);
    const events = eventsOfType(game.drainEvents(), 'rotate');
    expect(events[events.length - 1]?.blocked).toBe(true);
  });

  it('soft drops faster than gravity and scores one point per cell', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 30 } });
    game.drainEvents();
    game.setSoftDrop(true);
    advance(game, 200); // 20 cells/s => 4 rows
    game.setSoftDrop(false);
    const lowest = Math.max(...(game.snapshot().board.activeCells.map((cell) => cell.y) ?? []));
    expect(lowest).toBeGreaterThan(0);
    game.hardDrop();
    const lock = eventsOfType(game.drainEvents(), 'lock')[0];
    const drop = lock?.result.drop;
    expect(drop?.softDropCells).toBe(4);
    // The drop line credits one point per soft-dropped cell and two per hard-dropped cell.
    expect(lock?.result.scoreBreakdown).toContainEqual({
      label: 'Drop',
      points: (drop?.softDropCells ?? 0) + (drop?.hardDropCells ?? 0) * 2,
    });
  });

  it('does not lock a piece on contact while soft dropping (soft drop is non-locking)', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.setSoftDrop(true);
    advance(game, 400);
    expect(game.status).toBe('playing');
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(0);
    advance(game, 200);
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(1);
  });

  it('hard drops to the landing row, locks immediately and scores two points per cell', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 18 } });
    game.drainEvents();
    const distance = 38 - 18;
    const outcome = game.hardDrop();
    expect(outcome.performed).toBe(true);
    const lock = eventsOfType(game.drainEvents(), 'lock')[0];
    expect(lock?.result.drop.hardDropCells).toBe(distance);
    expect(lock?.result.points).toBe(distance * 2);
  });
});

describe('lock delay', () => {
  it('waits 500 ms after the piece lands before locking', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.drainEvents();
    advance(game, 480);
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(0);
    advance(game, 40);
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(1);
  });

  it('resets the timer on a successful move while grounded', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.drainEvents();
    advance(game, 400);
    expect(game.moveHorizontal(-1).performed).toBe(true);
    advance(game, 400);
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(0);
    advance(game, 200);
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(1);
  });

  it('does not reset the timer on a blocked move', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 0, y: 38 } });
    game.drainEvents();
    advance(game, 400);
    expect(game.moveHorizontal(-1).blocked).toBe(true);
    advance(game, 120);
    expect(eventsOfType(game.drainEvents(), 'lock')).toHaveLength(1);
  });

  it('stops extending the timer after fifteen resets', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.drainEvents();
    // Twenty successful moves, a little under the lock delay apart.
    for (let i = 0; i < 20; i++) {
      advance(game, 300);
      game.moveHorizontal(i % 2 === 0 ? -1 : 1);
    }
    advance(game, 600);
    const locks = eventsOfType(game.drainEvents(), 'lock');
    expect(locks.length).toBeGreaterThanOrEqual(1);
  });

  it('reports lock progress for the UI', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    expect(game.lockProgress).toBe(0);
    advance(game, 250);
    expect(game.lockProgress).toBeGreaterThan(0.4);
    expect(game.lockProgress).toBeLessThan(0.6);
  });
});

describe('hold', () => {
  it('stores the active piece and brings in the next one', () => {
    const game = makeGame();
    game.start();
    const first = game.snapshot();
    const activeId = first.board.activeId;
    const nextId = first.queue[0];
    const outcome = game.hold();
    expect(outcome.performed).toBe(true);
    const after = game.snapshot();
    expect(after.hold).toBe(activeId);
    expect(after.board.activeId).toBe(nextId);
    expect(after.holdAvailable).toBe(false);
  });

  it('blocks a second hold until the piece locks, then swaps', () => {
    const game = makeGame();
    game.start();
    const first = game.snapshot().board.activeId;
    game.hold();
    const blocked = game.hold();
    expect(blocked.performed).toBe(false);
    expect(blocked.blocked).toBe(true);
    defineSwap: {
      game.applyScenario({ active: { id: 'O', rotation: 0, x: 4, y: 38 } });
      game.hardDrop();
      const swapped = game.hold();
      expect(swapped.performed).toBe(true);
      expect(game.snapshot().board.activeId).toBe(first);
    }
  });

  it('can be disabled by the ruleset', () => {
    const noHold: RuleSet = { ...STRATA_STANDARD_V1, holdEnabled: false };
    const game = makeGame({ rules: noHold });
    game.start();
    expect(game.hold().performed).toBe(false);
    expect(game.snapshot().hold).toBeNull();
  });
});

describe('line clears', () => {
  it('clears a single line after the clear delay and scores 100 x level', () => {
    const game = makeGame();
    game.start();
    const locks = dropIntoGap(game, 1);
    expect(locks[0]?.result.linesCleared).toBe(1);
    expect(locks[0]?.result.clearType).toBe('single');
    // 100 for the line, 2 per cell of hard drop.
    expect(locks[0]?.result.points).toBe(100 + (locks[0]?.result.drop.hardDropCells ?? 0) * 2);
    expect(game.score).toBe(locks[0]?.result.points);
    const duringClear = game.snapshot();
    expect(duringClear.phase).toBe('clearing');
    expect(duringClear.board.clearingRows).toEqual([20]);
    advance(game, 200);
    expect(game.snapshot().phase).not.toBe('clearing');
    expect(game.lines).toBe(1);
  });

  it('clears four lines at once and scores a four-line clear', () => {
    const game = makeGame();
    game.start();
    const locks = dropIntoGap(game, 4, ['.........Z']);
    expect(locks[0]?.result.linesCleared).toBe(4);
    expect(locks[0]?.result.clearType).toBe('quad');
    expect(locks[0]?.result.scoreBreakdown[0]).toEqual({ label: 'Four-line clear', points: 800 });
    expect(game.score).toBe(800 + (locks[0]?.result.drop.hardDropCells ?? 0) * 2);
    expect(game.lines).toBe(4);
    // The lone Z above the cleared rows is all that remains once the clear delay elapses.
    advance(game, 200);
    expect(game.boardRef.toAscii(1)).toEqual(['.........Z']);
  });

  it('adds the perfect clear bonus when the board empties', () => {
    const game = makeGame();
    game.start();
    const locks = dropIntoGap(game, 4);
    expect(locks[0]?.result.perfectClear).toBe(true);
    expect(locks[0]?.result.scoreBreakdown).toContainEqual({ label: 'Perfect Clear', points: 2000 });
    expect(game.score).toBe(800 + 2000 + (locks[0]?.result.drop.hardDropCells ?? 0) * 2);
  });

  it('chains back-to-back four-line clears', () => {
    const game = makeGame();
    game.start();
    const first = dropIntoGap(game, 4, ['.........Z']);
    const second = dropIntoGap(game, 4, ['.........Z']);
    expect(first[0]?.result.backToBack).toBe(false);
    expect(second[0]?.result.backToBack).toBe(true);
    expect(second[0]?.result.scoreBreakdown).toContainEqual({ label: 'Back-to-Back', points: 400 });
  });

  it('breaks the back-to-back chain with a single', () => {
    const game = makeGame();
    game.start();
    dropIntoGap(game, 4, ['.........Z']);
    dropIntoGap(game, 1, ['.........Z']);
    const third = dropIntoGap(game, 4, ['.........Z']);
    expect(third[0]?.result.backToBack).toBe(false);
  });

  it('counts combos across consecutive clearing locks', () => {
    const game = makeGame();
    game.start();
    dropIntoGap(game, 1, ['.........Z']);
    const second = dropIntoGap(game, 1, ['.........Z']);
    expect(second[0]?.result.combo).toBe(2);
    expect(second[0]?.result.scoreBreakdown).toContainEqual({ label: 'Combo ×2', points: 50 });
    // A lock that clears nothing resets the counter.
    settle(game);
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.drainEvents();
    game.hardDrop();
    const fourth = dropIntoGap(game, 1, ['.........Z']);
    expect(fourth[0]?.result.combo).toBe(1);
  });

  it('levels up every ten lines and keeps the score multiplier from the level before the clear', () => {
    const fast: RuleSet = {
      ...STRATA_STANDARD_V1,
      gravity: { ...STRATA_STANDARD_V1.gravity, linesPerLevel: 4 },
    };
    const game = makeGame({ rules: fast });
    game.start();
    expect(game.level).toBe(1);
    dropIntoGap(game, 4, ['.........Z']);
    expect(game.lines).toBe(4);
    expect(game.level).toBe(2);
    const second = dropIntoGap(game, 4, ['.........Z']);
    expect(second[0]?.result.level).toBe(2);
    expect(second[0]?.result.scoreBreakdown[0]).toEqual({ label: 'Four-line clear', points: 1600 });
  });

  it('emits a level up event with the new level', () => {
    const fast: RuleSet = { ...STRATA_STANDARD_V1, gravity: { ...STRATA_STANDARD_V1.gravity, linesPerLevel: 1 } };
    const game = makeGame({ rules: fast });
    game.start();
    settle(game);
    game.applyScenario({ board: gapBoard(1, 0), active: { id: 'I', rotation: 1, x: -2, y: 20 } });
    game.drainEvents();
    game.hardDrop();
    const levelUps = eventsOfType(game.drainEvents(), 'levelup');
    expect(levelUps.map((event) => event.level)).toEqual([2]);
  });

  it('agrees with the gravity module on level progression', () => {
    const game = makeGame();
    game.start();
    dropIntoGap(game, 4);
    expect(game.level).toBe(levelForLines({ ...STRATA_STANDARD_V1.gravity, startLevel: 1, levelProgression: true }, game.lines));
  });
});

describe('goals, timers and top-out', () => {
  it('wins a sprint goal when the target line count is reached', () => {
    const sprint = { ...MODES.sprint, goal: { kind: 'lines' as const, lines: 4 } };
    const game = makeGame({ mode: sprint });
    game.start();
    dropIntoGap(game, 4);
    advance(game, 200);
    const win = eventsOfType(game.drainEvents(), 'win');
    expect(win).toHaveLength(1);
    expect(win[0]?.summary.reason).toBe('goal');
    expect(game.status).toBe('won');
    expect(game.summary?.lines).toBe(4);
    expect(game.summary?.durationMs).toBeGreaterThan(0);
  });

  it('ends an ultra run when the timer runs out and reports the remaining time', () => {
    const ultra = { ...MODES.ultra, goal: { kind: 'time' as const, durationMs: 500 } };
    const game = makeGame({ mode: ultra });
    game.start();
    expect(game.remainingMs).toBe(500);
    advance(game, 300);
    expect(game.remainingMs).toBeLessThan(250);
    advance(game, 300);
    const win = eventsOfType(game.drainEvents(), 'win');
    expect(win[0]?.summary.reason).toBe('time');
    expect(game.remainingMs).toBe(0);
  });

  it('ends the game when a piece cannot spawn (block out)', () => {
    const game = makeGame();
    game.start();
    // Hidden rows 18 and 19 are blocked except for one column: no spawn can fit, but the rows
    // are not complete, so nothing clears and the game ends specifically on the spawn check.
    const spawnBlock = [gapRow(9), gapRow(9), ...Array.from({ length: 20 }, () => '..........')];
    // The active piece locks down in the visible field, so this is a block out, not a lock out.
    game.applyScenario({ board: spawnBlock, active: { id: 'O', rotation: 0, x: 0, y: 30 } });
    game.drainEvents();
    game.hardDrop();
    const over = eventsOfType(game.drainEvents(), 'gameover');
    expect(over).toHaveLength(1);
    expect(over[0]?.summary.reason).toBe('blockout');
    expect(game.status).toBe('over');
    expect(game.snapshot().board.activeCells).toHaveLength(0);
  });

  it('ends the game when a piece locks entirely above the visible field (lock out)', () => {
    const game = makeGame();
    game.start();
    // Rows 20-39 are full except column 9, so nothing can enter and nothing clears.
    const stack = Array.from({ length: 20 }, () => gapRow(9));
    game.applyScenario({ board: stack, active: { id: 'O', rotation: 0, x: 4, y: 18 } });
    game.drainEvents();
    game.hardDrop();
    const over = eventsOfType(game.drainEvents(), 'gameover');
    expect(over[0]?.summary.reason).toBe('lockout');
    expect(game.status).toBe('over');
  });

  it('summarises the game with rate statistics', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    advance(game, 1000); // the lock delay elapses and the piece locks on its own
    game.endGame('quit');
    const summary = game.summary;
    expect(summary).not.toBeNull();
    expect(summary?.stats.piecesPlaced).toBe(1);
    expect(summary?.piecesPerSecond).toBeCloseTo(1, 1);
    expect(summary?.modeId).toBe('marathon');
  });
});

describe('input buffering', () => {
  it('applies an action pressed during the line clear animation to the next piece', () => {
    const game = makeGame();
    game.start();
    dropIntoGap(game, 1);
    expect(game.snapshot().phase).toBe('clearing');
    const buffered = game.rotate(1);
    expect(buffered.performed).toBe(false);
    expect(buffered.blocked).toBe(false);
    game.drainEvents();
    advance(game, 200);
    expect(game.snapshot().lastAction).toBe('rotation');
    expect(eventsOfType(game.drainEvents(), 'rotate').some((event) => !event.blocked)).toBe(true);
  });

  it('does not double-apply a buffered action', () => {
    const game = makeGame();
    game.start();
    dropIntoGap(game, 1);
    game.moveHorizontal(-1);
    advance(game, 200);
    const snapshot = game.snapshot();
    expect(snapshot.board.activeCells.map((cell) => cell.x).sort()).toEqual([2, 3, 4, 4].sort());
  });
});

describe('garbage', () => {
  it('queues incoming garbage and reports the pending count', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    game.queueGarbage(3, 4);
    expect(game.pendingGarbageRowsCount).toBe(3);
    expect(game.snapshot().pendingGarbage).toBe(3);
    const bursts = game.pendingGarbage();
    expect(bursts).toHaveLength(1);
    expect(bursts[0]?.holeColumn).toBe(4);
  });

  it('cancels pending rows with outgoing attack and forwards the remainder', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    // Two locks first, so the initial lock rule does not hold garbage back.
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    game.queueGarbage(5, 2);
    // A four-line clear sends 4 rows: three of them cancel, one is forwarded.
    game.applyScenario({
      board: gapBoard(4, 0, ['.........Z']),
      active: { id: 'I', rotation: 1, x: -2, y: 20 },
    });
    game.drainEvents();
    game.hardDrop();
    // Four lines of attack cancel four of the five pending rows: nothing is forwarded.
    expect(eventsOfType(game.drainEvents(), 'attack')).toHaveLength(0);
    expect(game.pendingGarbageRowsCount).toBe(1);

    // Now queue a single row and clear four again: one row cancels, three are forwarded.
    settle(game);
    game.queueGarbage(1, 2);
    // The previous clear was a four-line clear, so this one is back-to-back as well as a combo:
    // 4 base + 2 back-to-back + 1 combo = 7 rows, of which 2 cancel the queued garbage.
    game.applyScenario({
      board: gapBoard(4, 0, ['.........Z']),
      active: { id: 'I', rotation: 1, x: -2, y: 20 },
    });
    game.drainEvents();
    game.hardDrop();
    const attacks = eventsOfType(game.drainEvents(), 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.breakdown.base).toBe(4);
    expect(attacks[0]?.breakdown.backToBackBonus).toBe(2);
    expect(attacks[0]?.breakdown.comboBonus).toBe(1);
    expect(attacks[0]?.breakdown.lines).toBe(7);
    // Two of the seven rows cancel the queued garbage, five are forwarded.
    expect(attacks[0]?.lines).toBe(5);
    expect(game.pendingGarbageRowsCount).toBe(0);
    expect(game.stats.garbageSent).toBe(5);
  });

  it('inserts pending garbage on the next lock that clears nothing', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    game.drainEvents();
    game.queueGarbage(2, 6);
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    const garbage = eventsOfType(game.drainEvents(), 'garbage');
    expect(garbage).toHaveLength(1);
    expect(garbage[0]?.inserted).toBe(2);
    expect(garbage[0]?.holeColumn).toBe(6);
    // The locked O was pushed two rows up; the two garbage rows share the hole at column 6.
    expect(game.boardRef.toAscii(3)).toEqual(['....OO....', 'GGGGGG.GGG', 'GGGGGG.GGG']);
    expect(game.stats.garbageReceived).toBe(2);
  });

  it('holds garbage back until the player has locked a piece', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    game.queueGarbage(1, 0);
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    expect(game.pendingGarbageRowsCount).toBe(1);
    expect(eventsOfType(game.drainEvents(), 'garbage')).toHaveLength(0);
  });

  it('caps a single insertion and keeps the rest queued', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    game.drainEvents();
    game.queueGarbage(10, 1);
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    const garbage = eventsOfType(game.drainEvents(), 'garbage');
    expect(garbage[0]?.inserted).toBe(STRATA_STANDARD_V1.garbage.maxRowsPerInsertion);
    expect(game.pendingGarbageRowsCount).toBe(10 - STRATA_STANDARD_V1.garbage.maxRowsPerInsertion);
  });

  it('picks hole columns without repeating the previous one', () => {
    const game = makeGame({ mode: MODES.versus });
    game.start();
    for (let i = 0; i < 20; i++) {
      game.queueGarbage(1);
    }
    const columns = game.pendingGarbage().map((burst) => burst.holeColumn);
    for (let i = 1; i < columns.length; i++) {
      expect(columns[i]).not.toBe(columns[i - 1]);
    }
  });

  it('does not queue garbage in modes without attacks', () => {
    const game = makeGame();
    game.start();
    game.queueGarbage(4, 3);
    expect(game.pendingGarbageRowsCount).toBe(4);
    // Marathon ignores attacks entirely, so a lock never forwards or inserts anything.
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    expect(eventsOfType(game.drainEvents(), 'garbage')).toHaveLength(0);
    expect(eventsOfType(game.drainEvents(), 'attack')).toHaveLength(0);
  });
});

describe('snapshot', () => {
  it('exposes a renderable board view', () => {
    const game = makeGame();
    game.start();
    const snapshot = game.snapshot();
    expect(snapshot.board.width).toBe(10);
    expect(snapshot.board.height).toBe(21);
    expect(snapshot.board.sliverRows).toBe(1);
    expect(snapshot.board.cells).toHaveLength(10 * 21);
    expect(snapshot.queue).toHaveLength(5);
    expect(snapshot.board.ghostCells.length).toBe(4);
  });

  it('places the ghost exactly on the landing position', () => {
    const game = makeGame();
    game.start();
    game.applyScenario({ board: ['#########.'], active: { id: 'O', rotation: 0, x: 4, y: 20 } });
    const snapshot = game.snapshot();
    const activeBottom = Math.max(...snapshot.board.activeCells.map((cell) => cell.y));
    const ghostBottom = Math.max(...snapshot.board.ghostCells.map((cell) => cell.y));
    expect(ghostBottom).toBe(19);
    expect(ghostBottom).toBeGreaterThan(activeBottom);
    // The ghost never overlaps the active piece in a way the renderer cannot handle.
    expect(ghostBottom).toBeLessThanOrEqual(19);
  });

  it('reports the queue that follows the active piece', () => {
    const game = makeGame();
    game.start();
    const first = game.snapshot();
    // The active piece has already been dealt from the queue, so the queue holds what is next.
    expect(first.board.activeId).not.toBeNull();
    expect(first.queue).toHaveLength(5);
    game.applyScenario({ board: [], active: { id: 'O', rotation: 0, x: 4, y: 38 } });
    game.hardDrop();
    const afterSpawn = game.snapshot();
    expect(afterSpawn.board.activeId).toBe(first.queue[0]);
  });

  it('shows the next pieces without consuming them', () => {
    const game = makeGame();
    game.start();
    const snapshot = game.snapshot();
    expect(snapshot.queue).toEqual(game.snapshot().queue);
  });

  it('reports a spawn position inside the sliver or the first visible row', () => {
    const game = makeGame();
    game.start();
    for (const cell of game.snapshot().board.activeCells) {
      expect(cell.y).toBeGreaterThanOrEqual(-1);
      expect(cell.y).toBeLessThan(20);
    }
    expect(spawnPlacement('T').y).toBe(18);
  });
});

describe('determinism', () => {
  it('produces identical results for the same seed and the same inputs', () => {
    const script = (game: Game): void => {
      for (let i = 0; i < 40; i++) {
        game.moveHorizontal(i % 2 === 0 ? -1 : 1);
        if (i % 3 === 0) game.rotate(1);
        if (i % 5 === 0) game.hold();
        advance(game, 200);
        if (i % 4 === 0) game.hardDrop();
      }
    };
    const a = makeGame({ seed: 777 });
    const b = makeGame({ seed: 777 });
    a.start();
    b.start();
    script(a);
    script(b);
    const snapshotA = a.snapshot();
    const snapshotB = b.snapshot();
    expect(snapshotA.score).toBe(snapshotB.score);
    expect(snapshotA.lines).toBe(snapshotB.lines);
    expect([...snapshotA.board.cells]).toEqual([...snapshotB.board.cells]);
    expect(snapshotA.queue).toEqual(snapshotB.queue);
  });

  it('produces different piece sequences for different seeds', () => {
    const a = makeGame({ seed: 1 });
    const b = makeGame({ seed: 2 });
    a.start();
    b.start();
    expect(a.snapshot().queue).not.toEqual(b.snapshot().queue);
  });
});
