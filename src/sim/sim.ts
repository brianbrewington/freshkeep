import type { Brick, CourseBand, Mason, Raider, Wall, World } from './types.js';
import { Config, courseBand, damageState, passProbability, DAMAGE_THRESHOLDS } from './config.js';
import { BuildOptions, LevelSpec, buildWorld, inSector, norm, resolveConfig } from './level.js';
import { Rng } from './rng.js';
import type { EvalCtx, Policy } from './policy/ir.js';
import type { SimEvent } from './events.js';

export interface SimOptions extends BuildOptions {
  level: LevelSpec;
  seed: number;
  policy: Policy;
  configOverrides?: Partial<Config>;
  /** Stop early once the king falls (default true). */
  stopOnDefeat?: boolean;
  /** Called after each tick — the renderer's hook. Headless runs omit it. */
  onTick?: (sim: Sim) => void;
}

export interface RunningTotals {
  freshnessAgeIntegral: number;
  freshnessAgeDenominator: number;
  breaches: number;
  breachesByWall: Record<string, number>;
  breachesByCourse: Record<string, number>;
  arrivals: number;
  repelled: number;
  /** Breaches the inner keep ring turned back before they reached the king. */
  stoppedAtKeep: number;
  /** Breaches that got all the way and hurt the king. */
  reachedKing: number;
  repairsCompleted: number;
  hubRepairs: number;
  cosmeticRepairs: number;
  kingDamage: number;
}

/**
 * The deterministic simulation core. Fully decoupled from rendering:
 * nothing in here touches the DOM, and every random draw comes from `rng`
 * in a fixed order.
 */
export class Sim {
  readonly cfg: Config;
  readonly world: World;
  readonly events: SimEvent[] = [];
  readonly totals: RunningTotals;
  readonly level: LevelSpec;
  readonly policy: Policy;
  readonly seed: number;
  readonly masonCountAtStart: number;
  readonly zonesEnabled: boolean;

  /**
   * Two independent streams, on purpose. Demand (when raiders arrive and what
   * they aim at) must not depend on how many rng draws combat resolution happened
   * to make — otherwise changing the policy changes the siege, and no A/B
   * comparison means anything. Same seed → same siege, always.
   */
  private rngDemand: Rng;
  private rngResolve: Rng;
  private bands: CourseBand[] = [];
  private finished = false;
  private outcome: 'survived' | 'fallen' | null = null;
  private stopOnDefeat: boolean;
  private onTick?: (sim: Sim) => void;

  constructor(opts: SimOptions) {
    this.level = opts.level;
    this.policy = opts.policy;
    this.seed = opts.seed;
    this.cfg = resolveConfig(opts.level, opts.configOverrides);
    this.world = buildWorld(opts.level, opts.seed, this.cfg, opts);
    this.rngDemand = new Rng(opts.seed).fork('demand');
    this.rngResolve = new Rng(opts.seed).fork('resolve');
    this.stopOnDefeat = opts.stopOnDefeat ?? true;
    this.onTick = opts.onTick;
    this.masonCountAtStart = this.world.masons.length;
    this.zonesEnabled = this.world.masons.some((m) => m.zone !== null);

    // Course band per brick, precomputed: it never changes and it is read every tick.
    for (const b of this.world.bricks) {
      const wall = this.world.wallsById[b.wallIds[0]];
      this.bands[b.id] = b.keep ? 'mid' : courseBand(b.course, wall.courses);
    }

    this.totals = {
      freshnessAgeIntegral: 0,
      freshnessAgeDenominator: 0,
      breaches: 0,
      breachesByWall: {},
      breachesByCourse: {},
      arrivals: 0,
      repelled: 0,
      stoppedAtKeep: 0,
      reachedKing: 0,
      repairsCompleted: 0,
      hubRepairs: 0,
      cosmeticRepairs: 0,
      kingDamage: 0,
    };
  }

  bandOf(b: Brick): CourseBand {
    return this.bands[b.id];
  }

