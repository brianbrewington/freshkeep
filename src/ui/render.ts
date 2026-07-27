import type { Brick, Mason, Raider, World } from '../sim/types.js';
import { DAMAGE_THRESHOLDS, damageState } from '../sim/config.js';
import { COURSE_GAP } from '../sim/level.js';
import type { Sim } from '../sim/sim.js';

/**
 * Polar renderer. The board is concentric rings of arcs around the king, and a
 * brick's angular width is its share of traffic — so the picture and the
 * mechanic are the same thing. Readable at a glance is the whole requirement:
 * integrity is a fill level, weathered is a discolouration clearly unlike a
 * crack, hubs look like cornerstones, drain rate is pips, and every raider
 * resolution is visible.
 */

const PALETTE = {
  ground: '#14110d',
  groundGrid: '#1d1913',
  stone: '#c9b898',
  stoneEdge: '#6f6349',
  empty: '#241f18',
  weathered: '#7e8f74',
  cracked: '#b07f5c',
  rubble: '#6b5b48',
  hub: '#e3c77a',
  hubEdge: '#8a6f2e',
  keep: '#9fb6c9',
  mason: '#f0e6d2',
  masonHat: '#e8a33d',
  raider: '#c2504a',
  raiderBreach: '#ff6b5e',
  king: '#f2d98b',
  dim: '#7a6f5c',
  drain: '#e06a4a',
  demand: '#c2504a',
};

