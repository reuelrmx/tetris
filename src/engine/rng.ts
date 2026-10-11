/**
 * Deterministic pseudo random number generator.
 *
 * The engine must be reproducible from a seed (tests depend on it, and versus matches
 * hand both players the same seed), so we use an explicitly specified 32-bit generator
 * rather than `Math.random`.
 *
 * Algorithm: 32-bit xorshift (Marsaglia 13/17/5) with a splitmix-style seed mixer.
 * All arithmetic is unsigned 32-bit; results are identical on every platform.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = mixSeed(seed);
  }

  /** Restores the generator to a previous seed. */
  reseed(seed: number): void {
    this.state = mixSeed(seed);
  }

  /** Returns a raw 32-bit unsigned integer and advances the state. */
  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x;
  }

  /** Uniform integer in [0, bound). `bound` must be a positive integer. */
  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError(`Rng.nextInt bound must be a positive integer, received ${bound}`);
    }
    // Rejection sampling keeps the distribution exactly uniform instead of modulo-biased.
    const limit = Math.floor(0x100000000 / bound) * bound;
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return value % bound;
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const a = items[i] as T;
      const b = items[j] as T;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  /** Debug/testing helper: current internal state. */
  getState(): number {
    return this.state;
  }
}

/** Seeds a xorshift state from an arbitrary 32-bit integer, avoiding the zero state. */
function mixSeed(seed: number): number {
  let x = seed >>> 0;
  x = (x ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x === 0 ? 0x1a2b3c4d : x;
}
