import { mulberry32 } from "@/core/math";

/**
 * Small seeded PRNG (mulberry32). FX use it instead of Math.random so dev
 * snapshots (`?t=`) are reproducible.
 */
export class Rng {
  /** Uniform in [0, 1). */
  readonly next: () => number;

  constructor(seed = 0x9e3779b9) {
    this.next = mulberry32(seed);
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
