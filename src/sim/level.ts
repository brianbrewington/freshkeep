import type { Brick, BrickSize, DemandState, Wall, World } from './types.js';
import { Config, DEFAULT_CONFIG, SIZE_THROUGHPUT } from './config.js';
import { Rng } from './rng.js';

export type Side = 'N' | 'E' | 'S' | 'W';

/** Inward spacing between courses. Shared with the raider spawner and the renderer. */
export const COURSE_GAP = 26;

export interface WallSpec {
  id: string;
  name: string;
  side: Side;
  columns: number;
  /** Spare bricks per course. A raider blocked by any intact brick in its target set is repelled. */
  spares: number;
  /** Relative share of total demand aimed at this wall. */
  demandShare: number;
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
   * Hidden mapping from a brick to its share of real query traffic.
   * Omit for the honest default (traffic ∝ size).
   */
  demandWeightFor?: (b: Brick, rng: Rng) => number;
  /** Per-brick decay rate override; omit for the log-normal default. */
  decayRateFor?: (b: Brick, rng: Rng) => number;
  /** Policy modes this level allows. */
  modes: Array<'rulebook' | 'zones' | 'auction'>;
  /** Zone mode forced (The Seam). Zones are per-wall. */
  forceZones?: boolean;
  /** The Culling: lose `count` masons every `everySeconds`, down to `floor`. */
  culling?: { everySeconds: number; count: number; floor: number };
  config?: Partial<Config>;
}

const SIDES: Record<Side, { nx: number; ny: number }> = {
  N: { nx: 0, ny: -1 },
  E: { nx: 1, ny: 0 },
  S: { nx: 0, ny: 1 },
  W: { nx: -1, ny: 0 },
};

/** Where a wall's brick sits, given the ring half-extent for its course. */
function wallBrickPos(side: Side, cx: number, cy: number, r: number, tAlong: number) {
  // tAlong in [-1, 1] runs along the wall.
  switch (side) {
    case 'N': return { x: cx + tAlong * r, y: cy - r };
    case 'S': return { x: cx + tAlong * r, y: cy + r };
    case 'E': return { x: cx + r, y: cy + tAlong * r };
    case 'W': return { x: cx - r, y: cy + tAlong * r };
  }
}

/** The two walls meeting at each corner, in ring order. */
function cornerPairs(specs: WallSpec[]): Array<{ a: WallSpec; b: WallSpec; sx: number; sy: number }> {
  const bySide = new Map<Side, WallSpec>();
  for (const s of specs) bySide.set(s.side, s);
  const corners: Array<[Side, Side, number, number]> = [
    ['N', 'E', 1, -1],
    ['E', 'S', 1, 1],
    ['S', 'W', -1, 1],
    ['W', 'N', -1, -1],
  ];
  const out = [];
  for (const [sa, sb, sx, sy] of corners) {
    const a = bySide.get(sa);
    const b = bySide.get(sb);
    if (a && b) out.push({ a, b, sx, sy });
  }
  return out;
}

