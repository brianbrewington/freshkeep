import { describe, expect, it } from 'vitest';
import {
  DAMAGE_THRESHOLDS,
  LEVELS,
  PRESETS,
  SOLUTIONS,
  Sim,
  damageState,
  getLevel,
  passProbability,
  presetPolicy,
  runSim,
  solutionPolicy,
  thesisCompare,
} from '../src/sim/index.js';

/**
 * The acceptance criteria that encode the thesis. Do not ship without these.
 * Every claim the game makes about policy vs. slack is asserted here against
 * the simulation, not against intuition.
 */

const SEEDS = [1, 2, 3, 4, 5];

function runPreset(levelId: string, presetId: string, masonCount?: number, zones?: boolean, seed = 1) {
  return runSim({ level: getLevel(levelId), seed, policy: presetPolicy(presetId), masonCount, zones }).report;
}

describe('acceptance — every preset loses somewhere, and none sweeps the game', () => {
  // A single seed is a single draw. "Preset X beats level Y" is a claim about the
  // level, so it is judged on a majority of seeds rather than one lucky siege.
  const JUDGE_SEEDS = [1, 2, 3];
  const beats = new Map<string, boolean[]>();
  for (const p of PRESETS) {
    beats.set(
      p.id,
      LEVELS.map((l) => {
        const wins = JUDGE_SEEDS.filter(
          (s) => runPreset(l.id, p.id, undefined, undefined, s).outcome === 'survived',
        ).length;
        return wins * 2 > JUDGE_SEEDS.length;
      }),
    );
  }

  it('every preset rulebook loses at least one shipped level', () => {
    for (const p of PRESETS) {
      const losses = beats.get(p.id)!.filter((won) => !won).length;
      expect(losses, `${p.name} never loses — it does not demonstrate its pathology`).toBeGreaterThan(0);
    }
  });

  it('no single preset wins all six levels', () => {
    for (const p of PRESETS) {
      const wins = beats.get(p.id)!.filter(Boolean).length;
      expect(wins, `${p.name} sweeps the game`).toBeLessThan(LEVELS.length);
    }
  });

  it('every shipped level is held by at least one shipped policy', () => {
    // Presets OR worked solutions. A level nobody can hold is a wall, not a lesson.
    LEVELS.forEach((level, i) => {
      const presetWinners = PRESETS.filter((p) => beats.get(p.id)![i]).length;
      if (presetWinners > 0) return;
      const solution = SOLUTIONS.find((s) => s.level === level.id);
      expect(solution, `${level.name} has neither a winning preset nor a worked solution`).toBeTruthy();
      const wins = JUDGE_SEEDS.filter(
        (s) =>
          runSim({ level, seed: s, policy: solutionPolicy(solution!.id) }).report.outcome === 'survived',
      ).length;
      expect(wins * 2, `${level.name}: solution ${solution!.name} does not hold it`).toBeGreaterThan(
        JUDGE_SEEDS.length,
      );
    });
  });

  it('The Culling rewards triage above every preset — you have to write it yourself', () => {
    // Stated as a ranking rather than a pass/fail on one seed: the claim is that
    // abandoning the perimeter is the OPTIMUM under scarcity, so the triage policy
    // must out-survive every preset, not merely squeak past a threshold.
    const level = getLevel('culling');
    const rate = (policy: ReturnType<typeof presetPolicy>) =>
      SEEDS.filter((s) => runSim({ level, seed: s, policy }).report.outcome === 'survived').length;

    const triage = rate(solutionPolicy('hold-the-keep'));
    for (const p of PRESETS) {
      expect(triage, `HOLD THE KEEP (${triage}/${SEEDS.length}) must beat ${p.name}`).toBeGreaterThan(
        rate(presetPolicy(p.id)),
      );
    }
    expect(triage * 2, 'triage should hold The Culling more often than not').toBeGreaterThan(SEEDS.length);
  });

  it('the pathology presets lose the levels named after their pathology', () => {
    const idx = (id: string) => LEVELS.findIndex((l) => l.id === id);
    // The Bubble Trap breaks size-greed and decay-greed, by construction.
    expect(beats.get('biggest')![idx('bubble-trap')], 'BIGGEST FIRST survives The Bubble Trap').toBe(false);
    expect(beats.get('twitchiest')![idx('bubble-trap')], 'TWITCHIEST FIRST survives The Bubble Trap').toBe(false);
    // The Culling breaks anything that will not abandon the perimeter.
    expect(beats.get('balanced')![idx('culling')], 'BALANCED survives The Culling').toBe(false);
  });
});

