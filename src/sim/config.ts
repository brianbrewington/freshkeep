/**
 * Every game constant lives here. Each one is a DEFAULT, NOT A LAW.
 * Levels override any of these; sandbox mode exposes them as knobs.
 */

export const DAMAGE_THRESHOLDS = {
  /** >= this is `intact`. */
  intact: 0.66,
  /** >= this (and below `intact`) is `weathered` — COSMETIC. Raiders do not pass. */
  weathered: 0.33,
  /** Below `weathered` is `cracked` — structural. At exactly 0 it is `rubble`. */
} as const;

export const SIZE_THROUGHPUT: Record<'S' | 'M' | 'L', number> = { S: 1, M: 3, L: 9 };

/**
 * Repair time does NOT vary by brick size. A mason's time is a fixed slot: the
 * same seconds whether the brick is huge or tiny, twitchy or stable, barely
 * weathered or flat rubble.
 *
 * This deliberately reverses the spec's "big bricks take longer". Making every
 * repair cost the same turns the mason's decision into a pure question of value —
 * which brick is worth a slot — instead of a cost/benefit sum where cheap little
 * repairs are always defensible. It is also what makes cosmetic repair genuinely
 * expensive: topping up a brick that was never in danger burns exactly as much of
 * your crew as saving one that was.
 */

/** Visual footprint (renderer), kept here so the sim and renderer agree on geometry. */
export const SIZE_FOOTPRINT: Record<'S' | 'M' | 'L', number> = { S: 0.7, M: 1.0, L: 1.35 };

export interface Config {
  /** Fixed simulation timestep, seconds. Determinism depends on this being fixed. */
  dt: number;

  /** Map dimensions in world units. */
  width: number;
  height: number;

  // --- Masons -------------------------------------------------------------
  /** World units per second. Travel time IS actionability — never teleport a mason. */
  masonSpeed: number;
  /** Seconds for ONE repair, start to full, whatever the brick. Fix-time is constant. */
  masonSecondsPerRepair: number;
  /** A mason releases a task at this integrity. */
  repairTarget: number;
  /**
   * A brick is only worth walking to if there is at least this much integrity to
   * put back. Without it masons park on one brick and "complete" a repair every
   * tick as it decays 0.999 → 1.0: tens of thousands of repairs, no movement, and
   * a hub-repair ratio computed against a meaningless denominator.
   */
  minRepairBenefit: number;
  /**
   * Hysteresis: once committed, a mason finishes the task unless an interrupt rule fires.
   * If true, it may also re-evaluate when the task becomes pointless (someone else fixed it).
   */
  abandonIfTaskFullyRepaired: boolean;
  /** Two masons on one brick is almost never what the player meant. */
  oneMasonPerBrick: boolean;
  /** Distance at which a mason is considered "at" its brick. */
  arriveEpsilon: number;

  // --- Raiders ------------------------------------------------------------
  raiderSpeed: number;
  /** Rank weighting of course choice: most queries hit the head. */
  courseWeights: { top: number; mid: number; deep: number };
  /** Distance outside the wall that raiders spawn. */
  raiderSpawnMargin: number;
  /** Seconds a repelled raider lingers (puff + retreat) before despawn. */
  repelledTtl: number;
  /** King damage per breaching raider that reaches the keep. */
  breachDamage: number;
  /**
   * The inner keep ring MITIGATES, it does not wall. A healthy keep brick turns
   * back this fraction of the raiders that reach it; the rest get through anyway.
   *
   * This is deliberate. A keep that certainly repels is a dominant strategy —
   * sixteen bricks are trivially holdable, and the whole perimeter becomes
   * optional. As a mitigation it is worthless to a player who abandoned the
   * walls all game, and decisive to one who has genuinely run out of masons.
   */
  keepRepelChance: number;

  // --- Demand (hidden from the player) ------------------------------------
  /** Multiplier on arrival rate while a wall is in a burst ("raid party"). */
  burstMultiplier: number;
  /** Mean seconds a wall spends calm / bursting. */
  calmMeanSeconds: number;
  burstMeanSeconds: number;