export function resolveConfig(level: LevelSpec, overrides?: Partial<Config>): Config {
  return { ...DEFAULT_CONFIG, ...(level.config ?? {}), ...(overrides ?? {}) };
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
  const courseGap = COURSE_GAP;
  const keepRadius = Math.min(cfg.width, cfg.height) * 0.1;

  const bricks: Brick[] = [];
  const walls: Wall[] = [];
  const wallsById: Record<string, Wall> = {};
  let nextId = 0;

  const sizes: BrickSize[] = ['S', 'M', 'L'];

  const makeBrick = (init: Partial<Brick> & Pick<Brick, 'wallIds' | 'course' | 'x' | 'y'>): Brick => {
    const size = init.size ?? rng.pickWeighted(sizes, [level.sizeMix.S, level.sizeMix.M, level.sizeMix.L]);
    const b: Brick = {
      id: nextId++,
      wallIds: init.wallIds,
      course: init.course,
      column: init.column ?? -1,
      spare: init.spare ?? false,
      hub: init.hub ?? false,
      keep: init.keep ?? false,
      x: init.x,
      y: init.y,
      size,
      throughput: SIZE_THROUGHPUT[size],
      demandWeight: 0,
      integrity: 1,
      decayRate: 0,
      claimedBy: null,
      zone: init.zone ?? null,
    };
    b.decayRate = level.decayRateFor
      ? level.decayRateFor(b, rng)
      : rng.logNormal(cfg.decayMedian, cfg.decaySigma);
    b.demandWeight = level.demandWeightFor
      ? level.demandWeightFor(b, rng)
      : Math.pow(b.throughput, cfg.demandExponent);
    // Bricks start partly worn, so the player is never handed a pristine board.
    b.integrity = Math.min(1, Math.max(0.5, 1 - rng.next() * 0.35));
    bricks.push(b);
    return b;
  };

  // --- Wall grids ---------------------------------------------------------
  for (const spec of level.walls) {
    const wall: Wall = {
      id: spec.id,
      name: spec.name,
      courses: level.courses,
      columns: spec.columns,
      grid: [],
      spares: [],
      hubs: [],
      nx: SIDES[spec.side].nx,
      ny: SIDES[spec.side].ny,
    };
    for (let c = 0; c < level.courses; c++) {
      const r = ringOuter - c * courseGap;
      const row: number[] = [];
      for (let k = 0; k < spec.columns; k++) {
        // Leave the corner slots for hub bricks.
        const tAlong = -0.88 + (1.76 * (k + 0.5)) / spec.columns;
        const p = wallBrickPos(spec.side, cx, cy, r, tAlong);
        row.push(makeBrick({ wallIds: [spec.id], course: c, column: k, x: p.x, y: p.y, zone: spec.id }).id);
      }
      wall.grid.push(row);

      const spareIds: number[] = [];
      for (let s = 0; s < spec.spares; s++) {
        const tAlong = -0.4 + (0.8 * (s + 0.5)) / Math.max(1, spec.spares);
        const p = wallBrickPos(spec.side, cx, cy, r - courseGap * 0.45, tAlong);
        spareIds.push(
          makeBrick({ wallIds: [spec.id], course: c, column: -1, spare: true, x: p.x, y: p.y, zone: spec.id }).id,
        );
      }
      wall.spares.push(spareIds);
      wall.hubs.push([]);
    }
    walls.push(wall);
    wallsById[wall.id] = wall;
  }

  // --- Hub bricks at wall junctions --------------------------------------
  // A hub belongs to both walls meeting at its corner: repairing one defends both.
  if (level.hubsPerCorner > 0) {
    for (const { a, b, sx, sy } of cornerPairs(level.walls)) {
      for (let c = 0; c < level.courses && c < level.hubsPerCorner; c++) {
        const r = ringOuter - c * courseGap;
        const hub = makeBrick({
          wallIds: [a.id, b.id],
          course: c,
          column: -1,
          hub: true,
          x: cx + sx * r,
          y: cy + sy * r,
          // Hubs are cornerstones: bigger, and they carry real traffic for both walls.
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
    nx: 0,
    ny: 0,
  };
  for (let k = 0; k < level.keepBricks; k++) {
    const ang = (2 * Math.PI * k) / level.keepBricks - Math.PI / 2;
    const x = cx + Math.cos(ang) * keepRadius;
    const y = cy + Math.sin(ang) * keepRadius;
    keepWall.grid[0].push(
      makeBrick({ wallIds: ['K'], course: 0, column: k, keep: true, x, y, size: 'M', zone: 'K' }).id,
    );
  }
  walls.push(keepWall);
  wallsById['K'] = keepWall;

  // --- Masons -------------------------------------------------------------
  const useZones = opts.zones ?? !!level.forceZones;
  const masonCount = opts.masonCount ?? level.masons;
  const masons = [];
  // Deal masons round-robin around the ring, spread evenly along each wall, so the
  // start state is symmetric, seed-independent, and nobody starts stacked on a peer.
  const perWall = Math.ceil(masonCount / level.walls.length);
  for (let i = 0; i < masonCount; i++) {
    const spec = level.walls[i % level.walls.length];
    const r = ringOuter - courseGap * (level.courses - 1) - 30;
    const slot = Math.floor(i / level.walls.length);
    const tAlong = -0.7 + (1.4 * (slot + 0.5)) / perWall;
    const p = wallBrickPos(spec.side, cx, cy, r, tAlong);
    masons.push({
      id: i,
      x: p.x,
      y: p.y,
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
    nextRaiderId: 0,
    nextCull: level.culling ? level.culling.everySeconds : Infinity,
  };
}
