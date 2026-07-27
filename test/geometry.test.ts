import { describe, expect, it } from 'vitest';
import {
  Sim,
  compileRulebook,
  getLevel,
  inSector,
  norm,
  presetPolicy,
  runSim,
  type SimEvent,
} from '../src/sim/index.js';

/**
 * These tests exist because a cross-model review pointed out that the polar
 * geometry was only ever protected INDIRECTLY — break the bearing→brick mapping
 * and the suite noticed, but it noticed as "a teaching level stopped being
 * winnable", which tells you nothing about what broke.
 *
 * Everything here asserts a mechanic directly, so a regression names itself.
 */

const TAU = Math.PI * 2;

function spawns(sim: Sim): Array<Extract<SimEvent, { type: 'spawn' }>> {
  return sim.events.filter((e): e is Extract<SimEvent, { type: 'spawn' }> => e.type === 'spawn');
}

describe('bearing → brick: the arc a brick covers IS its share of the traffic', () => {
  it('sends raiders to each brick in proportion to its angular width', () => {
    // The Keystone is the sharpest case: flat demand, one ring, hand-set spans,
    // and one brick deliberately covering 92% of the circle.
    const level = getLevel('b1-keystone');
    const counts = new Map<number, number>();
    let total = 0;
    // Many seeds, because this is a distributional claim and one siege is a
    // sample of ~70 arrivals.
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Sim({ level, seed, policy: presetPolicy('nearest') }).run();
      for (const e of spawns(sim)) {
        counts.set(e.column, (counts.get(e.column) ?? 0) + 1);
        total++;
      }
    }
    expect(total).toBeGreaterThan(2000);

    const sim = new Sim({ level, seed: 1, policy: presetPolicy('nearest') });
    const wall = sim.world.wallsById['N'];
    for (const id of wall.grid[0]) {
      const brick = sim.world.bricks[id];
      const expected = brick.angSpan / TAU;
      const observed = (counts.get(brick.column) ?? 0) / total;
      // Binomial noise at n>2000 is well under a point; 3pp is generous but
      // still nails a 92% brick to 92% and a 1.6% brick to 1.6%.
      expect(
        Math.abs(observed - expected),
        `column ${brick.column} (${brick.size}) covers ${(expected * 100).toFixed(1)}% of the circle but took ${(observed * 100).toFixed(1)}% of the raiders`,
      ).toBeLessThan(0.03);
    }
    // And specifically: the keystone really does soak the overwhelming majority.
    const keystone = sim.world.bricks[wall.grid[0][0]];
    expect((counts.get(keystone.column) ?? 0) / total).toBeGreaterThan(0.85);
  });

  it('routes every bearing to the brick whose arc contains it', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 1, policy: presetPolicy('balanced') });
    for (const wall of sim.world.walls) {
      if (wall.id === 'K') continue;
      for (let course = 0; course < wall.courses; course++) {
        for (const id of wall.grid[course]) {
          const b = sim.world.bricks[id];
          // Probe inside the arc, and just inside each edge.
          for (const probe of [b.angle, b.angle - b.angSpan * 0.49, b.angle + b.angSpan * 0.49]) {
            const got = sim.brickAt(wall, course, norm(probe));
            expect(got.id, `bearing inside brick ${b.id}'s arc resolved to brick ${got.id}`).toBe(b.id);
          }
        }
      }
    }
  });

  it('resolves a seam bearing into exactly one wall', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 1, policy: presetPolicy('balanced') });
    const sectors = sim.world.walls.filter((w) => w.id !== 'K');
    for (const w of sectors) {
      for (const probe of [w.angleStart, w.angleStart + 1e-9]) {
        const owners = sectors.filter((x) => inSector(norm(probe), x.angleStart, x.angleEnd));
        expect(owners.length, `bearing ${probe} is owned by ${owners.length} walls`).toBe(1);
      }
    }
  });
});

describe('inSector: boundaries and wrap-around', () => {
  it('is half-open [start, end) so neighbouring sectors never both claim a bearing', () => {
    expect(inSector(0, 0, 1)).toBe(true); // start is inclusive
    expect(inSector(1, 0, 1)).toBe(false); // end is exclusive
    expect(inSector(0.5, 0, 1)).toBe(true);
    expect(inSector(1.5, 0, 1)).toBe(false);
  });

  it('handles sectors that wrap past zero', () => {
    const start = norm(-0.2);
    const end = norm(0.2);
    expect(inSector(0, start, end)).toBe(true);
    expect(inSector(norm(-0.1), start, end)).toBe(true);
    expect(inSector(0.1, start, end)).toBe(true);
    expect(inSector(0.3, start, end)).toBe(false);
    expect(inSector(Math.PI, start, end)).toBe(false);
  });

  it('treats a zero-width sector as the whole circle, for one-wall levels', () => {
    for (const a of [0, 1, 3, 6]) expect(inSector(a, 0.7, 0.7)).toBe(true);
  });
});