  get done(): boolean {
    return this.finished;
  }

  get result(): 'survived' | 'fallen' | null {
    return this.outcome;
  }

  /** Run to completion, headless. */
  run(): this {
    while (!this.finished) this.step();
    return this;
  }

  step(): void {
    if (this.finished) return;
    const dt = this.cfg.dt;
    this.world.t += dt;
    this.world.tick++;

    this.decay(dt);
    this.cull();
    this.spawnRaiders(dt);
    this.moveRaiders(dt);
    this.driveMasons(dt);
    this.accumulate(dt);

    if (this.world.king.hp <= 0 && this.stopOnDefeat) {
      this.end('fallen');
    } else if (this.world.t >= this.level.durationSeconds) {
      this.end(this.world.king.hp > 0 ? 'survived' : 'fallen');
    }

    this.onTick?.(this);
  }

  private end(outcome: 'survived' | 'fallen'): void {
    this.finished = true;
    this.outcome = outcome;
    this.events.push({ t: round(this.world.t), type: 'end', outcome, hp: round(this.world.king.hp) });
  }

  // --- Decay --------------------------------------------------------------

  private decay(dt: number): void {
    for (const b of this.world.bricks) {
      if (b.integrity <= 0) continue;
      const before = b.integrity;
      b.integrity = Math.max(0, b.integrity - b.decayRate * dt);
      if (before > 0 && b.integrity <= 0) {
        this.events.push({ t: round(this.world.t), type: 'rubble', brick: b.id, wall: b.wallIds[0] });
      }
    }
  }

  // --- The Culling --------------------------------------------------------

  private cull(): void {
    const c = this.level.culling;
    if (!c) return;
    if (this.world.t < this.world.nextCull) return;
    this.world.nextCull += c.everySeconds;
    const alive = this.world.masons.filter((m) => m.alive);
    const removable = Math.max(0, alive.length - c.floor);
    const n = Math.min(c.count, removable);
    if (n === 0) return;
    // Highest ids leave first — deterministic, and keeps mason 0 as a stable anchor.
    const going = alive.slice(-n);
    for (const m of going) {
      m.alive = false;
      if (m.taskBrickId !== null) {
        const b = this.world.bricks[m.taskBrickId];
        if (b.claimedBy === m.id) b.claimedBy = null;
      }
      m.taskBrickId = null;
      m.state = 'idle';
    }
    this.events.push({
      t: round(this.world.t),
      type: 'cull',
      masons: going.map((m) => m.id),
      remaining: alive.length - n,
    });
  }

  // --- Demand (hidden from the player) ------------------------------------

  private spawnRaiders(dt: number): void {
    for (const d of this.world.demand) {
      d.nextFlip -= dt;
      if (d.nextFlip <= 0) {
        d.bursting = !d.bursting;
        const mean = d.bursting ? this.cfg.burstMeanSeconds : this.cfg.calmMeanSeconds;
        d.nextFlip = this.rngDemand.exponential(1 / mean);
      }
      const rate = d.baseRate * (d.bursting ? this.cfg.burstMultiplier : 1);
      d.nextArrival -= dt * rate;
      while (d.nextArrival <= 0) {
        d.nextArrival += this.rngDemand.exponential(1);
        this.spawnOne(d.wallId);
      }
    }
  }

  /** Draw a bearing inside this wall's sector, flat or lobed. */
  private drawBearing(wall: Wall): number {
    const width = norm(wall.angleEnd - wall.angleStart) || Math.PI * 2;
    if (wall.lobes.length === 0) {
      return norm(wall.angleStart + this.rngDemand.next() * width);
    }
    const lobe = this.rngDemand.pickWeighted(
      wall.lobes,
      wall.lobes.map((l) => l.weight),
    );
    // Keep the draw inside the sector so a lobe near the seam cannot leak into
    // the neighbouring wall's traffic.
    const offset = norm(lobe.angle + this.rngDemand.normal() * lobe.width - wall.angleStart);
    return norm(wall.angleStart + Math.min(Math.max(offset, 0), width));
  }

