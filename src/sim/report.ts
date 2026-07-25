import type { Sim } from './sim.js';

export interface Utilization {
  idle: number;
  traveling: number;
  repairing: number;
  /** Subset of `repairing` spent on merely-weathered bricks. Wasted attention. */
  repairingWeathered: number;
}

export interface ReportCard {
  level: string;
  levelName: string;
  seed: number;
  policyName: string;
  policyKind: 'rulebook' | 'auction';
  masonsAtStart: number;
  masonsAtEnd: number;
  zones: boolean;
  durationSeconds: number;
  outcome: 'survived' | 'fallen';
  kingHp: number;
  kingHpMax: number;

  arrivals: number;
  repelled: number;
  /**
   * A breach = a raider walked through an unmaintained wall segment. It is counted
   * the moment the wall fails, whatever happens afterwards — the wall did not
   * answer the query. Of those, some are still turned back by the inner keep ring
   * and never touch the king.
   */
  breaches: number;
  stoppedAtKeep: number;
  reachedKing: number;
  breachesByWall: Record<string, number>;
  breachesByCourse: Record<string, number>;

  /**
   * Throughput-weighted staleness integrated over the run, normalized to
   * [0,1] — the smooth metric for comparing policies. Lower is better.
   */
  freshnessAge: number;
  /** Raw ∫ staleness dt, un-normalized. */
  freshnessAgeIntegral: number;

  utilization: Utilization;
  repairsCompleted: number;
  hubRepairs: number;
  /** Did you discover the shared structure? */
  hubRepairRatio: number;
  cosmeticRepairs: number;
  /** Share of all mason-seconds spent repairing cosmetics. */
  wastedAttention: number;

  roast: string;
  teaches: string;
}

export function buildReport(sim: Sim): ReportCard {
  const w = sim.world;
  const t = sim.totals;
  const masons = w.masons;
  const alive = masons.filter((m) => m.alive).length;

  let idle = 0;
  let traveling = 0;
  let repairing = 0;
  let cosmetic = 0;
  for (const m of masons) {
    idle += m.timeIdle;
    traveling += m.timeTraveling;
    repairing += m.timeRepairing;
    cosmetic += m.timeRepairingCosmetic;
  }
  const totalTime = idle + traveling + repairing || 1;

  const util: Utilization = {
    idle: idle / totalTime,
    traveling: traveling / totalTime,
    repairing: repairing / totalTime,
    repairingWeathered: cosmetic / totalTime,
  };

  const freshnessAge =
    t.freshnessAgeDenominator > 0 ? t.freshnessAgeIntegral / t.freshnessAgeDenominator : 0;

  const card: ReportCard = {
    level: sim.level.id,
    levelName: sim.level.name,
    seed: sim.seed,
    policyName: sim.policy.name,
    policyKind: sim.policy.kind,
    masonsAtStart: sim.masonCountAtStart,
    masonsAtEnd: alive,
    zones: sim.zonesEnabled,
    durationSeconds: Math.round(w.t * 100) / 100,
    outcome: sim.result ?? (w.king.hp > 0 ? 'survived' : 'fallen'),
    kingHp: Math.round(w.king.hp * 10) / 10,
    kingHpMax: w.king.maxHp,

    arrivals: t.arrivals,
    repelled: t.repelled,
    breaches: t.breaches,
    stoppedAtKeep: t.stoppedAtKeep,
    reachedKing: t.reachedKing,
    breachesByWall: { ...t.breachesByWall },
    breachesByCourse: { ...t.breachesByCourse },

    freshnessAge: Math.round(freshnessAge * 10000) / 10000,
    freshnessAgeIntegral: Math.round(t.freshnessAgeIntegral * 100) / 100,

    utilization: util,
    repairsCompleted: t.repairsCompleted,
    hubRepairs: t.hubRepairs,
    hubRepairRatio: t.repairsCompleted > 0 ? t.hubRepairs / t.repairsCompleted : 0,
    cosmeticRepairs: t.cosmeticRepairs,
    wastedAttention: util.repairingWeathered,

    roast: '',
    teaches: sim.level.teaches,
  };

  card.roast = roast(sim, card);
  return card;
}

const WALL_NAMES: Record<string, string> = {};