describe('acceptance — the thesis button (Cornerstones)', () => {
  it('BALANCED with 16 masons wins; the identical policy with 4 masons loses', () => {
    for (const seed of SEEDS) {
      expect(runPreset('cornerstones', 'balanced', 16, undefined, seed).outcome, `seed ${seed}`).toBe('survived');
      expect(runPreset('cornerstones', 'balanced', 4, undefined, seed).outcome, `seed ${seed}`).toBe('fallen');
    }
  });

  it('halving the masons flips the outcome — same policy, same seed, same siege', () => {
    for (const seed of SEEDS) {
      const cmp = thesisCompare({
        level: getLevel('cornerstones'),
        seed,
        policy: presetPolicy('balanced'),
        masonCount: 16,
      });
      expect(cmp.fullMasons).toBe(16);
      expect(cmp.fewerMasons).toBe(8);
      expect(cmp.full.outcome, `seed ${seed} at 16`).toBe('survived');
      expect(cmp.fewer.outcome, `seed ${seed} at 8`).toBe('fallen');
      // Staleness must move the right way too, not just the win/lose bit.
      expect(cmp.fewer.freshnessAge).toBeGreaterThan(cmp.full.freshnessAge);
    }
  });

  it('runs the identical siege at both mason counts, so the comparison is fair', () => {
    // Demand is drawn from its own RNG stream, so the arrival sequence cannot
    // depend on the policy or the crew size. Both runs are played to the final
    // whistle rather than stopping at defeat, otherwise the loser simply sees
    // fewer raiders because its run ended sooner.
    const opts = { level: getLevel('cornerstones'), seed: 1, policy: presetPolicy('balanced'), stopOnDefeat: false };
    const a = runSim({ ...opts, masonCount: 16 }).report;
    const b = runSim({ ...opts, masonCount: 4 }).report;
    expect(a.arrivals).toBe(b.arrivals);
  });
});

describe('acceptance — hub-repair ratio is the "did you find the shared structure" metric', () => {
  it('is computed and displayed, and winning runs beat losing runs on Cornerstones', () => {
    // Judged across seeds, not one siege: a single draw was never evidence of a
    // difference in means, however convenient the number looked.
    const cards = PRESETS.flatMap((p) =>
      SEEDS.map((seed) => ({ preset: p, card: runPreset('cornerstones', p.id, undefined, undefined, seed) })),
    );
    const won = cards.filter((c) => c.card.outcome === 'survived');
    const lost = cards.filter((c) => c.card.outcome === 'fallen');
    expect(won.length).toBeGreaterThan(0);
    expect(lost.length).toBeGreaterThan(0);

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const wonRatio = mean(won.map((c) => c.card.hubRepairRatio));
    const lostRatio = mean(lost.map((c) => c.card.hubRepairRatio));
    expect(wonRatio, `winners ${wonRatio} vs losers ${lostRatio}`).toBeGreaterThan(lostRatio);
    // And the metric is actually populated, not silently zero for everyone.
    expect(Math.max(...won.map((c) => c.card.hubRepairRatio))).toBeGreaterThan(0);
  });
});

