/**
 * Seeded PRNG. Load-bearing: the whole game doubles as an experiment platform,
 * so (seed, policy, masonCount) must reproduce an identical event log forever.
 *
 * mulberry32 — 32-bit state, no floating-point accumulation in the state itself,
 * so it is bit-identical across JS engines.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Mix the seed so that nearby seeds (1, 2, 3...) don't produce correlated streams.
    let s = seed >>> 0;
    s = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    s = (s ^ (s >>> 13)) >>> 0;
    this.state = s === 0 ? 0x6d2b79f5 : s;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Integer in [lo, hi). */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller (two draws, no caching — caching breaks determinism under branching). */
  normal(): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Log-normal: most values small, a few large. The decay-rate distribution. */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  /** Time until the next event of a Poisson process with the given rate (events/sec). */
  exponential(rate: number): number {
    if (rate <= 0) return Infinity;
    return -Math.log(Math.max(this.next(), 1e-12)) / rate;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** Weighted pick. Weights need not be normalized. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Fork a labelled sub-stream. Lets subsystems draw independently without coupling. */
  fork(label: string): Rng {
    let h = this.state >>> 0;
    for (let i = 0; i < label.length; i++) {
      h = (Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0);
    }
    return new Rng(h);
  }
}

/** Order-independent 32-bit hash of a string. Used to fingerprint event logs in tests. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (((h2 >>> 0) * 4294967296 + (h1 >>> 0)) >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0');
}
