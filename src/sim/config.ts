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
  /**
   * Scales every wall's arrival rate. Mason count is the supply side of the
   * game's central ratio; this is the demand side, and it was previously
   * unreachable — `demandRate` lives on the level, so no config override could
   * touch it. 1 = as the level intended.
   */
  demandRateScale: number;
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

  demandRateScale: 1,
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

/**
 * Which ring a query of a given rank lands on. Shared by the spawner and by the
 * per-brick importance calculation — if these two ever disagreed, the game would
 * be scoring players against a demand model it does not actually run.
 */
/**
 * P(Gamma(n,1) > x) — the upper tail used by holdProbability.
 */
function gammaUpper(n: number, x: number): number {
  let term = Math.exp(-x);
  let sum = term;
  for (let j = 1; j < n; j++) {
    term *= x / j;
    sum += term;
  }
  return sum;
}

const HOLD_TABLE_MAX = 14;
const HOLD_TABLE_N = 700;
const HOLD_TABLE: number[] = [];

/**
 * Probability a brick still turns a raider away, given `mu = λ · age` expected
 * change events since it was last seen.
 *
 * Under the uncertain model a brick's true adequacy is a compound Poisson
 * product — it sits unchanged and then jumps down by a Uniform[0,1) factor. This
 * returns 1 − E[passProbability(adequacy)], i.e. the chance it holds.
 *
 * It is deliberately NOT the mean adequacy. passProbability is convex, so a
 * mean-adequacy bar would read "no risk at all" across its entire green range
 * while real risk climbed past a third — a lie that never resolves. Displaying
 * the hold probability keeps `1 − bar` as accumulated uncertainty AND states it
 * in the game's own units. It also composes: the sim multiplies pass
 * probabilities across a target set, and E[∏p] = ∏E[p] under independence.
 */
export function holdProbability(mu: number): number {
  if (!(mu > 0)) return 1;
  if (mu >= HOLD_TABLE_MAX) return holdExact(mu);
  if (HOLD_TABLE.length === 0) {
    for (let i = 0; i <= HOLD_TABLE_N; i++) {
      HOLD_TABLE.push(holdExact((i * HOLD_TABLE_MAX) / HOLD_TABLE_N));
    }
  }
  const pos = (mu / HOLD_TABLE_MAX) * HOLD_TABLE_N;
  const i = Math.floor(pos);
  const f = pos - i;
  return HOLD_TABLE[i] * (1 - f) + HOLD_TABLE[Math.min(i + 1, HOLD_TABLE_N)] * f;
}

function holdExact(mu: number): number {
  // The series truncates at 200 terms, so beyond that the dropped Poisson mass
  // makes the result collapse toward 1 — i.e. a brick nobody has visited in ages
  // would read as certain to hold. Hold is already 1.4e-4 by mu = 20.
  if (mu > 40) return 0;
  const c = DAMAGE_THRESHOLDS.weathered;
  const y = -Math.log(c);
  let pois = Math.exp(-mu);
  let pass = 0;
  for (let n = 1; n <= 200; n++) {
    pois *= mu / n;
    pass += pois * (gammaUpper(n, y) - (1 / c) * Math.pow(2, -n) * gammaUpper(n, 2 * y));
    if (n > mu && pois < 1e-14) break;
  }
  return Math.min(1, Math.max(0, 1 - pass));
}

export function courseIndexForBand(band: 'top' | 'mid' | 'deep', courses: number): number {
  if (courses <= 1) return 0;
  if (band === 'top') return 0;
  if (band === 'deep') return courses - 1;
  return Math.min(courses - 1, Math.max(1, Math.floor((courses - 1) / 2)));
}

export function courseBand(course: number, courses: number): 'top' | 'mid' | 'deep' {
  if (course === 0) return 'top';
  if (course >= courses - 1 && courses > 2) return 'deep';
  return courses <= 2 ? 'deep' : 'mid';
}
