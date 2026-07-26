/** Core entity types for the FRESHKEEP simulation. */

export type BrickSize = 'S' | 'M' | 'L';

/** Damage bands. `weathered` is COSMETIC — raiders do not pass. That is the whole teaching mechanic. */
export type DamageState = 'intact' | 'weathered' | 'cracked' | 'rubble';

/** Which ring of the wall a brick sits in. Course 0 = top course = rank-1 results. */
export type CourseBand = 'top' | 'mid' | 'deep';

export interface Brick {
  id: number;
  /** Usually one wall; hub bricks belong to 2-3 (repairing one defends all of them). */
  wallIds: string[];
  course: number;
  /** Column slot along the wall. -1 for spares and hubs, which defend a whole course. */
  column: number;
  /** A spare defends any column in its course — the wall's redundancy. */
  spare: boolean;
  hub: boolean;
  /** Part of the inner keep ring (last line before the king). */
  keep: boolean;
  x: number;
  y: number;
  /** Centre angle, radians. The board is polar: everything is an arc. */
  angle: number;
  /**
   * Angular width, radians. THIS IS THE BRICK'S SHARE OF TRAFFIC. Raiders come
   * from random directions aimed at the king, so whatever brick spans an angle
   * intercepts the raiders arriving on it. Size, throughput and demand are the
   * same fact seen three ways.
   */
  angSpan: number;
  /** Distance from the king. */
  radius: number;
  size: BrickSize;
  /** Query throughput weight: S=1, M=3, L=9. This is the NOMINAL, visible signal. */
  throughput: number;
  /**
   * Hidden relative share of real query traffic aimed at this brick.
   * Defaults to `throughput` — but levels may decouple them, which is the whole
   * point of The Bubble Trap: currency (size) is not value (traffic).
   * The player never sees this, only the arrivals it produces.
   */
  demandWeight: number;
  /**
   * Expected raider arrivals per second at THIS brick — its importance, the
   * second axis of the (change rate, importance) plane. Computed at world build
   * from the wall's share, the rank weights, the stationary burst factor and the
   * bearing density over this brick's arc — so it accounts for peaked demand
   * rather than assuming traffic follows arc width. The player never sees it; it
   * is for scoring and analysis.
   */
  arrivalRate: number;
  /** Zone label in zone mode. Masons never cross zone boundaries. */
  zone: string | null;
  /** [0, 1]. */
  integrity: number;
  /** Integrity lost per second. Drawn per-brick from a log-normal-ish distribution. */
  decayRate: number;
  /** Mason id currently committed to this brick, or null. */
  claimedBy: number | null;
}

/**
 * A lobe of concentrated demand: real request traffic is not spread evenly, it
 * piles onto a few things. Centres are drawn once from the seeded world RNG, so
 * they are hidden from the player but stable for a seed — you learn where they
 * are by watching raiders arrive, which is the only honest way to learn it.
 */
export interface DemandLobe {
  angle: number;
  /** Relative share of this wall's arrivals. */
  weight: number;
  /** Angular standard deviation. */
  width: number;
}

export interface Wall {
  id: string;
  /** Human name for the report card ("east gate"). */
  name: string;
  courses: number;
  columns: number;
  /** Grid bricks indexed [course][column]. */
  grid: number[][];
  /** Spare brick ids per course. */
  spares: number[][];
  /** Hub brick ids per course (shared with a neighbouring wall). */
  hubs: number[][];
  /** Sector owned by this wall, radians. Walls partition the whole circle. */
  angleStart: number;
  angleEnd: number;
  /** Empty when demand is flat: arrivals are then uniform across the sector. */
  lobes: DemandLobe[];
}

export type RaiderState = 'approaching' | 'repelled' | 'breached';

/** How far in a raider has got: the outer wall, then the keep ring, then the king. */
export type RaiderPhase = 'wall' | 'keep' | 'king';

export interface Raider {
  id: number;
  wallId: string;
  /** The bearing it arrived on. A raider holds this heading all the way in. */
  angle: number;
  /** Targeted column and course. Course choice is rank-weighted (most queries hit the head). */
  column: number;
  course: number;
  x: number;
  y: number;
  /** Where it is walking to. */
  tx: number;
  ty: number;
  speed: number;
  state: RaiderState;
  phase: RaiderPhase;
  /** Seconds remaining of the little "thwarted" puff / retreat before despawn. */
  ttl: number;
  spawnedAt: number;
}

export type MasonState = 'idle' | 'traveling' | 'repairing';

export interface Mason {
  id: number;
  x: number;
  y: number;
  speed: number;
  state: MasonState;
  taskBrickId: number | null;
  /** Zone label in zone mode; masons never cross zone boundaries. */
  zone: string | null;
  /** Set when the current task was picked up by an interrupt rule (for the "!" bubble). */
  interrupted: boolean;
  /** True if the brick was merely weathered when this task was committed — i.e. cosmetic work. */
  taskWasCosmetic: boolean;
  /** Integrity the current brick had when work started, and seconds worked so far. */
  repairFrom: number;
  repairElapsed: number;
  /** Accumulated seconds, for the utilization breakdown. */
  timeIdle: number;
  timeTraveling: number;
  timeRepairing: number;
  timeRepairingCosmetic: number;
  /** Alive masons only — The Culling removes them over time. */
  alive: boolean;
}

export interface King {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

/** Hidden per-wall demand state (bursty: correlated arrivals). Never shown to the player. */
export interface DemandState {
  wallId: string;
  baseRate: number;
  bursting: boolean;
  /** Seconds until the next arrival / next burst-state flip. */
  nextArrival: number;
  nextFlip: number;
}

export interface World {
  t: number;
  tick: number;
  bricks: Brick[];
  walls: Wall[];
  wallsById: Record<string, Wall>;
  raiders: Raider[];
  masons: Mason[];
  king: King;
  demand: DemandState[];
  width: number;
  height: number;
  /** Radius of the outermost course, and of the inner keep ring. */
  ringOuter: number;
  keepRadius: number;
  /**
   * Where raiders have actually arrived from, binned by bearing. This is the
   * OBSERVED record, not the generating distribution — the player is meant to
   * infer where the traffic is, not be told.
   */
  arrivalBins: number[];
  nextRaiderId: number;
  /** Seconds until the next scheduled culling, if the level culls. */
  nextCull: number;
}