describe('the demand stream is isolated from the policy', () => {
  it('produces an identical spawn sequence for different policies at the same seed', () => {
    // The guarantee is not "same arrival count" — it is that the siege itself is
    // untouched by how well you defend. Compare the full spawn log, not a total.
    const level = getLevel('cornerstones');
    const key = (sim: Sim) =>
      spawns(sim)
        .map((e) => `${e.t}|${e.wall}|${e.course}|${e.column}|${e.raider}`)
        .join('\n');

    const a = new Sim({ level, seed: 7, policy: presetPolicy('balanced'), stopOnDefeat: false }).run();
    const b = new Sim({ level, seed: 7, policy: presetPolicy('nearest'), stopOnDefeat: false }).run();
    const c = new Sim({
      level,
      seed: 7,
      policy: compileRulebook('DEFAULT: none', 'do nothing'),
      stopOnDefeat: false,
    }).run();

    expect(key(a).length).toBeGreaterThan(0);
    expect(key(b), 'a different policy changed the siege').toBe(key(a));
    // A policy that repairs NOTHING is the extreme case: wildly different combat
    // rolls, and still the same raiders arriving at the same instants.
    expect(key(c), 'doing nothing changed the siege').toBe(key(a));
  });

  it('is unchanged by the size of the crew', () => {
    const level = getLevel('cornerstones');
    const key = (masonCount: number) =>
      spawns(
        new Sim({ level, seed: 5, policy: presetPolicy('balanced'), masonCount, stopOnDefeat: false }).run(),
      )
        .map((e) => `${e.t}|${e.wall}|${e.course}|${e.column}`)
        .join('\n');
    expect(key(4), 'the thesis button compares two different sieges').toBe(key(16));
  });
});

describe('rank weighting actually reaches the ring it names', () => {
  it('gives the inner ring real traffic even when a level has only two courses', () => {
    // `mid` used to floor onto course 0, handing the top ring 95% of arrivals on
    // any two-course level and leaving the middle rank dead.
    const sim = new Sim({ level: getLevel('tutorial'), seed: 1, policy: presetPolicy('balanced') }).run();
    const byCourse = new Map<number, number>();
    for (const e of spawns(sim)) byCourse.set(e.course, (byCourse.get(e.course) ?? 0) + 1);
    const total = [...byCourse.values()].reduce((a, b) => a + b, 0);
    const inner = (byCourse.get(1) ?? 0) / total;
    expect(inner, 'the inner ring of a two-course level is being starved').toBeGreaterThan(0.15);
  });

  it('still sends most queries to the head of the result set', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 2, policy: presetPolicy('balanced') }).run();
    const byCourse = new Map<number, number>();
    for (const e of spawns(sim)) byCourse.set(e.course, (byCourse.get(e.course) ?? 0) + 1);
    const total = [...byCourse.values()].reduce((a, b) => a + b, 0);
    expect((byCourse.get(0) ?? 0) / total).toBeGreaterThan(0.6);
    expect((byCourse.get(0) ?? 0) / total).toBeLessThan(0.8);
  });
});

describe('the DSL means what it says', () => {
  it('reads `traffic` as angular share, not size class', () => {
    const p = compileRulebook('PRIORITY 1: bricks WHERE traffic > 1.0');
    const sim = new Sim({ level: getLevel('b1-keystone'), seed: 1, policy: presetPolicy('nearest') });
    const wall = sim.world.wallsById['N'];
    const keystone = sim.world.bricks[wall.grid[0][0]];
    const sliver = sim.world.bricks[wall.grid[0][1]];
    const ctx = (b: typeof keystone) => ({ brick: b, mason: sim.world.masons[0], distance: 1, band: sim.bandOf(b), now: 0, cfg: sim.cfg });
    expect(p.evaluate(ctx(keystone)), 'the 92% arc should be high-traffic').toBeTruthy();
    expect(p.evaluate(ctx(sliver)), 'a 1.6% arc should not be high-traffic').toBeNull();
    // ...and the two signals genuinely disagree, which is the whole point.
    expect(sliver.throughput).toBeGreaterThanOrEqual(keystone.throughput / 9);
  });

  it('refuses an ordering comparison on `wall` instead of silently ignoring it', () => {
    expect(() => compileRulebook('PRIORITY 1: bricks WHERE wall > E')).toThrow(/no order/);
    expect(() => compileRulebook('PRIORITY 1: bricks WHERE wall = E')).not.toThrow();
    expect(() => compileRulebook('PRIORITY 1: bricks WHERE wall != E')).not.toThrow();
  });

  it('keeps `structural` pinned to the shared cracked threshold', () => {
    const p = compileRulebook('PRIORITY 1: bricks WHERE structural');
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 1, policy: presetPolicy('balanced') });
    const b = sim.world.bricks[0];
    const ctx = (integrity: number) => ({
      brick: { ...b, integrity, belief: integrity },
      mason: sim.world.masons[0],
      distance: 1,
      band: sim.bandOf(b),
      now: 0,
      cfg: sim.cfg,
    });
    expect(p.evaluate(ctx(sim.cfg.dt * 0))).toBeTruthy();
    expect(p.evaluate(ctx(0.32))).toBeTruthy();
    expect(p.evaluate(ctx(0.34))).toBeNull();
  });
});