  private spawnOne(wallId: string): void {
    const wall = this.world.wallsById[wallId];
    const cw = this.cfg.courseWeights;
    // Rank weighting: most queries hit the head of the result set.
    const bandNames: CourseBand[] = ['top', 'mid', 'deep'];
    const band = this.rngDemand.pickWeighted(bandNames, [cw.top, cw.mid, cw.deep]);
    const course = this.courseForBand(band, wall.courses);

    // The bearing decides everything. Whichever brick spans this angle is the one
    // that has to answer — no weighted sampling, just geometry.
    const bearing = this.drawBearing(wall);
    const target = this.brickAt(wall, course, bearing);

    // The raider comes to rest at the FACE of the wall and is turned back there;
    // it must never stop inside the masonry. Which course it queries still decides
    // what defends it (the target set); it simply does not walk in to find out.
    const faceR = this.world.ringOuter + FACE_OFFSET;
    const cos = Math.cos(bearing);
    const sin = Math.sin(bearing);
    const king = this.world.king;

    const r: Raider = {
      id: this.world.nextRaiderId++,
      wallId,
      angle: bearing,
      column: target.column,
      course,
      x: king.x + cos * (faceR + this.cfg.raiderSpawnMargin),
      y: king.y + sin * (faceR + this.cfg.raiderSpawnMargin),
      tx: king.x + cos * faceR,
      ty: king.y + sin * faceR,
      speed: this.cfg.raiderSpeed,
      state: 'approaching',
      phase: 'wall',
      ttl: 0,
      spawnedAt: this.world.t,
    };
    this.world.raiders.push(r);
    this.totals.arrivals++;
    this.events.push({
      t: round(this.world.t),
      type: 'spawn',
      raider: r.id,
      wall: wallId,
      course,
      column: target.column,
    });
  }

