import { Rng } from './rng.ts';
import { PIECE_IDS } from './types.ts';
import type { PieceId } from './types.ts';

/**
 * Seven-bag randomiser.
 *
 * One of each tetromino is shuffled per bag and dealt in order. The queue is topped up in whole
 * bags, so the *sequence* depends only on the seed and never on how many previews the UI asks for.
 * It always holds at least `MIN_QUEUE` pieces, which covers the five visible previews, the hold
 * swap and the active piece.
 */
export const MIN_QUEUE = 8;

export class PieceQueue {
  private readonly rng: Rng;
  private queue: PieceId[] = [];
  private bagIndex = 0;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.refill();
  }

  reset(seed: number): void {
    this.rng.reseed(seed);
    this.queue = [];
    this.bagIndex = 0;
    this.refill();
  }

  private refill(): void {
    while (this.queue.length < MIN_QUEUE) {
      const bag: PieceId[] = [...PIECE_IDS];
      this.rng.shuffle(bag);
      for (const id of bag) {
        this.queue.push(id);
        this.bagIndex++;
      }
    }
  }

  /** Removes and returns the next piece. */
  next(): PieceId {
    const id = this.queue.shift();
    if (id === undefined) throw new Error('PieceQueue drained unexpectedly');
    this.refill();
    return id;
  }

  /** The next `count` pieces without consuming them. */
  peek(count: number): PieceId[] {
    this.refill();
    const out: PieceId[] = [];
    for (let i = 0; i < count; i++) {
      out.push(this.queue[i] ?? this.next());
    }
    return out;
  }

  /** Number of pieces dealt since the queue was created (used for "piece count" stats). */
  get dealt(): number {
    return this.bagIndex - this.queue.length;
  }

  /** The seed this queue was created from. */
  get initialSeed(): number {
    return this.seed;
  }
}
