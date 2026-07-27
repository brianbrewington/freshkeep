import type { Brick, CourseBand, Mason } from '../types.js';
import type { Config } from '../config.js';

/**
 * The single internal representation every instruction mode compiles to:
 * a scoring function over (mason, brick) pairs, plus interrupt rules.
 * Rulebooks, zones and auction weights all become one of these.
 */

export interface EvalCtx {
  brick: Brick;
  mason: Mason;
  /** Straight-line distance, world units. Travel time is actionability, so it is always in scope. */
  distance: number;
  band: CourseBand;
  /** Sim time, so rules can reason about how long since a brick was seen. */
  now: number;
  cfg: Config;
}

export interface Candidate {
  /** Lower is better. Priority 1 beats priority 2 beats the default tier. */
  tier: number;
  /** Higher is better within a tier. */
  score: number;
}

export interface Policy {
  kind: 'rulebook' | 'auction';
  name: string;
  /** The exact text or JSON the player supplied — telemetry records this verbatim. */
  source: string;
  /** Null means "not a candidate for this mason". */
  evaluate(ctx: EvalCtx): Candidate | null;
  /** Should this brick pull a mason off its current task? */
  interrupt(ctx: EvalCtx): boolean;
  /** False lets the sim skip the whole interrupt scan — most rulebooks have none. */
  hasInterrupts: boolean;
  /** Auction mode only: the live bid, for the heat-map overlay. */
  bid?(ctx: EvalCtx): number;
}

export type Predicate = (ctx: EvalCtx) => boolean;
export type Ordering = (ctx: EvalCtx) => number;

export const ORDERINGS: Record<string, Ordering> = {
  nearest: (c) => -c.distance,
  farthest: (c) => c.distance,
  largest: (c) => c.brick.throughput,
  smallest: (c) => -c.brick.throughput,
  'most damaged': (c) => 1 - c.brick.belief,
  'least damaged': (c) => c.brick.belief,
  fastest: (c) => c.brick.decayRate,
  slowest: (c) => -c.brick.decayRate,
  'highest throughput': (c) => c.brick.throughput,
  'most valuable': (c) =>
    c.brick.throughput * (1 - c.brick.belief) * c.cfg.rankValue[c.band],
};

export const ORDERING_NAMES = Object.keys(ORDERINGS);

export interface Tier {
  index: number;
  label: string;
  match: Predicate;
  order: Ordering;
}

/** Build a Policy from compiled tiers. Shared by the rulebook compiler and any future mode. */
export function policyFromTiers(
  name: string,
  source: string,
  tiers: Tier[],
  ignore: Predicate | null,
  interrupts: Predicate[],
): Policy {
  return {
    kind: 'rulebook',
    name,
    source,
    hasInterrupts: interrupts.length > 0,
    evaluate(ctx) {
      if (ignore && ignore(ctx)) return null;
      for (const tier of tiers) {
        if (tier.match(ctx)) {
          // Distance is always the final tiebreak, scaled small so it never
          // outranks the tier's own ordering.
          return { tier: tier.index, score: tier.order(ctx) - ctx.distance * 1e-6 };
        }
      }
      return null;
    },
    interrupt(ctx) {
      if (ignore && ignore(ctx)) return false;
      for (const it of interrupts) if (it(ctx)) return true;
      return false;
    },
  };
}
