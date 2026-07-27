import type { EvalCtx, Policy } from './ir.js';
import { SIZE_THROUGHPUT } from '../config.js';

/**
 * Mode 3 — Auction. Every brick continuously computes a bid; idle masons walk
 * toward the highest bid-per-distance. The player programs ONLY the weights.
 *
 * The intended discovery: with honest weights, mason traffic self-organizes and
 * the player wins by stepping back. Brick "water levels" equalize — the shadow
 * price ν made visible.
 */
export interface AuctionWeights {
  throughput: number;
  decay: number;
  damage: number;
  hub: number;
  rank: number;
}

export const DEFAULT_WEIGHTS: AuctionWeights = {
  throughput: 0.5,
  decay: 0.5,
  damage: 1.0,
  hub: 0.5,
  rank: 0.8,
};

const MAX_THROUGHPUT = SIZE_THROUGHPUT.L;

/** Raw bid, also used by the renderer's heat-map overlay. */
export function bidOf(w: AuctionWeights, c: EvalCtx): number {
  const b = c.brick;
  const decayNorm = Math.min(2, b.decayRate / c.cfg.decayNamed.fast);
  const hubBonus = b.wallIds.length > 1 ? b.wallIds.length - 1 : 0;
  return (
    w.throughput * (b.throughput / MAX_THROUGHPUT) +
    w.decay * decayNorm +
    w.damage * (1 - b.belief) +
    w.hub * hubBonus +
    w.rank * c.cfg.rankValue[c.band]
  );
}

export function compileAuction(weights: AuctionWeights, name = 'auction'): Policy {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  return {
    kind: 'auction',
    name,
    source: JSON.stringify(w),
    hasInterrupts: true,
    bid: (ctx) => bidOf(w, ctx),
    evaluate(ctx) {
      // A brick at full integrity has nothing to bid for.
      if (ctx.brick.belief >= 1) return null;
      const bid = bidOf(w, ctx);
      if (bid <= 0) return null;
      // Bid PER DISTANCE — travel time is priced in, which is why this mode
      // self-organizes instead of stampeding.
      return { tier: 0, score: bid / (1 + ctx.distance / ctx.cfg.auctionDistanceScale) };
    },
    interrupt(ctx) {
      // In auction mode the only interrupt is a brick about to become rubble nearby.
      return ctx.brick.belief < 0.12 && ctx.distance < 120;
    },
  };
}
