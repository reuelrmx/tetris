import { describe, expect, it } from 'vitest';
import { MIN_QUEUE, PIECE_IDS, PieceQueue, Rng } from '../../src/engine/index.ts';

function deal(queue: PieceQueue, count: number): string[] {
  return Array.from({ length: count }, () => queue.next());
}

describe('seven-bag queue', () => {
  it('deals every piece exactly once per bag', () => {
    const queue = new PieceQueue(20260101);
    const pieces = deal(queue, 70);
    for (let bag = 0; bag < pieces.length / 7; bag++) {
      expect(new Set(pieces.slice(bag * 7, bag * 7 + 7))).toEqual(new Set(PIECE_IDS));
    }
  });

  it('never repeats a piece three times in a row across bag boundaries', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const pieces = deal(new PieceQueue(seed), 70);
      for (let i = 2; i < pieces.length; i++) {
        const triple = pieces.slice(i - 2, i + 1);
        expect(new Set(triple).size).toBeGreaterThan(1);
      }
    }
  });

  it('produces the same order for the same seed', () => {
    expect(deal(new PieceQueue(4242), 20)).toEqual(deal(new PieceQueue(4242), 20));
  });

  it('produces different orders for different seeds', () => {
    const a = deal(new PieceQueue(1), 40);
    const b = deal(new PieceQueue(2), 40);
    expect(a).not.toEqual(b);
  });

  it('keeps a healthy buffer and peeks without consuming', () => {
    const queue = new PieceQueue(7);
    const peeked = queue.peek(MIN_QUEUE);
    expect(peeked).toHaveLength(MIN_QUEUE);
    expect(queue.dealt).toBe(0);
    expect(deal(queue, MIN_QUEUE)).toEqual(peeked);
    expect(queue.dealt).toBe(MIN_QUEUE);
  });

  it('peek agrees with the pieces that actually arrive', () => {
    const queue = new PieceQueue(99);
    const ahead = queue.peek(12);
    for (let i = 0; i < 12; i++) {
      expect(queue.next()).toBe(ahead[i]);
    }
  });

  it('resets to a seed', () => {
    const queue = new PieceQueue(5);
    const first = deal(queue, 14);
    queue.reset(5);
    expect(deal(queue, 14)).toEqual(first);
    queue.reset(6);
    expect(deal(queue, 14)).not.toEqual(first);
  });

  it('reports the seed it was created from', () => {
    expect(new PieceQueue(123456).initialSeed).toBe(123456);
  });
});

describe('rng', () => {
  it('is reproducible and reseedable', () => {
    const a = new Rng(1);
    const b = new Rng(1);
    const drawsA = Array.from({ length: 8 }, () => a.nextUint32());
    const drawsB = Array.from({ length: 8 }, () => b.nextUint32());
    expect(drawsA).toEqual(drawsB);
    a.reseed(1);
    expect(a.nextUint32()).toBe(drawsA[0]);
  });

  it('never gets stuck in the zero state', () => {
    const rng = new Rng(0);
    for (let i = 0; i < 4; i++) expect(rng.nextUint32()).not.toBe(0);
    expect(new Rng(0xffffffff).nextUint32()).not.toBe(0);
  });

  it('emits 32-bit unsigned values', () => {
    const rng = new Rng(77);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('returns nextInt values inside the bound and uses them all', () => {
    const rng = new Rng(31);
    const counts = new Map<number, number>();
    for (let i = 0; i < 7000; i++) {
      const value = rng.nextInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Rejection sampling should keep each bucket within ~20% of the mean (1000).
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('rejects invalid nextInt bounds', () => {
    const rng = new Rng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-3)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });

  it('shuffles in place without losing items', () => {
    const rng = new Rng(2024);
    const items = Array.from({ length: 52 }, (_, index) => index);
    const shuffled = rng.shuffle(items);
    expect(shuffled).toBe(items);
    expect([...items].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, index) => index));
    expect(items).not.toEqual(Array.from({ length: 52 }, (_, index) => index));
  });

  it('exposes its state for reproducible snapshots', () => {
    const rng = new Rng(8);
    const before = rng.getState();
    const next = rng.nextUint32();
    expect(before).not.toBe(rng.getState());
    rng.reseed(8);
    expect(rng.nextUint32()).toBe(next);
  });
});
