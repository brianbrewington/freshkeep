import type { Brick, BrickSize, DemandLobe, DemandState, Wall, World } from './types.js';
import { Config, DEFAULT_CONFIG, SIZE_THROUGHPUT } from './config.js';
import { Rng } from './rng.js';

/**
 * The board is POLAR. The king sits at the centre, courses are concentric rings,
 * and a wall is an angular sector of those rings. Raiders arrive on a bearing and
 * walk straight at the king, so a brick's angular width IS its share of traffic:
 * whatever spans an angle intercepts everything arriving on it.
 *
 * Walls partition the WHOLE circle. A sector that does not is a gap raiders walk
 * through untouched, so a one-wall level is one wall encircling the kingdom.
 */

/** Where a wall's sector is anchored on the circle. */
export type Side = 'N' | 'E' | 'S' | 'W';

/** Inward spacing between courses. Shared with the raider spawner and the renderer. */
export const COURSE_GAP = 26;

/** Angular resolution of the observed-arrivals histogram. */
export const ARRIVAL_BINS = 180;

const TAU = Math.PI * 2;

/** Anchor angles, screen coordinates (y grows downward), N = straight up. */
const SIDE_ANGLE: Record<Side, number> = {
  N: -Math.PI / 2,
  E: 0,
  S: Math.PI / 2,
  W: Math.PI,
};

/**
 * Normalize to [0, TAU), IDEMPOTENTLY.
 *
 * The obvious `((a % TAU) + TAU) % TAU` is not idempotent: for a value already in
 * range, adding TAU and taking the modulus again is a lossy round-trip that can
 * come back one ULP low. That is not academic — sector bounds are stored
 * normalized, so `norm(wall.angleStart)` could return a hair BELOW that start,
 * landing on the exclusive end of the previous sector and belonging to no wall at
 * all. Values already in range are now returned untouched.
 */
export function norm(a: number): number {
  if (a >= 0 && a < TAU) return a;
  let r = a % TAU;
  if (r < 0) r += TAU;
  // A tiny negative remainder can round up to exactly TAU when TAU is added.
  if (r >= TAU) r = 0;
  return r;
}

/** Is angle `a` inside the sector [start, end), walking anticlockwise? */
export function inSector(a: number, start: number, end: number): boolean {
  const width = norm(end - start);
  return norm(a - start) < (width === 0 ? TAU : width);
}

/**
 * A hand-built brick, for the teaching levels. Campaign levels draw from
 * `sizeMix` instead; anything omitted here falls back to the usual distribution.
 */
export interface BrickPlan {
  size: BrickSize;
  /** Share of the sector's arc. Defaults to proportional-to-throughput. */
  span?: number;
  /** Absolute decay rate, integrity per second. */
  decay?: number;
  /** Starting integrity. */
  integrity?: number;
  spare?: boolean;
}

export interface WallSpec {
  id: string;
  name: string;
  /** Anchor for this wall's sector; sectors are laid out in N, E, S, W order. */
  side: Side;
  columns: number;
  /** Spare bricks per course. A raider blocked by any intact brick in its target set is repelled. */
  spares: number;
  /** Relative share of total demand aimed at this wall. */
  demandShare: number;
  /** Hand-built layout, [course][index]. Overrides `columns` and `sizeMix`. */
  plan?: BrickPlan[][];
}

