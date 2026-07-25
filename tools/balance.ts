#!/usr/bin/env tsx
/**
 * Balance harness. Levels are tuned against the simulation, not against
 * intuition, and every rebalance so far has needed the same three sweeps — so
 * they live here rather than being re-derived by hand each time.
 *
 *   npx tsx tools/balance.ts matrix                    every policy x every level
 *   npx tsx tools/balance.ts matrix cornerstones,seam  named levels only
 *   npx tsx tools/balance.ts dial cornerstones balanced 24,16,12,8,4
 *   npx tsx tools/balance.ts knee cornerstones balanced decayMedian 0.02,0.045,6
 *   npx tsx tools/balance.ts seam                      zoned vs shared-pool A/B
 *
 * `knee` is the one that matters most: it finds the config value where a policy
 * still holds at full crew and reliably falls at half, which is what makes the
 * thesis button an argument instead of an assertion.
 */
import {
  ALL_LEVELS,
  LEVELS,
  PRESETS,
  SOLUTIONS,
  getLevel,
  presetPolicy,
  runSim,
  solutionPolicy,
  type Config,
  type LevelSpec,
  type Policy,
} from '../src/sim/index.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

interface Entry {
  label: string;
  policy: Policy;
}

function allPolicies(levelId?: string): Entry[] {
  const out: Entry[] = PRESETS.map((p) => ({ label: p.name, policy: presetPolicy(p.id) }));
  for (const s of SOLUTIONS) {
    if (!levelId || s.level === levelId) out.push({ label: s.name, policy: solutionPolicy(s.id) });
  }
  return out;
}

function winRate(
  level: LevelSpec,
  policy: Policy,
  masonCount?: number,
  over?: Partial<Config>,
  zones?: boolean,
): { wins: number; hp: number; breaches: number; fresh: number; idle: number; wasted: number; hub: number } {
  let wins = 0;
  let hp = 0;
  let breaches = 0;
  let fresh = 0;
  let idle = 0;
  let wasted = 0;
  let hub = 0;
  for (const seed of SEEDS) {
    const { report } = runSim({ level, seed, policy, masonCount, configOverrides: over, zones });
    if (report.outcome === 'survived') wins++;
    hp += report.kingHp;
    breaches += report.breaches;
    fresh += report.freshnessAge;
    idle += report.utilization.idle;
    wasted += report.utilization.repairingWeathered;
    hub += report.hubRepairRatio;
  }
  const n = SEEDS.length;
  return { wins, hp: hp / n, breaches: breaches / n, fresh: fresh / n, idle: idle / n, wasted: wasted / n, hub: hub / n };
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'matrix') {
  const ids = rest[0] ? rest[0].split(',') : LEVELS.map((l) => l.id);
  for (const id of ids) {
    const level = getLevel(id);
    console.log(`\n=== ${level.name} (${level.id})  masons=${level.masons}  ${level.durationSeconds}s`);
    for (const { label, policy } of allPolicies(level.id)) {
      const r = winRate(level, policy);
      console.log(
        `  ${label.padEnd(18)} win ${String(r.wins).padStart(2)}/${SEEDS.length}` +
          `  hp ${r.hp.toFixed(0).padStart(4)}  breach ${r.breaches.toFixed(1).padStart(5)}` +
          `  fresh ${r.fresh.toFixed(3)}  idle ${(r.idle * 100).toFixed(0).padStart(3)}%` +
          `  wasted ${(r.wasted * 100).toFixed(0).padStart(3)}%  hubR ${r.hub.toFixed(3)}`,
      );
    }
  }
} else if (cmd === 'dial') {
  // The one dial that matters: hold the policy fixed, vary the crew.
  const level = getLevel(rest[0]);
  const policy = rest[1].includes('-') ? solutionPolicy(rest[1]) : presetPolicy(rest[1]);
  const counts = (rest[2] ?? '24,16,12,8,4').split(',').map(Number);
  console.log(`${level.name} — ${rest[1]} across crew sizes\n`);
  for (const m of counts) {
    const r = winRate(level, policy, m);
    console.log(
      `  ${String(m).padStart(3)} masons  win ${r.wins}/${SEEDS.length}  hp ${r.hp.toFixed(0).padStart(4)}` +
        `  breach ${r.breaches.toFixed(1).padStart(5)}  fresh ${r.fresh.toFixed(3)}  idle ${(r.idle * 100).toFixed(0)}%`,
    );
  }
} else if (cmd === 'knee') {
  // Find the config value where full crew holds and half crew falls.
  const level = getLevel(rest[0]);
  const policy = rest[1].includes('-') ? solutionPolicy(rest[1]) : presetPolicy(rest[1]);
  const key = rest[2] as keyof Config;
  const [lo, hi, steps] = (rest[3] ?? '0.02,0.05,6').split(',').map(Number);
  const full = level.masons;
  const half = Math.max(1, Math.floor(full / 2));
  console.log(`${level.name} — knee in ${String(key)}; want ${full} to hold and ${half} to fall\n`);
  for (let i = 0; i < steps; i++) {
    const v = lo + ((hi - lo) * i) / Math.max(1, steps - 1);
    const over = { [key]: v } as unknown as Partial<Config>;
    const a = winRate(level, policy, full, over);
    const b = winRate(level, policy, half, over);
    const q = winRate(level, policy, Math.max(1, Math.floor(full / 4)), over);
    const verdict = a.wins === SEEDS.length && b.wins === 0 ? '  <== KNEE' : '';
    console.log(
      `  ${String(key)}=${v.toFixed(4)}  @${full} ${a.wins}/${SEEDS.length}` +
        `  @${half} ${b.wins}/${SEEDS.length}  @${Math.max(1, Math.floor(full / 4))} ${q.wins}/${SEEDS.length}${verdict}`,
    );
  }
} else if (cmd === 'seam') {
  const level = getLevel('seam');
  console.log('The Seam — zone-locked crews vs one shared pool, identical siege\n');
  for (const { label, policy } of allPolicies('seam')) {
    const z = winRate(level, policy, undefined, undefined, true);
    const p = winRate(level, policy, undefined, undefined, false);
    console.log(
      `  ${label.padEnd(18)} zoned hp ${z.hp.toFixed(0).padStart(3)} br ${z.breaches.toFixed(1).padStart(5)} idle ${(z.idle * 100).toFixed(0).padStart(2)}%` +
        `  |  pooled hp ${p.hp.toFixed(0).padStart(3)} br ${p.breaches.toFixed(1).padStart(5)} idle ${(p.idle * 100).toFixed(0).padStart(2)}%`,
    );
  }
} else {
  console.log(`levels: ${ALL_LEVELS.map((l) => l.id).join(', ')}`);
  console.log('commands: matrix [ids] | dial <level> <policy> [counts] | knee <level> <policy> <key> <lo,hi,steps> | seam');
}
