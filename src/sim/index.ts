/**
 * FRESHKEEP — what do you look at when there is more than you can watch?
 *
 * A deterministic simulation of finite attention against sources that go stale on
 * their own schedule. Walls are query result sets, bricks are pages, a brick's
 * arc around the ring is its share of the traffic, and raiders are queries
 * arriving from a distribution the player never sees. The player writes a policy;
 * masons execute it.
 *
 * The core is headless and free of any rendering concern, so the same code runs
 * the game, the CLI and the balance tooling. Determinism is load-bearing:
 * identical (level, seed, policy, masonCount) reproduces an identical event log,
 * which is what lets the thesis button compare two runs and mean it.
 */
export * from './types.js';
export * from './config.js';
export * from './rng.js';
export * from './events.js';
export * from './level.js';
export * from './levels.js';
export * from './basics.js';
export * from './sim.js';
export * from './report.js';
export * from './telemetry.js';
export * from './policy/ir.js';
export * from './policy/dsl.js';
export * from './policy/auction.js';
export * from './policy/presets.js';
export * from './policy/solutions.js';

import { Sim, type SimOptions } from './sim.js';
import { buildReport, type ReportCard } from './report.js';

/** Run a whole siege headless and hand back the report card. */
export function runSim(opts: SimOptions): { sim: Sim; report: ReportCard } {
  const sim = new Sim(opts).run();
  return { sim, report: buildReport(sim) };
}

/**
 * The thesis button: the same policy, the same seed, half the masons.
 * This comparison is the entire argument of the game.
 */
export function thesisCompare(
  opts: SimOptions,
  divisor = 2,
): { full: ReportCard; fewer: ReportCard; fullMasons: number; fewerMasons: number } {
  const fullMasons = opts.masonCount ?? opts.level.masons;
  const fewerMasons = Math.max(1, Math.floor(fullMasons / divisor));
  const full = runSim({ ...opts, masonCount: fullMasons }).report;
  const fewer = runSim({ ...opts, masonCount: fewerMasons }).report;
  return { full, fewer, fullMasons, fewerMasons };
}
