import { describe, expect, it } from 'vitest';
import {
  BASICS,
  SOLUTIONS,
  Sim,
  getLevel,
  norm,
  presetPolicy,
  runSim,
  solutionPolicy,
} from '../src/sim/index.js';

/**
 * "The lesson is plain" is not a matter of taste — it is a claim about the
 * simulation, so it is asserted here: on each teaching level the right policy
 * holds and the named wrong one falls, with nothing else changed.
 */

const SEEDS = [1, 2, 3, 4, 5];

function rate(levelId: string, policy: ReturnType<typeof presetPolicy>, masonCount?: number): number {
  const level = getLevel(levelId);
  return SEEDS.filter((seed) => runSim({ level, seed, policy, masonCount }).report.outcome === 'survived')
    .length;
}

describe('the basics — one mason, one ring, one idea', () => {
  it('every teaching level names a wrong preset and ships a worked solution', () => {
    for (const level of BASICS) {
      expect(level.wrongPreset, `${level.id} names no wrong preset`).toBeTruthy();
      expect(SOLUTIONS.find((s) => s.level === level.id), `${level.id} has no worked solution`).toBeTruthy();
      expect(level.masons, `${level.id} should be a one-mason level`).toBe(1);
      expect(level.courses, `${level.id} should be a single ring`).toBe(1);
    }
  });

  // Two Gates is the exception on purpose: it is the thesis button, unwinnable by
  // any policy at one mason and comfortable at two.
  for (const level of BASICS.filter((l) => l.id !== 'b5-everywhere')) {
    it(`${level.id}: the solution holds it and ${level.wrongPreset} does not`, () => {
      const solution = SOLUTIONS.find((s) => s.level === level.id)!;
      const good = rate(level.id, solutionPolicy(solution.id));
      const bad = rate(level.id, presetPolicy(level.wrongPreset!));
      expect(good, `${solution.name} should hold ${level.name}`).toBeGreaterThanOrEqual(SEEDS.length - 1);
      expect(bad, `${level.wrongPreset} should fail ${level.name}`).toBeLessThanOrEqual(1);
    });
  }

  it('b5-everywhere: no policy holds it with one mason, and two masons walk it home', () => {
    const policy = solutionPolicy('b5-answer');
    expect(rate('b5-everywhere', policy, 1), 'one mason cannot be in two places').toBe(0);
    expect(rate('b5-everywhere', policy, 2), 'two masons hold it with the same rulebook').toBe(SEEDS.length);
  });

  it('a breach reaches the king directly — no keep ring to muddy cause and effect', () => {
    for (const level of BASICS) {
      expect(level.keepBricks, `${level.id} should have no keep ring`).toBe(0);
      expect(level.hubsPerCorner).toBe(0);
    }
  });
});

describe('the board is radial', () => {
  it('walls partition the whole circle, leaving no bearing undefended', () => {
    for (const id of ['b1-keystone', 'cornerstones', 'seam']) {
      const sim = new Sim({ level: getLevel(id), seed: 1, policy: presetPolicy('balanced') });
      const total = sim.world.walls
        .filter((w) => w.id !== 'K')
        .reduce((s, w) => s + (norm(w.angleEnd - w.angleStart) || Math.PI * 2), 0);
      expect(total, `${id} leaves an angular gap`).toBeCloseTo(Math.PI * 2, 6);
    }
  });

  it('each course tiles its sector exactly, with span proportional to throughput', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 1, policy: presetPolicy('balanced') });
    for (const wall of sim.world.walls) {
      if (wall.id === 'K') continue;
      const sector = norm(wall.angleEnd - wall.angleStart) || Math.PI * 2;
      for (let c = 0; c < wall.courses; c++) {
        const row = wall.grid[c].map((id) => sim.world.bricks[id]);
        const covered = row.reduce((s, b) => s + b.angSpan, 0);
        expect(covered, `wall ${wall.id} course ${c} does not tile its sector`).toBeCloseTo(sector, 9);
        // A brick's arc IS its share of traffic, so arcs must track throughput.
        const perUnit = row.map((b) => b.angSpan / b.throughput);
        for (const u of perUnit) expect(u).toBeCloseTo(perUnit[0], 9);
      }
    }
  });

  it('every raider walks straight at the king and is never re-aimed', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 3, policy: presetPolicy('twitchiest') });
    const king = sim.world.king;
    const last = new Map<number, number>();
    let worst = 0;
    let seen = 0;
    while (!sim.done) {
      sim.step();
      for (const r of sim.world.raiders) {
        if (r.state === 'repelled') continue;
        seen++;
        const d = Math.hypot(r.x - king.x, r.y - king.y);
        const prev = last.get(r.id);
        if (prev !== undefined) worst = Math.max(worst, d - prev);
        last.set(r.id, d);
      }
    }
    expect(seen).toBeGreaterThan(0);
    // Any increase in distance-to-king would mean something turned a raider around.
    expect(worst).toBeLessThan(1e-9);
  });

  it('a raider comes to rest at the wall face, never inside the masonry', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 4, policy: presetPolicy('balanced') });
    const king = sim.world.king;
    let checked = 0;
    while (!sim.done && sim.world.t < 60) {
      sim.step();
      for (const r of sim.world.raiders) {
        if (r.state !== 'approaching') continue;
        const d = Math.hypot(r.x - king.x, r.y - king.y);
        // Still outside the outermost course while it is approaching.
        expect(d).toBeGreaterThan(sim.world.ringOuter);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('demand distribution', () => {
  it('is flat on the teaching levels — one variable at a time', () => {
    for (const level of BASICS) {
      const sim = new Sim({ level, seed: 1, policy: presetPolicy('nearest') });
      for (const w of sim.world.walls) expect(w.lobes.length, `${level.id} is not flat`).toBe(0);
    }
  });

  it('is peaked on The Bubble Trap, and the lobes sit on the NARROW bricks', () => {
    const sim = new Sim({ level: getLevel('bubble-trap'), seed: 1, policy: presetPolicy('balanced') });
    const wall = sim.world.walls.find((w) => w.id !== 'K')!;
    expect(wall.lobes.length).toBeGreaterThan(0);

    const row = wall.grid[0].map((id) => sim.world.bricks[id]);
    const median = [...row].sort((a, b) => a.angSpan - b.angSpan)[Math.floor(row.length / 2)].angSpan;
    for (const lobe of wall.lobes) {
      const host = row.find(
        (b) => Math.abs(Math.atan2(Math.sin(lobe.angle - b.angle), Math.cos(lobe.angle - b.angle))) < 1e-9,
      );
      expect(host, 'a lobe should sit on a brick').toBeTruthy();
      expect(host!.angSpan, 'the traffic should pile onto narrow arcs, not wide ones').toBeLessThanOrEqual(
        median,
      );
    }
  });
});