export interface LevelSpec {
  id: string;
  name: string;
  blurb: string;
  /** The lesson, shown on the report card. */
  teaches: string;
  durationSeconds: number;
  kingHp: number;
  /** Default mason count. The one dial that matters. */
  masons: number;
  courses: number;
  walls: WallSpec[];
  /** Total raider arrivals per second across all walls (before bursts). */
  demandRate: number;
  /** Hub bricks at wall junctions, per course. 0 = no hubs on this level. */
  hubsPerCorner: number;
  /** Bricks in the inner keep ring (last line before the king). */
  keepBricks: number;
  /** Relative frequency of S / M / L bricks. */
  sizeMix: { S: number; M: number; L: number };
  /**
   * Per-brick decay rate override; omit for the log-normal default. Receives the
   * resolved config so a level can scale off `decayMedian` rather than hardcoding
   * rates — otherwise tuning knobs silently do nothing on that level.
   */
  decayRateFor?: (b: Brick, rng: Rng, cfg: Config) => number;
  /**
   * Where the demand lobes sit when `demandPeakiness > 0`. Anchoring them on the
   * narrow bricks is what makes The Bubble Trap's lesson perceivable: you can
   * watch the traffic pour onto bricks that look unimportant.
   */
  lobeAnchor?: 'random' | 'small' | 'large';
  /** Policy modes this level allows. */
  modes: Array<'rulebook' | 'zones' | 'auction'>;
  /** Zone mode forced (The Seam). Zones are per-wall. */
  forceZones?: boolean;
  /** The Culling: lose `count` masons every `everySeconds`, down to `floor`. */
  culling?: { everySeconds: number; count: number; floor: number };
  /** A teaching level names the preset that plainly fails it. */
  wrongPreset?: string;
  config?: Partial<Config>;
}

export function resolveConfig(level: LevelSpec, overrides?: Partial<Config>): Config {
  const cfg = { ...DEFAULT_CONFIG, ...(level.config ?? {}), ...(overrides ?? {}) };
  // Named speeds track the kingdom's own decay unless someone pinned them.
  const pinned = level.config?.decayNamed ?? overrides?.decayNamed;
  if (!pinned) {
    cfg.decayNamed = {
      slow: cfg.decayMedian * 0.7,
      medium: cfg.decayMedian * 1.3,
      fast: cfg.decayMedian * 2.4,
    };
  }
  return cfg;
}

export interface BuildOptions {
  masonCount?: number;
  /** Force zone mode on or off, overriding the level default (used by The Seam's A/B). */
  zones?: boolean;
}