function wallLabel(sim: Sim, id: string): string {
  if (!WALL_NAMES[id]) {
    const w = sim.world.wallsById[id];
    WALL_NAMES[id] = w ? w.name : id;
  }
  return WALL_NAMES[id];
}

/** One line, generated from the dominant failure. Losing should be funny. */
function roast(sim: Sim, c: ReportCard): string {
  const worstWall = Object.entries(c.breachesByWall).sort((a, b) => b[1] - a[1])[0];
  const worstName = worstWall ? wallLabel(sim, worstWall[0]) : 'the perimeter';
  const hubsExist = sim.world.bricks.some((b) => b.hub);

  if (c.outcome === 'fallen') {
    if (c.wastedAttention > 0.2) {
      return `Your masons lovingly restored ${c.cosmeticRepairs} cosmetic cracks while ${worstName} fell.`;
    }
    if (c.zones && c.utilization.idle > 0.25) {
      return `${Math.round(c.utilization.idle * 100)}% of your mason-hours were spent standing in a quiet zone, listening to ${worstName} come down.`;
    }
    if (c.utilization.traveling > 0.45) {
      return `Your masons spent ${Math.round(c.utilization.traveling * 100)}% of the siege walking. Beautiful commute. ${worstName} is gone.`;
    }
    if (hubsExist && c.hubRepairRatio < 0.08) {
      return `You repaired ${c.repairsCompleted} bricks and ${c.hubRepairs} cornerstones. The corners were holding two walls each. They are not holding them now.`;
    }
    if (c.utilization.idle > 0.4) {
      return `Your masons waited for a real emergency. It arrived at ${worstName}, all at once, and they were too far away.`;
    }
    return `The king has fallen. ${c.breaches} raiders walked through ${worstName} and helped themselves.`;
  }

  // Survived — still deadpan about how.
  if (c.wastedAttention > 0.2) {
    return `You held — but ${Math.round(c.wastedAttention * 100)}% of your masonry was cosmetic. The wall was never in danger from those cracks.`;
  }
  if (c.utilization.idle > 0.45) {
    return `You held comfortably with ${Math.round(c.utilization.idle * 100)}% of your masons idle. Try the thesis button before you conclude the policy was good.`;
  }
  if (c.kingHp < c.kingHpMax * 0.4) {
    return `The king survived on ${Math.round(c.kingHp)} HP. Nobody is calling that a strategy.`;
  }
  return `Held. ${c.repelled} raiders left empty-handed, ${c.breaches} did not.`;
}

/** Human-readable report card for the CLI. */
export function formatReport(c: ReportCard): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `FRESHKEEP — ${c.levelName} (${c.level})`,
    `  policy      ${c.policyName} [${c.policyKind}]${c.zones ? ' · ZONES' : ''}`,
    `  seed        ${c.seed}   masons ${c.masonsAtStart}${c.masonsAtEnd !== c.masonsAtStart ? ` → ${c.masonsAtEnd}` : ''}`,
    ``,
    `  OUTCOME     ${c.outcome.toUpperCase()}   king ${c.kingHp}/${c.kingHpMax} after ${c.durationSeconds}s`,
    `  breaches    ${c.breaches} of ${c.arrivals} arrivals (${pct(c.arrivals ? c.breaches / c.arrivals : 0)})`,
    `              ${c.reachedKing} reached the king · ${c.stoppedAtKeep} stopped by the keep ring`,
    `    by wall   ${fmtCounts(c.breachesByWall)}`,
    `    by course ${fmtCounts(c.breachesByCourse)}`,
    `  freshness-age ${c.freshnessAge.toFixed(4)}  (throughput-weighted staleness, lower is better)`,
    ``,
    `  mason time  idle ${pct(c.utilization.idle)} · traveling ${pct(c.utilization.traveling)} · repairing ${pct(c.utilization.repairing)}`,
    `              of which WASTED on weathered: ${pct(c.utilization.repairingWeathered)}`,
    `  repairs     ${c.repairsCompleted} total · ${c.hubRepairs} hubs (ratio ${c.hubRepairRatio.toFixed(3)}) · ${c.cosmeticRepairs} cosmetic`,
    ``,
    `  "${c.roast}"`,
    `  teaches: ${c.teaches}`,
  ];
  return lines.join('\n');
}

function fmtCounts(rec: Record<string, number>): string {
  const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(' ') : '—';
}
