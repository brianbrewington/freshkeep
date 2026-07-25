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