  /** The brick on this course whose arc contains the bearing. */
  brickAt(wall: Wall, course: number, bearing: number): Brick {
    const row = wall.grid[course] ?? wall.grid[0];
    for (const id of row) {
      const b = this.world.bricks[id];
      if (inSector(bearing, norm(b.angle - b.angSpan / 2), norm(b.angle + b.angSpan / 2))) return b;
    }
    // Floating point can leave a hairline between arcs; fall back to nearest centre.
    let best = this.world.bricks[row[0]];
    let bestD = Infinity;
    for (const id of row) {
      const b = this.world.bricks[id];
      const d = Math.abs(Math.atan2(Math.sin(bearing - b.angle), Math.cos(bearing - b.angle)));
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /**
   * Which ring a query of this rank actually lands on.
   *
   * `mid` used to floor to 0 whenever a level had two courses, quietly handing
   * the top ring 95% of arrivals instead of the configured 70% and leaving the
   * middle rank dead. With only two rings there is nowhere separate for mid to
   * go, so it shares the inner ring with deep — but it no longer vanishes.
   */
  private courseForBand(band: CourseBand, courses: number): number {
    if (courses <= 1) return 0;
    if (band === 'top') return 0;
    if (band === 'deep') return courses - 1;
    return Math.min(courses - 1, Math.max(1, Math.floor((courses - 1) / 2)));
  }

  // --- Raiders ------------------------------------------------------------

  private moveRaiders(dt: number): void {
    const survivors: Raider[] = [];
    for (const r of this.world.raiders) {
      if (r.state === 'repelled') {
        r.ttl -= dt;
        // Retreat straight back out along the bearing it arrived on.
        r.x += Math.cos(r.angle) * r.speed * dt;
        r.y += Math.sin(r.angle) * r.speed * dt;
        if (r.ttl > 0) survivors.push(r);
        continue;
      }

      const dx = r.tx - r.x;
      const dy = r.ty - r.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = r.speed * dt;
      if (dist > stepLen) {
        r.x += (dx / dist) * stepLen;
        r.y += (dy / dist) * stepLen;
        survivors.push(r);
        continue;
      }
      r.x = r.tx;
      r.y = r.ty;

      if (r.phase === 'wall') {
        if (this.resolveAtWall(r)) survivors.push(r);
      } else if (r.phase === 'keep') {
        if (this.resolveAtKeep(r)) survivors.push(r);
      } else {
        // Reached the king.
        const dmg = this.cfg.breachDamage;
        this.world.king.hp = Math.max(0, this.world.king.hp - dmg);
        this.totals.kingDamage += dmg;
        this.totals.reachedKing++;
        this.events.push({
          t: round(this.world.t),
          type: 'kingHit',
          raider: r.id,
          damage: dmg,
          hp: round(this.world.king.hp),
        });
      }
    }
    this.world.raiders = survivors;
  }

  /**
   * The target set: the specific brick segment the raider aims at, plus the
   * wall's redundancy for that course — spare bricks, and any hub (cornerstone)
   * shared with the neighbouring wall.
   *
   * A raider blocked by ANY intact-or-weathered brick in the set is repelled.
   * (Weathered is cosmetic: it does not let anyone through. That is the point.)
   */
  targetSet(wallId: string, course: number, column: number): Brick[] {
    const wall = this.world.wallsById[wallId];
    const out: Brick[] = [];
    const primary = wall.grid[course]?.[column];
    if (primary !== undefined) out.push(this.world.bricks[primary]);
    for (const id of wall.spares[course] ?? []) out.push(this.world.bricks[id]);
    for (const id of wall.hubs[course] ?? []) out.push(this.world.bricks[id]);
    return out;
  }

  private resolveAtWall(r: Raider): boolean {
    const set = this.targetSet(r.wallId, r.course, r.column);
    const blocker = set.find((b) => b.integrity >= DAMAGE_THRESHOLDS.weathered);
    let pass = false;
    let by = -1;
    if (blocker) {
      by = blocker.id;
    } else {
      let p = 1;
      for (const b of set) p *= passProbability(b.integrity);
      pass = this.rngResolve.chance(p);
      if (!pass) {
        // Credit the sturdiest crumbling brick with the save.
        by = set.reduce((best, b) => (b.integrity > this.world.bricks[best].integrity ? b.id : best), set[0].id);
      }
    }

    if (!pass) {
      r.state = 'repelled';
      r.ttl = this.cfg.repelledTtl;
      this.totals.repelled++;
      this.events.push({
        t: round(this.world.t),
        type: 'repelled',
        raider: r.id,
        wall: r.wallId,
        course: r.course,
        column: r.column,
        by,
      });
      return true;
    }

    r.state = 'breached';
    r.phase = 'keep';
    this.totals.breaches++;
    this.totals.breachesByWall[r.wallId] = (this.totals.breachesByWall[r.wallId] ?? 0) + 1;
    const band = this.bandFor(r.course, this.world.wallsById[r.wallId].courses);
    this.totals.breachesByCourse[band] = (this.totals.breachesByCourse[band] ?? 0) + 1;
    this.events.push({
      t: round(this.world.t),
      type: 'breach',
      raider: r.id,
      wall: r.wallId,
      course: r.course,
      column: r.column,
    });

    // Same heading, straight on. The keep ring is crossed wherever this bearing
    // happens to cross it — nothing is ever re-aimed.
    const keep = this.world.wallsById['K'];
    if (keep.grid[0].length > 0) {
      const keepBrick = this.brickAt(keep, 0, r.angle);
      r.column = keepBrick.column;
      r.tx = this.world.king.x + Math.cos(r.angle) * this.world.keepRadius;
      r.ty = this.world.king.y + Math.sin(r.angle) * this.world.keepRadius;
    } else {
      r.phase = 'king';
      r.tx = this.world.king.x;
      r.ty = this.world.king.y;
    }
    return true;
  }

  private resolveAtKeep(r: Raider): boolean {
    const keep = this.world.wallsById['K'];
    const brickId = keep.grid[0][r.column];
    const b = brickId !== undefined ? this.world.bricks[brickId] : undefined;
    if (b) {
      // The keep mitigates rather than walls: a sound brick turns back
      // `keepRepelChance` of what reaches it, a rubble one turns back nothing.
      const repelChance = (1 - passProbability(b.integrity)) * this.cfg.keepRepelChance;
      if (this.rngResolve.chance(repelChance)) {
        r.state = 'repelled';
        r.ttl = this.cfg.repelledTtl;
        this.totals.repelled++;
        this.totals.stoppedAtKeep++;
        this.events.push({
          t: round(this.world.t),
          type: 'repelled',
          raider: r.id,
          wall: 'K',
          course: 0,
          column: r.column,
          by: b.id,
        });
        return true;
      }
    }
    r.phase = 'king';
    r.tx = this.world.king.x;
    r.ty = this.world.king.y;
    return true;
  }

  private bandFor(course: number, courses: number): CourseBand {
    return courseBand(course, courses);
  }

  // --- Masons -------------------------------------------------------------

  private ctx(m: Mason, b: Brick): EvalCtx {
    return {
      brick: b,
      mason: m,
      distance: Math.hypot(b.x - m.x, b.y - m.y),
      band: this.bands[b.id],
      cfg: this.cfg,
    };
  }

  /** Is there enough integrity missing to justify a task at all? */
  private worthRepairing(b: Brick): boolean {
    return this.cfg.repairTarget - b.integrity >= this.cfg.minRepairBenefit;
  }

  private available(m: Mason, b: Brick): boolean {
    // Zone mode: masons NEVER cross zone boundaries. This is the trap, and it stays.
    if (m.zone !== null && b.zone !== m.zone) return false;
    if (this.cfg.oneMasonPerBrick && b.claimedBy !== null && b.claimedBy !== m.id) return false;
    return true;
  }

  private driveMasons(dt: number): void {
    for (const m of this.world.masons) {
      if (!m.alive) continue;

      // 1. Interrupts can pull a mason off its current task.
      this.checkInterrupt(m);

      // 2. Idle masons pick a task from the policy.
      if (m.taskBrickId === null) this.assign(m);

      // 3. Move and work.
      if (m.taskBrickId === null) {
        m.state = 'idle';
        m.timeIdle += dt;
        continue;
      }

      const b = this.world.bricks[m.taskBrickId];
      const dx = b.x - m.x;
      const dy = b.y - m.y;
      const dist = Math.hypot(dx, dy);

      if (dist > this.cfg.arriveEpsilon) {
        m.state = 'traveling';
        m.timeTraveling += dt;
        const stepLen = Math.min(dist, m.speed * dt);
        m.x += (dx / dist) * stepLen;
        m.y += (dy / dist) * stepLen;
        continue;
      }

      if (m.state !== 'repairing') {
        m.state = 'repairing';
        m.taskWasCosmetic = damageState(b.integrity) === 'weathered' || b.integrity >= DAMAGE_THRESHOLDS.intact;
        m.repairFrom = b.integrity;
        m.repairElapsed = 0;
        this.events.push({
          t: round(this.world.t),
          type: 'repairStart',
          mason: m.id,
          brick: b.id,
          integrity: round(b.integrity),
          cosmetic: m.taskWasCosmetic,
        });
      }

      // FIX-TIME IS CONSTANT. One repair takes the same seconds whatever the brick,
      // so integrity walks from where it started to full over that fixed span. The
      // brick does not decay while a mason has hands on it.
      m.repairElapsed += dt;
      const progress = Math.min(1, m.repairElapsed / this.cfg.masonSecondsPerRepair);
      b.integrity = m.repairFrom + (this.cfg.repairTarget - m.repairFrom) * progress;
      m.timeRepairing += dt;
      if (m.taskWasCosmetic) m.timeRepairingCosmetic += dt;

      if (progress >= 1) {
        this.totals.repairsCompleted++;
        if (b.hub) this.totals.hubRepairs++;
        if (m.taskWasCosmetic) this.totals.cosmeticRepairs++;
        this.events.push({
          t: round(this.world.t),
          type: 'repairDone',
          mason: m.id,
          brick: b.id,
          hub: b.hub,
          cosmetic: m.taskWasCosmetic,
        });
        this.release(m);
      }
    }
  }

  private release(m: Mason): void {
    if (m.taskBrickId !== null) {
      const b = this.world.bricks[m.taskBrickId];
      if (b.claimedBy === m.id) b.claimedBy = null;
    }
    m.taskBrickId = null;
    m.state = 'idle';
    m.interrupted = false;
    m.taskWasCosmetic = false;
    m.repairElapsed = 0;
  }

  private assign(m: Mason): void {
    let bestBrick: Brick | null = null;
    let bestTier = Infinity;
    let bestScore = -Infinity;
    for (const b of this.world.bricks) {
      if (!this.worthRepairing(b)) continue;
      if (!this.available(m, b)) continue;
      const cand = this.policy.evaluate(this.ctx(m, b));
      if (!cand) continue;
      if (cand.tier < bestTier || (cand.tier === bestTier && cand.score > bestScore)) {
        bestTier = cand.tier;
        bestScore = cand.score;
        bestBrick = b;
      }
    }
    if (!bestBrick) return;
    bestBrick.claimedBy = m.id;
    m.taskBrickId = bestBrick.id;
    m.state = 'traveling';
  }

  /**
   * Hysteresis. This is the DESIGNED behaviour, not a shortcut: a committed mason
   * finishes its task unless an interrupt rule fires, and it can only be preempted
   * ONCE per task. Without that second guard masons oscillate forever — the moment
   * a mason starts repairing, its brick climbs out of the interrupt band, some other
   * brick is now the emergency, and it walks away from work it has already paid for.
   */
  private checkInterrupt(m: Mason): void {
    if (m.taskBrickId !== null) {
      const cur = this.world.bricks[m.taskBrickId];
      if (cur.integrity >= this.cfg.repairTarget && this.cfg.abandonIfTaskFullyRepaired) {
        this.release(m);
      } else if (m.interrupted) {
        // Already answered one emergency; see it through.
        return;
      } else if (this.policy.interrupt(this.ctx(m, cur))) {
        // Already on the emergency.
        return;
      }
    }
    if (!this.policy.hasInterrupts) return;

    let best: Brick | null = null;
    let bestD = Infinity;
    for (const b of this.world.bricks) {
      if (b.id === m.taskBrickId) continue;
      if (!this.worthRepairing(b)) continue;
      if (!this.available(m, b)) continue;
      const ctx = this.ctx(m, b);
      if (!this.policy.interrupt(ctx)) continue;
      if (ctx.distance < bestD) {
        bestD = ctx.distance;
        best = b;
      }
    }
    if (!best) return;

    const from = m.taskBrickId;
    this.release(m);
    best.claimedBy = m.id;
    m.taskBrickId = best.id;
    m.state = 'traveling';
    m.interrupted = true;
    this.events.push({ t: round(this.world.t), type: 'interrupt', mason: m.id, from, to: best.id });
  }

  // --- Metrics ------------------------------------------------------------

  private accumulate(dt: number): void {
    let stale = 0;
    let denom = 0;
    for (const b of this.world.bricks) {
      const w = b.demandWeight * this.cfg.rankValue[this.bands[b.id]];
      stale += w * (1 - b.integrity);
      denom += w;
    }
    this.totals.freshnessAgeIntegral += stale * dt;
    this.totals.freshnessAgeDenominator += denom * dt;
  }
}

/** How far outside the outermost course a raider comes to rest. */
const FACE_OFFSET = 15;

/** Event timestamps are rounded so the log is byte-stable across platforms. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
