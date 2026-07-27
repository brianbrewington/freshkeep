import { describe, expect, it } from 'vitest';
import {
  BASICS,
  compileRulebook,
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

describe('uncertainty — a kingdom you remember rather than see', () => {
  const level = getLevel('b7-no-alarm');

  it('hides the truth and shows only confidence', () => {
    const sim = new Sim({ level, seed: 1, policy: presetPolicy('firefighter') });
    // Everything starts whole, so belief is honest at age zero.
    for (const b of sim.world.bricks) {
      expect(b.integrity).toBe(1);
      expect(b.belief).toBe(1);
    }
    let diverged = false;
    while (!sim.done) {
      sim.step();
      for (const b of sim.world.bricks) {
        if (Math.abs(b.belief - b.integrity) > 0.05) diverged = true;
        expect(b.belief).toBeGreaterThanOrEqual(0);
        expect(b.belief).toBeLessThanOrEqual(1);
      }
    }
    // If belief and truth never parted company there is no uncertainty to teach.
    expect(diverged, 'belief tracked truth exactly — nothing is hidden').toBe(true);
  });

  it('lets truth sit still and then jump, rather than draining', () => {
    const sim = new Sim({ level, seed: 2, policy: compileRulebook('DEFAULT: none', 'do nothing') });
    const watched = sim.world.bricks[1];
    let unchangedTicks = 0;
    let jumps = 0;
    let prev = watched.integrity;
    while (!sim.done) {
      sim.step();
      if (watched.integrity === prev) unchangedTicks++;
      else jumps++;
      prev = watched.integrity;
    }
    // A steadily draining brick changes every single tick; a Poisson one does not.
    expect(jumps).toBeGreaterThan(0);
    expect(unchangedTicks).toBeGreaterThan(jumps * 20);
  });

  it('draws change schedules that are exponential, not clockwork', () => {
    // A mean-only check passes for perfectly regular intervals, which is the one
    // thing this must rule out. Coefficient of variation of Exp is 1; clockwork
    // is 0.
    // One world holds only a couple of dozen change events, which is far too few
    // to say anything about a distribution — pool across many.
    const gaps: number[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const sim = new Sim({ level, seed, policy: presetPolicy('nearest') });
      for (const b of sim.world.bricks) {
        for (let i = 1; i < b.changeTimes.length; i++) {
          gaps.push((b.changeTimes[i] - b.changeTimes[i - 1]) * b.decayRate);
        }
      }
    }
    expect(gaps.length).toBeGreaterThan(800);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(1.15);
    expect(sd / mean, 'inter-arrivals are too regular to be memoryless').toBeGreaterThan(0.8);
  });

  it('keeps the world identical across policies — the schedule is not yours to move', () => {
    const schedule = (p: ReturnType<typeof presetPolicy>) => {
      const sim = new Sim({ level, seed: 3, policy: p, stopOnDefeat: false }).run();
      return sim.world.bricks.map((b) => b.changeTimes.map((t) => t.toFixed(4)).join(',')).join('|');
    };
    const a = schedule(presetPolicy('nearest'));
    expect(a).toBe(schedule(presetPolicy('firefighter')));
    // Guard against passing vacuously on empty schedules: there has to be a
    // world there for its independence to mean anything.
    const sim = new Sim({ level, seed: 3, policy: presetPolicy('nearest') });
    const events = sim.world.bricks.reduce((n, b) => n + b.changeTimes.length, 0);
    expect(events, 'no change events at all — independence would be trivially true').toBeGreaterThan(10);
  });

  it('reports whether the board was telling the truth', () => {
    const { report } = runSim({ level, seed: 1, policy: presetPolicy('firefighter') });
    expect(report.reliability.length).toBeGreaterThan(0);
    for (const band of report.reliability) {
      expect(band.n).toBeGreaterThan(0);
      expect(band.held).toBeGreaterThanOrEqual(0);
      expect(band.held).toBeLessThanOrEqual(1);
    }
    // Confidence should be worth something: the most-confident band with a real
    // sample must hold more often than the least-confident one.
    const solid = report.reliability.filter((b) => b.n >= 20);
    if (solid.length >= 2) {
      expect(solid[solid.length - 1].held).toBeGreaterThan(solid[0].held);
    }
  });

  it('waiting for an alarm loses, because there is no alarm', () => {
    const survived = (policy: ReturnType<typeof presetPolicy>) =>
      SEEDS.filter((seed) => runSim({ level, seed, policy }).report.outcome === 'survived').length;
    // Breach counts rather than win rates wherever possible: outcomes here are
    // genuinely noisy (a compound-Poisson world has a coefficient of variation
    // near 1), so survival has little power and breaches have a lot.
    const breaches = (policy: ReturnType<typeof presetPolicy>) =>
      SEEDS.reduce((a, seed) => a + runSim({ level, seed, policy }).report.breaches, 0) / SEEDS.length;

    expect(survived(solutionPolicy('b7-answer')), 'a short round should hold it').toBeGreaterThanOrEqual(4);
    expect(survived(presetPolicy('firefighter')), 'threshold play should fail').toBeLessThanOrEqual(1);

    const sweep = breaches(solutionPolicy('b7-answer'));
    expect(breaches(presetPolicy('firefighter')), 'waiting should leak far more').toBeGreaterThan(sweep * 1.4);
    // The previous level's right answer is a poor answer here: `cracked` is a
    // trigger, and triggers do not fire in a kingdom you cannot see.
    expect(breaches(solutionPolicy('b2-answer')), 'trigger-based play should leak more').toBeGreaterThan(
      sweep * 1.4,
    );
  });

  it('resolves raiders against TRUTH, not against what the player was shown', () => {
    // The load-bearing invariant of the whole model, and it was unasserted.
    // If resolution read belief, a brick displaying 0.5 could never be passed —
    // passProbability is zero for anything at or above the cracked threshold.
    // So a breach through a confident-looking brick can only happen if the
    // hidden truth is what decides.
    let throughConfidentWall = 0;
    let breaches = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new Sim({ level, seed, policy: compileRulebook('DEFAULT: none', 'do nothing') });
      let seen = 0;
      while (!sim.done) {
        sim.step();
        for (let i = seen; i < sim.events.length; i++) {
          const e = sim.events[i];
          if (e.type !== 'breach') continue;
          breaches++;
          const set = sim.targetSet(e.wall, e.course, e.column);
          const shown = 1 - set.reduce((p, b) => p * (1 - b.belief), 1);
          if (shown >= 0.5) throughConfidentWall++;
        }
        seen = sim.events.length;
      }
    }
    expect(breaches).toBeGreaterThan(0);
    expect(
      throughConfidentWall,
      'no raider ever passed a wall the player was reading as sound — resolution is using belief',
    ).toBeGreaterThan(0);
  });
});
