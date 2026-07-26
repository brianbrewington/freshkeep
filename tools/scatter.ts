#!/usr/bin/env tsx
/**
 * Renders the allocation scatter for a level across several crew sizes and writes
 * a standalone HTML file — the bandwidth sweep as a static artifact, openable in
 * any browser with no dev server and no extension.
 *
 *   npx tsx tools/scatter.ts                       cornerstones, balanced, 16/8/4
 *   npx tsx tools/scatter.ts bubble-trap balanced 13,8,5
 *   npx tsx tools/scatter.ts cornerstones the-line 16,8,4 out.html
 *
 * The shape to look for is the ignored set — the hollow rings — growing out of
 * the top-left as the crew shrinks: fast-changing bricks that nobody asks for.
 */
import { writeFileSync } from 'node:fs';
import { getLevel, presetPolicy, runSim, solutionPolicy, type ReportCard } from '../src/sim/index.js';
import { allocationScatter } from '../src/ui/scatter.js';

const [levelId = 'cornerstones', policyId = 'balanced', countsArg = '16,8,4', outArg] = process.argv.slice(2);
const out = outArg ?? `scatter-${levelId}-${policyId}.html`;
const counts = countsArg.split(',').map(Number);
const level = getLevel(levelId);
const policy = policyId.includes('-') ? solutionPolicy(policyId) : presetPolicy(policyId);

function summarise(c: ReportCard) {
  const max = Math.max(...c.allocation.map((p) => p.seconds), 1e-9);
  const ignored = c.allocation.filter((p) => p.seconds / max < 0.02);
  const traffic = c.allocation.reduce((s, p) => s + p.arrivalRate, 0) || 1;
  const meanChange = (set: typeof c.allocation) =>
    set.length ? set.reduce((s, p) => s + 1 / p.changeRate, 0) / set.length : NaN;
  return {
    ignored: ignored.length,
    of: c.allocation.length,
    ignoredTraffic: (ignored.reduce((s, p) => s + p.arrivalRate, 0) / traffic) * 100,
    ignoredMct: meanChange(ignored),
    tendedMct: meanChange(c.allocation.filter((p) => p.seconds / max >= 0.02)),
  };
}

const panels = counts
  .map((masonCount) => {
    const { report } = runSim({ level, seed: 1, policy, masonCount });
    const s = summarise(report);
    return `<figure>
      <figcaption>${masonCount} masons — ${report.outcome === 'survived' ? 'held' : 'fell'}, king ${report.kingHp}/${report.kingHpMax}</figcaption>
      ${allocationScatter(report)}
      <p class="stat">${s.ignored}/${s.of} bricks ignored, carrying ${s.ignoredTraffic.toFixed(0)}% of the traffic.<br/>
      ignored mean change time <b>${s.ignoredMct.toFixed(0)}s</b> vs tended <b>${s.tendedMct.toFixed(0)}s</b></p>
    </figure>`;
  })
  .join('\n');

writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>FRESHKEEP — allocation, ${level.name}</title>
<style>
  :root { --panel:#191510; --panel-2:#221c15; --line:#33291e; --dim:#8d8069; }
  body { background:#100e0a; color:#ded3bd; font:14px/1.5 system-ui,sans-serif; margin:0; padding:28px; }
  h1 { font:700 17px/1.2 ui-monospace,monospace; letter-spacing:.12em; color:#e8a33d; margin:0 0 4px; }
  p.sub { color:var(--dim); margin:0 0 22px; max-width:60ch; }
  .row { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start; }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:5px; padding:14px; width:340px; }
  figcaption { font:12px/1.4 ui-monospace,monospace; color:#e8a33d; margin-bottom:8px; }
  .scatter { width:100%; height:auto; display:block; background:var(--panel-2); border:1px solid var(--line); border-radius:3px; }
  .bars .cap { font:10px/1.3 ui-monospace,monospace; text-transform:uppercase; letter-spacing:.1em; color:var(--dim); margin-bottom:4px; }
  .bars .note, .stat { font-size:11px; color:var(--dim); }
</style>
<h1>WHERE THE MASONRY WENT — ${level.name}</h1>
<p class="sub">Policy: <b>${policy.name}</b>, seed 1. Mean change time across, mean time between arrivals up.
Filled circles are bricks that got attention; hollow rings are the ignored set. Watch it grow as the crew shrinks.</p>
<div class="row">${panels}</div>`,
);
console.log(`wrote ${out}`);
