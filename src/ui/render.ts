import type { Brick, Mason, Raider, World } from '../sim/types.js';
import { SIZE_FOOTPRINT, damageState } from '../sim/config.js';
import type { Sim } from '../sim/sim.js';

/**
 * Flat 2D top-down renderer. Readable at a glance is the whole requirement:
 * integrity is a fill level, weathered is a discolouration that is clearly NOT
 * a crack, hubs look like cornerstones, and every raider resolution is visible.
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
  puff: '#e9dfc8',
  king: '#f2d98b',
  text: '#d8ccb4',
  dim: '#7a6f5c',
  drain: '#e06a4a',
};

/** Deterministic per-brick pseudo-randomness so crack sprites never jitter. */
function noise(id: number, salt: number): number {
  let h = Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export interface RenderOptions {
  /** Auction mode: tint bricks by their current bid. */
  showBids?: boolean;
  /** Draw a line from each mason to its current task. */
  showTasks?: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  /** Brick footprint orientation: true when the brick's wall runs vertically. */
  private vertical = new Map<number, boolean>();
  private angle = new Map<number, number>();

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

    // Frame the fortress, not the empty map. Levels with one wall would otherwise
    // sit in a third of the canvas surrounded by nothing.
    let minX = world.king.x;
    let maxX = world.king.x;
    let minY = world.king.y;
    let maxY = world.king.y;
    for (const b of world.bricks) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y);
    }
    const margin = 70;
    minX -= margin;
    maxX += margin;
    minY -= margin;
    maxY += margin;

    const pad = 14;
    this.scale = Math.min(
      (rect.width - pad * 2) / (maxX - minX),
      (rect.height - pad * 2) / (maxY - minY),
    );
    this.ox = (rect.width - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oy = (rect.height - (maxY - minY) * this.scale) / 2 - minY * this.scale;

    this.vertical.clear();
    this.angle.clear();
    for (const b of world.bricks) {
      const wall = world.wallsById[b.wallIds[0]];
      if (b.keep) {
        this.angle.set(b.id, Math.atan2(b.y - world.king.y, b.x - world.king.x));
      } else if (b.hub) {
        this.angle.set(b.id, Math.PI / 4);
      } else {
        this.vertical.set(b.id, wall.nx !== 0);
      }
    }
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

    let maxBid = 1;
    if (opts.showBids && sim.policy.bid) {
      for (const b of w.bricks) {
        maxBid = Math.max(maxBid, sim.policy.bid({ brick: b, mason: w.masons[0], distance: 0, band: sim.bandOf(b), cfg: sim.cfg }));
      }
    }

    for (const b of w.bricks) this.drawBrick(sim, b, opts, maxBid);
    this.drawBreachPulses(sim);
    this.drawKing(sim);
    for (const r of w.raiders) this.drawRaider(sim, r);
    for (const m of w.masons) this.drawMason(sim, m, opts);
  }

  /**
   * A breach is the moment the game is about; it must not slip past unseen.
   * Recent breaches pulse a red ring at the wall segment that gave way.
   */
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

  private drawGround(w: World): void {
    const { ctx } = this;
    ctx.strokeStyle = PALETTE.groundGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 100;
    for (let x = 0; x <= w.width; x += step) {
      ctx.moveTo(this.sx(x), this.sy(0));
      ctx.lineTo(this.sx(x), this.sy(w.height));
    }
    for (let y = 0; y <= w.height; y += step) {
      ctx.moveTo(this.sx(0), this.sy(y));
      ctx.lineTo(this.sx(w.width), this.sy(y));
    }
    ctx.stroke();
  }

  private brickBox(b: Brick): { w: number; h: number } {
    const f = SIZE_FOOTPRINT[b.size];
    if (b.hub) return { w: 30 * this.scale, h: 30 * this.scale };
    const long = 40 * f * this.scale;
    const short = 17 * f * this.scale;
    // Keep bricks are rotated to face outward, so their radial depth is `w`
    // and their tangential length is `h`. Equal values would read as diamonds.
    if (b.keep) return { w: short * 0.9, h: long * 0.8 };
    return this.vertical.get(b.id) ? { w: short, h: long } : { w: long, h: short };
  }

  private drawBrick(sim: Sim, b: Brick, opts: RenderOptions, maxBid: number): void {
    const { ctx } = this;
    const x = this.sx(b.x);
    const y = this.sy(b.y);
    const box = this.brickBox(b);
    const state = damageState(b.integrity);

    ctx.save();
    ctx.translate(x, y);
    const ang = this.angle.get(b.id);
    if (ang !== undefined) ctx.rotate(b.keep ? ang : ang);

    const hw = box.w / 2;
    const hh = box.h / 2;

    // Socket: what is missing is as legible as what is there.
    ctx.fillStyle = PALETTE.empty;
    roundRect(ctx, -hw, -hh, box.w, box.h, 2);
    ctx.fill();

    if (state !== 'rubble') {
      // Integrity as a fill level, growing from the inner (kingward) edge.
      const fillH = box.h * b.integrity;
      const fillW = box.w * b.integrity;
      const useVertical = box.h >= box.w;
      ctx.fillStyle =
        state === 'weathered' ? PALETTE.weathered : state === 'cracked' ? PALETTE.cracked : PALETTE.stone;
      if (b.hub) {
        ctx.fillStyle = state === 'intact' ? PALETTE.hub : ctx.fillStyle;
      }
      if (b.keep && state === 'intact') ctx.fillStyle = PALETTE.keep;

      ctx.save();
      ctx.beginPath();
      if (useVertical) ctx.rect(-hw, hh - fillH, box.w, fillH);
      else ctx.rect(-hw, -hh, fillW, box.h);
      ctx.clip();
      roundRect(ctx, -hw, -hh, box.w, box.h, 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Rubble: a scatter of fragments where a brick used to be. It has to read as
      // DESTROYED, not as absent — an empty-looking socket and a ruined one mean
      // very different things to a player scanning the wall.
      ctx.fillStyle = PALETTE.rubble;
      for (let i = 0; i < 5; i++) {
        const rx = (noise(b.id, i) - 0.5) * box.w * 0.78;
        const ry = (noise(b.id, i + 40) - 0.5) * box.h * 0.78;
        const s = Math.max(1.8, 3.2 * this.scale) * (0.6 + noise(b.id, i + 90) * 0.7);
        ctx.fillRect(rx, ry, s, s);
      }
    }

    // Cracks — drawn ONLY for structural damage, never for weathered.
    if (state === 'cracked') {
      ctx.strokeStyle = 'rgba(20,12,8,0.75)';
      ctx.lineWidth = Math.max(0.8, 1.1 * this.scale);
      const n = 2 + Math.floor((1 - b.integrity / 0.33) * 2);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x0 = (noise(b.id, i) - 0.5) * box.w;
        ctx.moveTo(x0, -hh);
        ctx.lineTo(x0 + (noise(b.id, i + 9) - 0.5) * box.w * 0.5, 0);
        ctx.lineTo(x0 + (noise(b.id, i + 17) - 0.5) * box.w * 0.7, hh);
      }
      ctx.stroke();
    }

    // Weathered = discolouration plus soft diagonal hatching. Deliberately unlike
    // a crack (jagged strokes) AND unlike the drain pips (dots), so the three
    // signals can never be mistaken for one another at a glance.
    if (state === 'weathered') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-hw, -hh, box.w, box.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(52,74,48,0.55)';
      ctx.lineWidth = Math.max(0.7, 1.1 * this.scale);
      const step = Math.max(3, 5 * this.scale);
      ctx.beginPath();
      for (let d = -box.h; d < box.w + box.h; d += step) {
        ctx.moveTo(-hw + d, -hh);
        ctx.lineTo(-hw + d - box.h, hh);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Drain rate: how fast this brick sheds integrity, as pips along its edge.
    // Bucketed by the SAME slow/medium/fast thresholds the DSL exposes, so what
    // the player can see is exactly what they can write a rule about.
    const pips =
      b.decayRate >= sim.cfg.decayNamed.fast ? 3 : b.decayRate >= sim.cfg.decayNamed.medium ? 2 : 1;
    const pipR = Math.max(0.9, 1.5 * this.scale);
    const along = box.w >= box.h;
    ctx.fillStyle = pips === 3 ? PALETTE.drain : pips === 2 ? '#d9a24a' : '#6f7f8a';
    for (let i = 0; i < pips; i++) {
      const off = (i - (pips - 1) / 2) * pipR * 2.6;
      const px = along ? off : hw - pipR * 1.8;
      const py = along ? -hh + pipR * 1.8 : off;
      ctx.beginPath();
      ctx.arc(px, py, pipR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = b.hub ? PALETTE.hubEdge : PALETTE.stoneEdge;
    ctx.lineWidth = b.hub ? Math.max(1.2, 1.8 * this.scale) : Math.max(0.6, 0.9 * this.scale);
    roundRect(ctx, -hw, -hh, box.w, box.h, 2);
    ctx.stroke();

    // Cornerstone mark: hubs must be identifiable without reading a legend.
    if (b.hub) {
      ctx.strokeStyle = PALETTE.hubEdge;
      ctx.lineWidth = Math.max(1, 1.4 * this.scale);
      ctx.beginPath();
      ctx.moveTo(-hw * 0.55, 0);
      ctx.lineTo(0, -hh * 0.55);
      ctx.lineTo(hw * 0.55, 0);
      ctx.lineTo(0, hh * 0.55);
      ctx.closePath();
      ctx.stroke();
    }

    if (opts.showBids && sim.policy.bid) {
      const bid = sim.policy.bid({
        brick: b,
        mason: sim.world.masons[0],
        distance: 0,
        band: sim.bandOf(b),
        cfg: sim.cfg,
      });
      ctx.fillStyle = `rgba(255,150,40,${Math.min(0.62, (bid / maxBid) * 0.62)})`;
      roundRect(ctx, -hw, -hh, box.w, box.h, 2);
      ctx.fill();
    }

    ctx.restore();
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

    // HP ring.
    const frac = Math.max(0, k.hp / k.maxHp);
    ctx.strokeStyle = frac > 0.5 ? '#7fbf7f' : frac > 0.2 ? '#d9b04a' : '#d05a4a';
    ctx.lineWidth = Math.max(2.5, 4 * this.scale);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();

    // A small crown.
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
      // The thwarted puff: expands and fades as it retreats.
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
    const dx = r.tx - r.x;
    const dy = r.ty - r.y;
    const a = Math.atan2(dy, dx);
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
      // Treasure bag — a breach is a raider leaving with something.
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

    // Slump when idle — the zone-mode pathology has to be visible, not inferred.
    const idle = m.state === 'idle';
    const cy = y + (idle ? s * 0.3 : 0);

    ctx.fillStyle = idle ? PALETTE.dim : PALETTE.mason;
    ctx.strokeStyle = 'rgba(15,11,7,0.9)';
    ctx.lineWidth = Math.max(1, 1.2 * this.scale);
    ctx.beginPath();
    ctx.arc(x, cy, s * (idle ? 0.8 : 0.95), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tiny hard hat: clearly smaller than the head, so a mason is never just a dot.
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