export function buildWorld(level: LevelSpec, seed: number, cfg: Config, opts: BuildOptions = {}): World {
  const rng = new Rng(seed).fork('world');
  const cx = cfg.width / 2;
  const cy = cfg.height / 2;
  const ringOuter = Math.min(cfg.width, cfg.height) * 0.36;
  const keepRadius = Math.min(cfg.width, cfg.height) * 0.1;

  const bricks: Brick[] = [];
  const walls: Wall[] = [];
  const wallsById: Record<string, Wall> = {};
  let nextId = 0;

  const sizes: BrickSize[] = ['S', 'M', 'L'];
  const courseRadius = (c: number) => ringOuter - c * COURSE_GAP;

  const makeBrick = (
    init: Pick<Brick, 'wallIds' | 'course' | 'angle' | 'angSpan' | 'radius'> & Partial<Brick>,
    plan?: BrickPlan,
  ): Brick => {
    const size =
      plan?.size ?? init.size ?? rng.pickWeighted(sizes, [level.sizeMix.S, level.sizeMix.M, level.sizeMix.L]);
    const b: Brick = {
      id: nextId++,
      wallIds: init.wallIds,
      course: init.course,
      column: init.column ?? -1,
      spare: init.spare ?? plan?.spare ?? false,
      hub: init.hub ?? false,
      keep: init.keep ?? false,
      angle: init.angle,
      angSpan: init.angSpan,
      radius: init.radius,
      x: cx + Math.cos(init.angle) * init.radius,
      y: cy + Math.sin(init.angle) * init.radius,
      size,
      throughput: SIZE_THROUGHPUT[size],
      // Traffic share is geometric now: the arc you cover is the traffic you take.
      demandWeight: init.angSpan,
      integrity: 1,
      decayRate: 0,
      claimedBy: null,
      zone: init.zone ?? null,
    };
    b.decayRate =
      plan?.decay ??
      (level.decayRateFor ? level.decayRateFor(b, rng, cfg) : rng.logNormal(cfg.decayMedian, cfg.decaySigma));
    // Bricks start partly worn, so the player is never handed a pristine board.
    b.integrity = plan?.integrity ?? Math.min(1, Math.max(0.5, 1 - rng.next() * 0.35));
    bricks.push(b);
    return b;
  };

  // --- Sectors ------------------------------------------------------------
  // Walls are laid out in compass order and divide the circle evenly between them.
  const ordered = [...level.walls].sort(
    (a, b) => norm(SIDE_ANGLE[a.side]) - norm(SIDE_ANGLE[b.side]),
  );
  const sectorWidth = TAU / ordered.length;
  const firstAngle = SIDE_ANGLE[ordered[0].side] - sectorWidth / 2;

  ordered.forEach((spec, wi) => {
    const angleStart = firstAngle + wi * sectorWidth;
    const wall: Wall = {
      id: spec.id,
      name: spec.name,
      courses: level.courses,
      columns: spec.plan ? spec.plan[0].length : spec.columns,
      grid: [],
      spares: [],
      hubs: [],
      angleStart: norm(angleStart),
      angleEnd: norm(angleStart + sectorWidth),
      lobes: [],
    };

    for (let c = 0; c < level.courses; c++) {
      const r = courseRadius(c);
      const plans = spec.plan?.[Math.min(c, spec.plan.length - 1)];
      const row: number[] = [];

      // Tile the sector: each brick's arc is proportional to its throughput, so a
      // big brick literally catches more of what arrives.
      const drawn: Array<{ size: BrickSize; plan?: BrickPlan }> = plans
        ? plans.map((p) => ({ size: p.size, plan: p }))
        : Array.from({ length: spec.columns }, () => ({
            size: rng.pickWeighted(sizes, [level.sizeMix.S, level.sizeMix.M, level.sizeMix.L]),
          }));
      const weights = drawn.map((d) => d.plan?.span ?? SIZE_THROUGHPUT[d.size]);
      const total = weights.reduce((a, b) => a + b, 0);

      let cursor = angleStart;
      drawn.forEach((d, k) => {
        const span = (sectorWidth * weights[k]) / total;
        const brick = makeBrick(
          {
            wallIds: [spec.id],
            course: c,
            column: k,
            angle: norm(cursor + span / 2),
            angSpan: span,
            radius: r,
            size: d.size,
            zone: spec.id,
          },
          d.plan,
        );
        cursor += span;
        row.push(brick.id);
      });
      wall.grid.push(row);

      // Spares sit just inside the course. They defend the whole course, so they
      // are given the sector's full arc as their notional traffic share.
      const spareIds: number[] = [];
      const spareCount = plans ? plans.filter((p) => p.spare).length || spec.spares : spec.spares;
      for (let s = 0; s < spareCount; s++) {
        const frac = (s + 1) / (spareCount + 1);
        spareIds.push(
          makeBrick({
            wallIds: [spec.id],
            course: c,
            column: -1,
            spare: true,
            angle: norm(angleStart + sectorWidth * frac),
            angSpan: sectorWidth,
            radius: r - COURSE_GAP * 0.42,
            zone: spec.id,
          }).id,
        );
      }
      wall.spares.push(spareIds);
      wall.hubs.push([]);
    }
    walls.push(wall);
    wallsById[wall.id] = wall;
  });

  // --- Hub bricks on the sector boundaries -------------------------------
  // A cornerstone straddles the seam between two sectors and defends both.
  if (level.hubsPerCorner > 0 && ordered.length > 1) {
    for (let wi = 0; wi < ordered.length; wi++) {
      const a = ordered[wi];
      const b = ordered[(wi + 1) % ordered.length];
      const seam = firstAngle + (wi + 1) * sectorWidth;
      for (let c = 0; c < level.courses && c < level.hubsPerCorner; c++) {
        const hub = makeBrick({
          wallIds: [a.id, b.id],
          course: c,
          column: -1,
          hub: true,
          angle: norm(seam),
          angSpan: sectorWidth * 0.16,
          radius: courseRadius(c),
          size: 'L',
          zone: a.id,
        });
        wallsById[a.id].hubs[c].push(hub.id);
        wallsById[b.id].hubs[c].push(hub.id);
      }
    }
  }

  // --- Inner keep ring ----------------------------------------------------
  const keepWall: Wall = {
    id: 'K',
    name: 'the keep',
    courses: 1,
    columns: level.keepBricks,
    grid: [[]],
    spares: [[]],
    hubs: [[]],
    angleStart: 0,
    angleEnd: TAU,
    lobes: [],
  };
  for (let k = 0; k < level.keepBricks; k++) {
    const span = TAU / level.keepBricks;
    keepWall.grid[0].push(
      makeBrick({
        wallIds: ['K'],
        course: 0,
        column: k,
        keep: true,
        angle: norm(-Math.PI / 2 + span * (k + 0.5)),
        angSpan: span,
        radius: keepRadius,
        size: 'M',
        zone: 'K',
      }).id,
    );
  }
  walls.push(keepWall);
  wallsById['K'] = keepWall;

  // --- Demand lobes -------------------------------------------------------
  // Flat demand spreads arrivals evenly around the sector. Peaky demand piles
  // them onto a few bearings, the way real request traffic piles onto a few
  // pages. The centres are hidden but stable per seed: you find them by watching.
  if (cfg.demandPeakiness > 0 && cfg.demandLobes > 0) {
    for (const wall of walls) {
      if (wall.id === 'K') continue;
      const row = wall.grid[0].map((id) => bricks[id]);
      const anchor = level.lobeAnchor ?? 'random';
      let candidates = row;
      if (anchor === 'small') {
        candidates = [...row].sort((a, b) => a.angSpan - b.angSpan);
      } else if (anchor === 'large') {
        candidates = [...row].sort((a, b) => b.angSpan - a.angSpan);
      }
      const n = Math.min(cfg.demandLobes, candidates.length);
      const lobes: DemandLobe[] = [];
      for (let i = 0; i < n; i++) {
        // Zipf: the first lobe takes far more than the last.
        const weight = 1 / Math.pow(i + 1, cfg.demandPeakiness);
        const target = anchor === 'random' ? candidates[rng.int(0, candidates.length)] : candidates[i];
        lobes.push({
          angle: target.angle,
          weight,
          // Narrow enough to sit inside its brick, so a lobe means something.
          width: Math.max(target.angSpan * 0.35, sectorWidth * 0.015),
        });
      }
      wall.lobes = lobes;
    }
  }

  // --- Masons -------------------------------------------------------------
  const useZones = opts.zones ?? !!level.forceZones;
  const masonCount = opts.masonCount ?? level.masons;
  const masons = [];
  const perWall = Math.ceil(masonCount / ordered.length);
  const stageRadius = courseRadius(level.courses - 1) - 34;
  for (let i = 0; i < masonCount; i++) {
    const wi = i % ordered.length;
    const spec = ordered[wi];
    const slot = Math.floor(i / ordered.length);
    const a = firstAngle + wi * sectorWidth + (sectorWidth * (slot + 0.5)) / perWall;
    masons.push({
      id: i,
      x: cx + Math.cos(a) * stageRadius,
      y: cy + Math.sin(a) * stageRadius,
      speed: cfg.masonSpeed,
      state: 'idle' as const,
      taskBrickId: null,
      zone: useZones ? spec.id : null,
      interrupted: false,
      taskWasCosmetic: false,
      repairFrom: 0,
      repairElapsed: 0,
      timeIdle: 0,
      timeTraveling: 0,
      timeRepairing: 0,
      timeRepairingCosmetic: 0,
      alive: true,
    });
  }

  // --- Demand -------------------------------------------------------------
  const totalShare = level.walls.reduce((s, w) => s + w.demandShare, 0);
  const demand: DemandState[] = level.walls.map((w) => ({
    wallId: w.id,
    baseRate: (level.demandRate * w.demandShare) / totalShare,
    bursting: false,
    nextArrival: 0,
    nextFlip: 0,
  }));

  return {
    t: 0,
    tick: 0,
    bricks,
    walls,
    wallsById,
    raiders: [],
    masons,
    king: { x: cx, y: cy, hp: level.kingHp, maxHp: level.kingHp },
    demand,
    width: cfg.width,
    height: cfg.height,
    ringOuter,
    keepRadius,
    arrivalBins: new Array(ARRIVAL_BINS).fill(0),
    nextRaiderId: 0,
    nextCull: level.culling ? level.culling.everySeconds : Infinity,
  };
}
