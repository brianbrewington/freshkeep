#!/usr/bin/env tsx
/**
 * Headless runner: JSON/DSL policy in, report card out.
 * This alone is scientifically useful — it is the experiment platform.
 *
 *   npm run sim -- --level 3 --preset balanced --masons 16 --seed 7
 *   npm run sim -- --level seam --preset balanced --no-zones
 *   npm run sim -- --level 3 --preset balanced --thesis
 *   npm run sim -- --level 2 --policy ./my.rulebook --json > run.json
 *   npm run sim -- --level 3 --sweep
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  PRESETS,
  buildReport,
  buildTelemetry,
  compileAuction,
  compileRulebook,
  formatReport,
  getLevel,
  presetPolicy,
  runSim,
  solutionPolicy,
  SOLUTIONS,
  thesisCompare,
  serializeEvents,
  LEVELS,
  DEFAULT_WEIGHTS,
  type Policy,
} from '../sim/index.js';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`FRESHKEEP headless sim

  --level <id|1-6>     level to run (default 1). ${LEVELS.map((l, i) => `${i + 1}=${l.id}`).join(' ')}
  --preset <id>        ${PRESETS.map((p) => p.id).join(' | ')}
  --solution <id>      worked solutions: ${SOLUTIONS.map((s) => s.id).join(' | ')}
  --policy <file>      a .rulebook file (DSL) or .json of auction weights
  --auction <json>     inline auction weights, e.g. '{"hub":2}'
  --masons <n>         override mason count — the one dial that matters
  --seed <n>           default 1
  --zones / --no-zones force zone mode on or off
  --duration <sec>     override level duration
  --thesis             run again with half the masons and compare
  --sweep              run every preset at the level's default mason count
  --json               emit telemetry JSON instead of the text report card
  --events             include the full event log in --json output
  --out <file>         write the JSON somewhere
`);
  process.exit(0);
}

const level = getLevel((args.level as string) ?? 1);
const seed = Number(args.seed ?? 1);
const masonCount = args.masons !== undefined ? Number(args.masons) : undefined;
const zones = args.zones === true ? true : args['no-zones'] === true ? false : undefined;
const configOverrides = args.duration ? {} : undefined;
const levelSpec = args.duration
  ? { ...level, durationSeconds: Number(args.duration) }
  : level;

function loadPolicy(): Policy {
  if (args.auction) {
    const w = JSON.parse(args.auction === true ? '{}' : (args.auction as string));
    return compileAuction({ ...DEFAULT_WEIGHTS, ...w }, 'auction');
  }
  if (args.solution) {
    return solutionPolicy(args.solution as string);
  }
  if (args.policy) {
    const path = args.policy as string;
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('.json')) {
      return compileAuction({ ...DEFAULT_WEIGHTS, ...JSON.parse(text) }, `auction:${path}`);
    }
    return compileRulebook(text, path);
  }
  return presetPolicy((args.preset as string) ?? 'balanced');
}

if (args.sweep) {
  console.log(`Sweep — ${levelSpec.name} (${levelSpec.id}), seed ${seed}, ${masonCount ?? levelSpec.masons} masons\n`);
  const rows: string[][] = [['preset', 'outcome', 'hp', 'breach', 'fresh', 'idle%', 'wasted%', 'hubRatio']];
  for (const p of PRESETS) {
    const { report } = runSim({
      level: levelSpec,
      seed,
      policy: presetPolicy(p.id),
      masonCount,
      zones,
      configOverrides,
    });
    rows.push([
      p.name,
      report.outcome,
      `${report.kingHp}`,
      `${report.breaches}`,
      report.freshnessAge.toFixed(3),
      (report.utilization.idle * 100).toFixed(0),
      (report.utilization.repairingWeathered * 100).toFixed(0),
      report.hubRepairRatio.toFixed(3),
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
  process.exit(0);
}

const policy = loadPolicy();

if (args.thesis) {
  const cmp = thesisCompare({ level: levelSpec, seed, policy, masonCount, zones, configOverrides });
  console.log(formatReport(cmp.full));
  console.log('\n' + '-'.repeat(60) + '\n');
  console.log(`RUN THIS EXACT POLICY AGAIN WITH FEWER MASONS — ${cmp.fullMasons} → ${cmp.fewerMasons}\n`);
  console.log(formatReport(cmp.fewer));
  console.log(
    `\n  ${cmp.full.outcome.toUpperCase()} at ${cmp.fullMasons} masons, ` +
      `${cmp.fewer.outcome.toUpperCase()} at ${cmp.fewerMasons}. ` +
      `Freshness-age ${cmp.full.freshnessAge.toFixed(3)} → ${cmp.fewer.freshnessAge.toFixed(3)}.`,
  );
  process.exit(0);
}

const { sim, report } = runSim({ level: levelSpec, seed, policy, masonCount, zones, configOverrides });

if (args.json || args.out) {
  const telemetry = buildTelemetry(sim, buildReport(sim), {
    recordedAt: new Date().toISOString(),
    includeEvents: args.events === true,
  });
  const text = JSON.stringify(telemetry, null, 2);
  if (args.out) {
    writeFileSync(args.out as string, text);
    console.error(`wrote ${args.out}`);
  } else {
    console.log(text);
  }
} else {
  console.log(formatReport(report));
  if (args.events) {
    console.log('\n--- event log ---');
    console.log(serializeEvents(sim.events));
  }
}