/** Deterministic per-brick pseudo-randomness so crack sprites never jitter. */
function noise(id: number, salt: number): number {
  let h = Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export interface RenderOptions {
  showBids?: boolean;
  showTasks?: boolean;
  /** Halo outside the wall showing where raiders actually arrive from. */
  showDemand?: boolean;
  /**
   * Reveal the hidden truth beside the belief. The player is the policy author,
   * not the operator: someone designing a revisit schedule gets ground truth
   * afterwards, their crawler never does. Watching a brick crumble silently while
   * a mason walks past it is the whole mechanic, and it is invisible otherwise.
   */
  showTruth?: boolean;
}

/**
 * Radial depth of a brick, world units. Purely a rendering constant — geometry
 * and balance never read it — so it is free to make bricks readable. A course has
 * COURSE_GAP to play with; single-ring levels have the whole board and get a much
 * chunkier brick, because on those the depletion bar IS the level.
 */
const BRICK_DEPTH = COURSE_GAP * 0.88;
const SINGLE_COURSE_DEPTH = COURSE_GAP * 1.7;
/** Mortar: a hairline of empty arc between neighbours so bricks read separately. */
const MORTAR = 0.006;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  /** Recompute the world→screen transform. Call on resize and on level change. */
  fit(world: World): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Frame the fortress plus the approach lane, not the whole empty map.
    const reach = world.ringOuter + 90;
    const pad = 12;
    this.scale = Math.min((rect.width - pad * 2) / (reach * 2), (rect.height - pad * 2) / (reach * 2));
    this.ox = rect.width / 2 - world.king.x * this.scale;
    this.oy = rect.height / 2 - world.king.y * this.scale;
  }

  private sx(x: number): number {
    return this.ox + x * this.scale;
  }
  private sy(y: number): number {
    return this.oy + y * this.scale;
  }

  draw(sim: Sim, opts: RenderOptions = {}): void {
    const { ctx } = this;
    const w = sim.world;
    const rect = this.canvas.getBoundingClientRect();

    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, 0, rect.width, rect.height);
    this.drawGround(w);
    if (opts.showDemand) this.drawAttacks(sim);

    let maxBid = 1;
    if (opts.showBids && sim.policy.bid) {
      for (const b of w.bricks) {
        maxBid = Math.max(
          maxBid,
          sim.policy.bid({ brick: b, mason: w.masons[0], distance: 0, band: sim.bandOf(b), now: w.t, cfg: sim.cfg }),
        );
      }
    }

    for (const b of w.bricks) this.drawBrick(sim, b, opts, maxBid);
    this.drawBreachPulses(sim);
    this.drawKing(sim);
    for (const r of w.raiders) this.drawRaider(sim, r);
    for (const m of w.masons) this.drawMason(sim, m, opts);
    this.drawKingHitFlash(sim, rect);
  }

  /** The king taking damage is the only thing that actually loses you the game;
   *  it should register even when you are looking somewhere else on the ring. */
  private drawKingHitFlash(sim: Sim, rect: DOMRect): void {
    const window = 0.45;
    let strongest = 0;
    for (let i = sim.events.length - 1; i >= 0; i--) {
      const e = sim.events[i];
      const age = sim.world.t - e.t;
      if (age > window) break;
      if (e.type === 'kingHit') strongest = Math.max(strongest, 1 - age / window);
    }
    if (strongest <= 0) return;
    const { ctx } = this;
    ctx.fillStyle = `rgba(208,90,74,${(strongest * 0.16).toFixed(3)})`;
    ctx.fillRect(0, 0, rect.width, rect.height);
  }

  /** Concentric guide rings — the board is polar, so the grid should be too. */
  private drawGround(w: World): void {
    const { ctx } = this;
    const kx = this.sx(w.king.x);
    const ky = this.sy(w.king.y);
    ctx.strokeStyle = PALETTE.groundGrid;
    ctx.lineWidth = 1;
    for (let r = 60; r <= w.ringOuter + 90; r += 60) {
      ctx.beginPath();
      ctx.arc(kx, ky, r * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Where raiders have ACTUALLY arrived from — the observed record, smeared to
   * reflect that a single hit tells you roughly, not exactly, where the pressure
   * is. This deliberately replaced an overlay that drew the true generating
   * distribution: showing the answer removes the inference, and inferring where
   * the traffic is from where you have been hit is the skill.
   */
  private drawAttacks(sim: Sim): void {
    const { ctx } = this;
    const w = sim.world;
    const bins = w.arrivalBins;
    const n = bins.length;
    const total = bins.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    // Angular smearing: one arrival is a soft lobe of evidence, not a spike.
    const sigma = 3.2;
    const radius = Math.ceil(sigma * 2.5);
    const kernel: number[] = [];
    let kSum = 0;
    for (let d = -radius; d <= radius; d++) {
      const v = Math.exp(-(d * d) / (2 * sigma * sigma));
      kernel.push(v);
      kSum += v;
    }
    const smooth = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (bins[i] === 0) continue;
      for (let d = -radius; d <= radius; d++) {
        smooth[(i + d + n) % n] += (bins[i] * kernel[d + radius]) / kSum;
      }
    }
    const peak = Math.max(...smooth) || 1;

    const kx = this.sx(w.king.x);
    const ky = this.sy(w.king.y);
    const base = (w.ringOuter + 30) * this.scale;
    const amp = 46 * this.scale;

    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const a = ((idx + 0.5) / n) * Math.PI * 2;
      const r = base + (smooth[idx] / peak) * amp;
      const x = kx + Math.cos(a) * r;
      const y = ky + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(194,80,74,0.5)';
    ctx.lineWidth = Math.max(1, 1.2 * this.scale);
    ctx.stroke();
    ctx.arc(kx, ky, base, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(194,80,74,0.17)';
    ctx.fill('evenodd');
  }

  /** Trace an annulus sector: the one shape every brick on this board is. */
  private arcPath(kx: number, ky: number, rIn: number, rOut: number, a0: number, a1: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(kx, ky, rOut, a0, a1);
    ctx.arc(kx, ky, rIn, a1, a0, true);
    ctx.closePath();
  }

  private drawBrick(sim: Sim, b: Brick, opts: RenderOptions, maxBid: number): void {
    const { ctx } = this;
    const w = sim.world;
    const kx = this.sx(w.king.x);
    const ky = this.sy(w.king.y);
    // BELIEF, never truth. Drawing the hidden adequacy would hand the player
    // exactly the thing the uncertain model exists to withhold.
    const state = damageState(b.belief);

    const wall = w.wallsById[b.wallIds[0]];
    const roomy = !b.keep && wall && wall.courses === 1;
    const base = roomy ? SINGLE_COURSE_DEPTH : BRICK_DEPTH;
    const depth = (b.hub ? base * 1.25 : base) * this.scale;
    const rMid = b.radius * this.scale;
    const rIn = rMid - depth / 2;
    const rOut = rMid + depth / 2;
    const half = Math.max(b.angSpan / 2 - MORTAR, b.angSpan * 0.2);
    const a0 = b.angle - half;
    const a1 = b.angle + half;

    // Socket: what is missing must be as legible as what is there.
    this.arcPath(kx, ky, rIn, rOut, a0, a1);
    ctx.fillStyle = PALETTE.empty;
    ctx.fill();

    if (state !== 'rubble') {
      ctx.fillStyle =
        state === 'weathered' ? PALETTE.weathered : state === 'cracked' ? PALETTE.cracked : PALETTE.stone;
      if (b.hub && state === 'intact') ctx.fillStyle = PALETTE.hub;
      if (b.keep && state === 'intact') ctx.fillStyle = PALETTE.keep;
      // Integrity fills outward from the kingward edge: a half-gone brick is
      // visibly half a wall, with the gap on the side the raiders come from.
      this.arcPath(kx, ky, rIn, rIn + (rOut - rIn) * b.belief, a0, a1);
      ctx.fill();
    } else {
      ctx.fillStyle = PALETTE.rubble;
      for (let i = 0; i < 5; i++) {
        const a = a0 + (a1 - a0) * noise(b.id, i);
        const r = rIn + (rOut - rIn) * noise(b.id, i + 40);
        const s = Math.max(1.6, 2.8 * this.scale);
        ctx.fillRect(kx + Math.cos(a) * r - s / 2, ky + Math.sin(a) * r - s / 2, s, s);
      }
    }

    ctx.save();
    this.arcPath(kx, ky, rIn, rOut, a0, a1);
    ctx.clip();

    // Cracks: jagged radial fractures. Structural damage only.
    if (state === 'cracked') {
      ctx.strokeStyle = 'rgba(20,12,8,0.8)';
      ctx.lineWidth = Math.max(0.9, 1.2 * this.scale);
      const n = 2 + Math.floor((1 - b.belief / 0.33) * 2);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (0.2 + 0.6 * noise(b.id, i));
        const jitter = (noise(b.id, i + 11) - 0.5) * (a1 - a0) * 0.5;
        ctx.moveTo(kx + Math.cos(a) * rIn, ky + Math.sin(a) * rIn);
        ctx.lineTo(kx + Math.cos(a + jitter) * rMid, ky + Math.sin(a + jitter) * rMid);
        ctx.lineTo(kx + Math.cos(a - jitter) * rOut, ky + Math.sin(a - jitter) * rOut);
      }
      ctx.stroke();
    }

    // Weathered: tangential hatching. Deliberately unlike a crack (radial, jagged)
    // and unlike the drain pips (dots), so the three signals never blur together.
    if (state === 'weathered') {
      ctx.strokeStyle = 'rgba(52,74,48,0.6)';
      ctx.lineWidth = Math.max(0.7, 1 * this.scale);
      const rings = 3;
      ctx.beginPath();
      for (let i = 1; i <= rings; i++) {
        const r = rIn + ((rOut - rIn) * i) / (rings + 1);
        ctx.arc(kx, ky, r, a0, a1);
        ctx.moveTo(kx + Math.cos(a0) * rIn, ky + Math.sin(a0) * rIn);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = b.hub ? PALETTE.hubEdge : PALETTE.stoneEdge;
    ctx.lineWidth = b.hub ? Math.max(1.3, 1.9 * this.scale) : Math.max(0.6, 0.9 * this.scale);
    this.arcPath(kx, ky, rIn, rOut, a0, a1);
    ctx.stroke();

    // Cornerstone mark, so a hub is identifiable without a legend.
    if (b.hub) {
      ctx.strokeStyle = PALETTE.hubEdge;
      ctx.lineWidth = Math.max(1, 1.3 * this.scale);
      ctx.beginPath();
      ctx.moveTo(kx + Math.cos(a0) * rMid, ky + Math.sin(a0) * rMid);
      ctx.lineTo(kx + Math.cos(b.angle) * rOut, ky + Math.sin(b.angle) * rOut);
      ctx.lineTo(kx + Math.cos(a1) * rMid, ky + Math.sin(a1) * rMid);
      ctx.lineTo(kx + Math.cos(b.angle) * rIn, ky + Math.sin(b.angle) * rIn);
      ctx.closePath();
      ctx.stroke();
    }

    // Truth, for the omniscient viewer. A tick where the adequacy really sits,
    // and a hard marker when the brick is ALREADY passable while still reading
    // sound — the silent crumble the player would otherwise never see.
    if (opts.showTruth && sim.level.decayModel === 'uncertain') {
      const gap = b.belief - b.integrity;
      if (gap > 0.03) {
        const rt = rIn + (rOut - rIn) * b.integrity;
        ctx.strokeStyle = 'rgba(150,220,235,0.85)';
        ctx.lineWidth = Math.max(1, 1.4 * this.scale);
        ctx.beginPath();
        ctx.arc(kx, ky, rt, a0, a1);
        ctx.stroke();
      }
      if (b.integrity < DAMAGE_THRESHOLDS.weathered && b.belief >= DAMAGE_THRESHOLDS.weathered) {
        ctx.fillStyle = 'rgba(255,107,94,0.30)';
        this.arcPath(kx, ky, rIn, rOut, a0, a1);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,107,94,0.95)';
        ctx.lineWidth = Math.max(1.2, 1.8 * this.scale);
        this.arcPath(kx, ky, rIn, rOut, a0, a1);
        ctx.stroke();
      }
    }

    // Drain rate: pips just outside the brick, bucketed by the same slow/medium/
    // fast thresholds the DSL exposes — what you can see is what you can rule on.
    const pips =
      b.decayRate >= sim.cfg.decayNamed.fast ? 3 : b.decayRate >= sim.cfg.decayNamed.medium ? 2 : 1;
    const pipR = Math.max(1, 1.6 * this.scale);
    ctx.fillStyle = pips === 3 ? PALETTE.drain : pips === 2 ? '#d9a24a' : '#6f7f8a';
    for (let i = 0; i < pips; i++) {
      const spread = Math.min((a1 - a0) * 0.3, 0.05);
      const a = b.angle + (i - (pips - 1) / 2) * spread;
      const r = rOut - pipR * 2.1;
      ctx.beginPath();
      ctx.arc(kx + Math.cos(a) * r, ky + Math.sin(a) * r, pipR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (opts.showBids && sim.policy.bid) {
      const bid = sim.policy.bid({
        brick: b,
        mason: w.masons[0],
        distance: 0,
        band: sim.bandOf(b),
        now: w.t,
        cfg: sim.cfg,
      });
      this.arcPath(kx, ky, rIn, rOut, a0, a1);
      ctx.fillStyle = `rgba(255,150,40,${Math.min(0.62, (bid / maxBid) * 0.62)})`;
      ctx.fill();
    }
  }

  private drawBreachPulses(sim: Sim): void {
    const { ctx } = this;
    const window = 0.9;
    for (let i = sim.events.length - 1; i >= 0; i--) {
      const e = sim.events[i];
      const age = sim.world.t - e.t;
      if (age > window) break;
      if (e.type !== 'breach') continue;
      const set = sim.targetSet(e.wall, e.course, e.column);
      if (!set.length) continue;
      const b = set[0];
      const k = age / window;
      ctx.strokeStyle = `rgba(255,107,94,${(1 - k) * 0.9})`;
      ctx.lineWidth = Math.max(1.5, 2.5 * this.scale);
      ctx.beginPath();
      ctx.arc(this.sx(b.x), this.sy(b.y), Math.max(6, 12 * this.scale) * (1 + k * 2.4), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawKing(sim: Sim): void {
    const { ctx } = this;
    const k = sim.world.king;
    const x = this.sx(k.x);
    const y = this.sy(k.y);
    const r = Math.max(9, 17 * this.scale);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.fill();

    const frac = Math.max(0, k.hp / k.maxHp);
    ctx.strokeStyle = frac > 0.5 ? '#7fbf7f' : frac > 0.2 ? '#d9b04a' : '#d05a4a';
    ctx.lineWidth = Math.max(2.5, 4 * this.scale);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();

    ctx.fillStyle = PALETTE.king;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.7, y + r * 0.5);
    ctx.lineTo(x - r * 0.7, y - r * 0.2);
    ctx.lineTo(x - r * 0.3, y + r * 0.1);
    ctx.lineTo(x, y - r * 0.6);
    ctx.lineTo(x + r * 0.3, y + r * 0.1);
    ctx.lineTo(x + r * 0.7, y - r * 0.2);
    ctx.lineTo(x + r * 0.7, y + r * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  private drawRaider(sim: Sim, r: Raider): void {
    const { ctx } = this;
    const x = this.sx(r.x);
    const y = this.sy(r.y);
    const s = Math.max(3, 6 * this.scale);

    if (r.state === 'repelled') {
      const age = 1 - r.ttl / sim.cfg.repelledTtl;
      ctx.strokeStyle = `rgba(233,223,200,${(1 - age) * 0.8})`;
      ctx.lineWidth = Math.max(1, 1.6 * this.scale);
      ctx.beginPath();
      ctx.arc(x, y, s * (1 + age * 2.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(194,80,74,${1 - age})`;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.7, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const breached = r.state === 'breached';
    ctx.fillStyle = breached ? PALETTE.raiderBreach : PALETTE.raider;
    // Every raider points at the king, always.
    const a = Math.atan2(this.sy(sim.world.king.y) - y, this.sx(sim.world.king.x) - x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(s * 1.3, 0);
    ctx.lineTo(-s * 0.8, s * 0.8);
    ctx.lineTo(-s * 0.8, -s * 0.8);
    ctx.closePath();
    ctx.fill();
    if (breached) {
      ctx.fillStyle = PALETTE.king;
      ctx.beginPath();
      ctx.arc(-s * 1.2, 0, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawMason(sim: Sim, m: Mason, opts: RenderOptions): void {
    if (!m.alive) return;
    const { ctx } = this;
    const x = this.sx(m.x);
    const y = this.sy(m.y);
    const s = Math.max(5, 9 * this.scale);

    if (opts.showTasks && m.taskBrickId !== null) {
      const b = sim.world.bricks[m.taskBrickId];
      ctx.strokeStyle = 'rgba(240,230,210,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(this.sx(b.x), this.sy(b.y));
      ctx.stroke();
    }

    const idle = m.state === 'idle';
    const cy = y + (idle ? s * 0.3 : 0);

    ctx.fillStyle = idle ? PALETTE.dim : PALETTE.mason;
    ctx.strokeStyle = 'rgba(15,11,7,0.9)';
    ctx.lineWidth = Math.max(1, 1.2 * this.scale);
    ctx.beginPath();
    ctx.arc(x, cy, s * (idle ? 0.8 : 0.95), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const hatY = cy - s * 0.42;
    ctx.fillStyle = idle ? '#8a6a33' : PALETTE.masonHat;
    ctx.beginPath();
    ctx.arc(x, hatY, s * 0.62, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x - s * 0.85, hatY, s * 1.7, s * 0.26);

    if (m.state === 'repairing') {
      ctx.strokeStyle = 'rgba(255,230,170,0.85)';
      ctx.lineWidth = Math.max(1, 1.5 * this.scale);
      const wobble = Math.sin(sim.world.t * 14 + m.id) * s * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.9, y - s * 0.5 + wobble);
      ctx.lineTo(x + s * 1.7, y - s * 0.1 + wobble);
      ctx.stroke();
    }

    if (m.interrupted) {
      ctx.fillStyle = '#ffd75e';
      ctx.font = `bold ${Math.max(9, 12 * this.scale)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - s * 1.6);
    }
  }
}