describe('mutation guard', () => {
  it('a level whose bricks are all repaired sees zero breaches — combat depends on integrity', () => {
    // Cheap canary: if resolution ever stopped reading integrity, this flips.
    const level = { ...getLevel('b1-keystone'), durationSeconds: 60 };
    const { report } = runSim({
      level: {
        ...level,
        walls: level.walls.map((w) => ({
          ...w,
          plan: w.plan?.map((course) => course.map((p) => ({ ...p, integrity: 1, decay: 0 }))),
        })),
      },
      seed: 1,
      policy: compileRulebook('DEFAULT: none', 'do nothing'),
    });
    expect(report.arrivals).toBeGreaterThan(0);
    expect(report.breaches, 'an undamaged wall let someone through').toBe(0);
  });
});

describe('per-brick importance is a real prediction, not a label', () => {
  it('sums to the level demand rate including bursts, and scales with pressure', () => {
    for (const id of ['b1-keystone', 'bubble-trap', 'cornerstones']) {
      const level = getLevel(id);
      const sim = new Sim({ level, seed: 1, policy: presetPolicy('balanced') });
      const cfg = sim.cfg;
      // Bursts are part of the rate, not a garnish on it.
      const burst =
        (cfg.burstMeanSeconds * cfg.burstMultiplier + cfg.calmMeanSeconds) /
        (cfg.burstMeanSeconds + cfg.calmMeanSeconds);
      const sum = sim.world.bricks.reduce((s, b) => s + b.arrivalRate, 0);
      expect(sum, `${id} importance does not account for all demand`).toBeCloseTo(
        level.demandRate * burst,
        6,
      );

      const doubled = new Sim({
        level,
        seed: 1,
        policy: presetPolicy('balanced'),
        configOverrides: { demandRateScale: 2 },
      });
      expect(doubled.world.bricks.reduce((s, b) => s + b.arrivalRate, 0)).toBeCloseTo(
        level.demandRate * burst * 2,
        6,
      );
    }
  });

  it('predicts the arrivals each brick actually receives', () => {
    // If the predicted rate and the simulated spawns ever drifted apart, every
    // score computed against importance would be measuring a model the game does
    // not run. Checked on a peaked level, where arc and traffic disagree most.
    const level = getLevel('bubble-trap');
    const counts = new Map<number, number>();
    let total = 0;
    let seconds = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const sim = new Sim({ level, seed, policy: presetPolicy('nearest'), stopOnDefeat: false }).run();
      seconds += sim.world.t;
      for (const e of spawns(sim)) {
        const wall = sim.world.wallsById[e.wall];
        const brick = sim.world.bricks[wall.grid[e.course][e.column]];
        counts.set(brick.id, (counts.get(brick.id) ?? 0) + 1);
        total++;
      }
    }
    expect(total).toBeGreaterThan(3000);

    const sim = new Sim({ level, seed: 1, policy: presetPolicy('nearest') });
    const ranked = sim.world.bricks
      .filter((b) => b.arrivalRate > 0)
      .sort((a, b) => b.arrivalRate - a.arrivalRate);

    // The busiest tenth by prediction really does take far more than the quietest.
    const n = Math.max(1, Math.floor(ranked.length / 10));
    const hottest = ranked.slice(0, n);
    const coldest = ranked.slice(-n);
    const share = (set: typeof ranked) =>
      set.reduce((s, b) => s + (counts.get(b.id) ?? 0), 0) / total;
    expect(share(hottest), 'predicted-hot bricks did not receive more raiders').toBeGreaterThan(
      share(coldest) * 3,
    );

    // And the totals agree: predicted arrivals/sec vs observed arrivals/sec.
    // Within a tolerance, because a run starts in a burst rather than in the
    // stationary state, so short sieges skew a few percent hot.
    const predicted = ranked.reduce((s, b) => s + b.arrivalRate, 0);
    const ratio = total / seconds / predicted;
    expect(ratio, `observed ${(total / seconds).toFixed(3)}/s vs predicted ${predicted.toFixed(3)}/s`).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.15);
  });

  it('finds the traffic on the NARROW bricks of The Bubble Trap', () => {
    // The level's whole claim, as a number: the busiest bricks are the small ones.
    const sim = new Sim({ level: getLevel('bubble-trap'), seed: 1, policy: presetPolicy('balanced') });
    const ranked = sim.world.bricks
      .filter((b) => b.arrivalRate > 0)
      .sort((a, b) => b.arrivalRate - a.arrivalRate);
    const topTen = ranked.slice(0, 10);
    const small = topTen.filter((b) => b.size === 'S').length;
    expect(small, 'the traffic should be piling onto narrow arcs').toBeGreaterThanOrEqual(7);
  });
});