  // --- Decay --------------------------------------------------------------
  /** Median integrity lost per second. Log-normal: most slow, some fast. */
  decayMedian: number;
  /** Log-normal sigma. Bigger = wilder spread of decay rates. */
  decaySigma: number;
  /**
   * Thresholds the DSL's named speeds (`slow`/`medium`/`fast`) resolve to, and
   * the buckets the drain pips are drawn from. Derived from `decayMedian` unless
   * a level sets them explicitly — otherwise a level that raises decay makes
   * every brick "fast", every pip red, and `decayRate > fast` match everything.
   * The names have to mean fast RELATIVE TO THIS KINGDOM.
   */
  decayNamed: { slow: number; medium: number; fast: number };

  // --- Scoring ------------------------------------------------------------
  /** Weight applied to staleness by course band when integrating freshness-age. */
  rankValue: { top: number; mid: number; deep: number };

  /** Auction mode: how sharply bid-per-distance discounts distant bricks. */
  auctionDistanceScale: number;

  /**
   * How peaked real demand is over BEARING. 0 = flat: arrivals spread evenly
   * around each sector, so a brick's traffic is exactly its arc. Above 0,
   * arrivals concentrate into `demandLobes` lobes with Zipf weights
   * `1/(i+1)^demandPeakiness` — a few bearings carry most of the queries, which
   * is what request traffic actually looks like.
   *
   * This replaced the old `demandExponent` (traffic ∝ throughput^k). That knob
   * was rejected because a heavier tail on SIZE makes size-greed correct, and
   * BIGGEST FIRST — the bubble-game fallacy — became the strongest policy in the
   * game. Peaking demand over angle instead leaves size honest while still giving
   * a value-aware policy something to find, and unlike a hidden per-brick weight
   * the player can actually SEE where the raiders come from.
   */
  demandPeakiness: number;
  /** How many bearings carry the bulk of the traffic. */
  demandLobes: number;
}

export const DEFAULT_CONFIG: Config = {
  dt: 1 / 30,

  width: 1000,
  height: 1000,

  // Capacity budget, the number that decides whether a level is playable at all:
  // a mason performs at most 1/masonSecondsPerRepair repairs per second before
  // travel, against ~170 bricks each shedding integrity continuously — so no mason
  // count holds everything, and choosing what to abandon is the game.
  masonSpeed: 60,
  masonSecondsPerRepair: 3.0,
  repairTarget: 1.0,
  minRepairBenefit: 0.08,
  abandonIfTaskFullyRepaired: true,
  oneMasonPerBrick: true,
  arriveEpsilon: 3,

  raiderSpeed: 42,
  courseWeights: { top: 0.7, mid: 0.25, deep: 0.05 },
  raiderSpawnMargin: 120,
  repelledTtl: 0.8,
  breachDamage: 6,
  keepRepelChance: 0.6,

  burstMultiplier: 4,
  calmMeanSeconds: 22,
  burstMeanSeconds: 7,

  decayMedian: 0.012,
  decaySigma: 0.85,
  decayNamed: { slow: 0.008, medium: 0.015, fast: 0.03 },

  rankValue: { top: 1.0, mid: 0.5, deep: 0.2 },

  auctionDistanceScale: 200,
  demandPeakiness: 0,
  demandLobes: 3,
};

export function damageState(integrity: number): 'intact' | 'weathered' | 'cracked' | 'rubble' {
  if (integrity <= 0) return 'rubble';
  if (integrity >= DAMAGE_THRESHOLDS.intact) return 'intact';
  if (integrity >= DAMAGE_THRESHOLDS.weathered) return 'weathered';
  return 'cracked';
}

/**
 * Probability a raider walks through this brick.
 * Intact and weathered bricks are impassable — weathered damage is cosmetic, on purpose.
 * Below the cracked threshold the pass probability rises linearly to 1 at rubble.
 */
export function passProbability(integrity: number): number {
  if (integrity >= DAMAGE_THRESHOLDS.weathered) return 0;
  if (integrity <= 0) return 1;
  return 1 - integrity / DAMAGE_THRESHOLDS.weathered;
}

export function courseBand(course: number, courses: number): 'top' | 'mid' | 'deep' {
  if (course === 0) return 'top';
  if (course >= courses - 1 && courses > 2) return 'deep';
  return courses <= 2 ? 'deep' : 'mid';
}