describe('acceptance — The Seam: a shared pool strictly dominates forced zones', () => {
  it('beats the zoned run on king HP and breaches for the same policy and seed', () => {
    for (const seed of SEEDS) {
      const zoned = runPreset('seam', 'balanced', undefined, true, seed);
      const pooled = runPreset('seam', 'balanced', undefined, false, seed);
      expect(pooled.kingHp, `seed ${seed} HP`).toBeGreaterThanOrEqual(zoned.kingHp);
      expect(pooled.breaches, `seed ${seed} breaches`).toBeLessThanOrEqual(zoned.breaches);
      expect(zoned.zones).toBe(true);
      expect(pooled.zones).toBe(false);
    }
  });

  it('and yet the zoned run can post a BETTER average freshness while losing', () => {
    // Not a bug — the whole point. Zone-locked crews on a quiet wall polish bricks
    // nobody queries, which lifts the global average while the busy wall comes
    // down. An average over the wrong denominator flatters a bad allocation.
    const flattered = SEEDS.filter((seed) => {
      const zoned = runPreset('seam', 'balanced', undefined, true, seed);
      const pooled = runPreset('seam', 'balanced', undefined, false, seed);
      return zoned.freshnessAge < pooled.freshnessAge && zoned.kingHp <= pooled.kingHp;
    });
    expect(flattered.length, 'expected at least one seed where the metric lies').toBeGreaterThan(0);
  });

  it('shows the pathology in the numbers: zone-locked masons idle while a neighbour burns', () => {
    const zoned = runPreset('seam', 'balanced', undefined, true);
    const pooled = runPreset('seam', 'balanced', undefined, false);
    expect(zoned.utilization.idle).toBeGreaterThan(pooled.utilization.idle);
    // The delta the player is shown after the A/B replay.
    expect(zoned.breaches - pooled.breaches).toBeGreaterThan(0);
  });
});

describe('acceptance — wasted attention', () => {
  it('tracks repairing merely-weathered bricks as wasted, and NEAREST FIRST is full of it', () => {
    const nearest = runPreset('cornerstones', 'nearest');
    const firefighter = runPreset('cornerstones', 'firefighter');
    // A policy that only touches structural damage wastes none of it...
    expect(firefighter.utilization.repairingWeathered).toBeLessThan(0.02);
    // ...while a sweeper pours a large share of its masonry into cosmetics.
    expect(nearest.utilization.repairingWeathered).toBeGreaterThan(0.3);
    expect(nearest.cosmeticRepairs).toBeGreaterThan(firefighter.cosmeticRepairs * 5);
  });

  it('never counts wasted time outside of repairing time', () => {
    for (const p of PRESETS) {
      const c = runPreset('cornerstones', p.id);
      expect(c.utilization.repairingWeathered).toBeLessThanOrEqual(c.utilization.repairing + 1e-9);
      const sum = c.utilization.idle + c.utilization.traveling + c.utilization.repairing;
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});

describe('acceptance — weathered damage is cosmetic, and the target set is redundant', () => {
  it('gives a raider zero chance of passing an intact or weathered brick', () => {
    expect(passProbability(1)).toBe(0);
    expect(passProbability(DAMAGE_THRESHOLDS.intact)).toBe(0);
    expect(passProbability(DAMAGE_THRESHOLDS.weathered)).toBe(0);
    // Below the cracked threshold it rises to certainty at rubble.
    expect(passProbability(0.2)).toBeGreaterThan(0);
    expect(passProbability(0.2)).toBeLessThan(1);
    expect(passProbability(0)).toBe(1);
    expect(damageState(0.5)).toBe('weathered');
    expect(damageState(0.2)).toBe('cracked');
    expect(damageState(0)).toBe('rubble');
  });

  it('records no breach on a wall while any brick in the target set is above cracked', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 2, policy: presetPolicy('twitchiest') });
    // Watch every tick: at the instant of each breach, the whole target set
    // must have been below the cracked threshold.
    let breachesSeen = 0;
    let lastChecked = 0;
    while (!sim.done) {
      sim.step();
      for (let i = lastChecked; i < sim.events.length; i++) {
        const e = sim.events[i];
        if (e.type !== 'breach') continue;
        breachesSeen++;
        const set = sim.targetSet(e.wall, e.course, e.column);
        for (const b of set) {
          expect(b.integrity, `brick ${b.id} let a raider through at ${e.t}s`).toBeLessThan(
            DAMAGE_THRESHOLDS.weathered,
          );
        }
      }
      lastChecked = sim.events.length;
    }
    expect(breachesSeen).toBeGreaterThan(0);
  });
});
