import type { LevelSpec, WallSpec } from './level.js';

const GATE_NAMES: Record<string, string> = {
  N: 'the north gate',
  E: 'the east gate',
  S: 'the south gate',
  W: 'the west gate',
};

function wall(side: 'N' | 'E' | 'S' | 'W', columns: number, spares: number, demandShare = 1): WallSpec {
  return { id: side, name: GATE_NAMES[side], side, columns, spares, demandShare };
}

const FOUR = (columns: number, spares: number, shares: [number, number, number, number] = [1, 1, 1, 1]) => [
  wall('N', columns, spares, shares[0]),
  wall('E', columns, spares, shares[1]),
  wall('S', columns, spares, shares[2]),
  wall('W', columns, spares, shares[3]),
];

export const LEVELS: LevelSpec[] = [
  // 1 ---------------------------------------------------------------------
  {
    id: 'tutorial',
    name: 'One Wall',
    blurb:
      'One wall, plenty of masons, nothing clever required. Write a policy, watch it run, read the report card.',
    teaches: 'The loop: write policy → watch → read report card. You never click a brick.',
    durationSeconds: 150,
    kingHp: 60,
    // Deliberately generous. The tutorial has slack, so almost any policy holds —
    // which is the thesis stated before it is argued: sloppy policies win when
    // masons are plentiful. Every later level takes the slack away.
    masons: 9,
    courses: 2,
    walls: [wall('N', 10, 1)],
    demandRate: 0.5,
    hubsPerCorner: 0,
    keepBricks: 10,
    sizeMix: { S: 1, M: 2, L: 1 },
    modes: ['rulebook'],
  },

  // 2 ---------------------------------------------------------------------
  {
    id: 'bubble-trap',
    name: 'The Bubble Trap',
    blurb:
      'Bricks of wildly different sizes and decay rates. The big, twitchy ones are the ones you notice.',
    teaches:
      'Currency ≠ value. Size is what you can see; traffic is what actually arrives. They are not the same signal.',
    durationSeconds: 210,
    kingHp: 110,
    masons: 13,
    courses: 3,
    // ONE spare, not two. Redundancy rewards uniform sweeping: when a raider only
    // gets through if the whole target set has crumbled, spreading effort evenly is
    // near-optimal and there is nothing for a value-aware policy to beat. With a
    // single spare a raider's fate turns on the specific brick it aimed at, so which
    // bricks you keep fresh maps directly onto which queries get answered.
    walls: FOUR(11, 1),
    demandRate: 0.85,
    hubsPerCorner: 0,
    keepBricks: 12,
    sizeMix: { S: 3, M: 2, L: 2 },
    // Wildly varying decay — the "twitchiest" bricks are mostly the big ones,
    // and the traffic is not there.
    decayRateFor: (b, rng) =>
      b.size === 'L' ? rng.logNormal(0.05, 0.5) : rng.logNormal(0.014, 0.7),
    // The hidden truth: demand concentrates on SMALL, SLOW-decaying, top-course bricks.
    demandWeightFor: (b) => {
      const bySize = b.size === 'S' ? 9 : b.size === 'M' ? 2 : 0.4;
      const bySpeed = b.decayRate < 0.02 ? 3 : 0.6;
      const byCourse = b.course === 0 ? 1 : 0.5;
      return bySize * bySpeed * byCourse;
    },
    modes: ['rulebook'],
  },

  // 3 ---------------------------------------------------------------------
  {
    id: 'cornerstones',
    name: 'Cornerstones',
    blurb:
      'Hub bricks sit where two walls meet. Repair one and you have defended both — if you notice they exist.',
    teaches:
      'Shared masonry. Some value is non-separable: the cornerstone belongs to two walls and to neither budget.',
    durationSeconds: 210,
    kingHp: 100,
    masons: 16,
    courses: 3,
    walls: FOUR(12, 2),
    demandRate: 1.15,
    hubsPerCorner: 3,
    keepBricks: 16,
    sizeMix: { S: 2, M: 3, L: 2 },
    // Cornerstones crumble FAST. Hubs have to be structurally decisive, not merely
    // present: if they decayed like everything else, a policy could ignore them and
    // still win, and the level would teach nothing about shared masonry.
    decayRateFor: (b, rng) => (b.hub ? rng.logNormal(0.05, 0.3) : rng.logNormal(0.033, 0.85)),
    // This level is where the thesis button is argued, so it is tuned to sit
    // exactly on the knee: 16 masons holds on every seed, 8 falls on every seed.
    // One click, same policy, same siege, opposite outcome.
    config: { decayMedian: 0.033 },
    modes: ['rulebook'],
  },

  // 4 ---------------------------------------------------------------------
  {
    id: 'long-walk',
    name: 'The Long Walk',
    blurb: 'A bigger kingdom and fewer masons. The breach is always announced somewhere else.',
    teaches:
      'Travel time is actionability. A mason who cannot get there in time is not a mason you have.',
    durationSeconds: 240,
    kingHp: 110,
    masons: 11,
    courses: 3,
    walls: FOUR(12, 1),
    demandRate: 0.9,
    hubsPerCorner: 0,
    keepBricks: 16,
    sizeMix: { S: 2, M: 3, L: 2 },
    config: { width: 1600, height: 1600 },
    modes: ['rulebook'],
  },

  // 5 ---------------------------------------------------------------------
  {
    id: 'seam',
    name: 'The Seam',
    blurb:
      'Each wall gets its own crew, and crews never cross. Then we run the identical siege with one shared pool.',
    teaches:
      'Budget fungibility. An idle mason in a quiet zone is not saving anything; they are just unavailable.',
    durationSeconds: 210,
    kingHp: 90,
    masons: 12,
    courses: 3,
    // Lopsided demand AND lopsided work is what makes the seam bite. Demand alone
    // is not enough: decay is what generates mason-work, so if every wall decays
    // at the same rate every crew stays busy and nobody visibly idles.
    walls: FOUR(12, 2, [7, 1, 7, 1]),
    decayRateFor: (b, rng) => {
      const busy = b.wallIds.includes('N') || b.wallIds.includes('S');
      return rng.logNormal(busy ? 0.03 : 0.004, 0.7);
    },
    demandRate: 1.0,
    hubsPerCorner: 0,
    keepBricks: 16,
    sizeMix: { S: 2, M: 3, L: 2 },
    forceZones: true,
    modes: ['rulebook', 'zones'],
  },

  // 6 ---------------------------------------------------------------------
  {
    id: 'culling',
    name: 'The Culling',
    blurb:
      'Twelve masons. You lose two every ninety seconds. Plague, budget cuts, a reorg — the flavour text rotates.',
    teaches:
      'Triage is not failure. Triage is the optimum under scarcity. Abandoning the perimeter is the winning move, and it still feels terrible.',
    durationSeconds: 480,
    kingHp: 120,
    masons: 12,
    courses: 3,
    walls: FOUR(12, 2),
    demandRate: 1.3,
    hubsPerCorner: 2,
    keepBricks: 16,
    sizeMix: { S: 2, M: 3, L: 2 },
    culling: { everySeconds: 90, count: 2, floor: 2 },
    modes: ['rulebook', 'zones', 'auction'],
  },
];

/** Sandbox: every knob exposed, nothing hidden, nothing scripted. */
export const SANDBOX: LevelSpec = {
  id: 'sandbox',
  name: 'Sandbox',
  blurb: 'All knobs exposed. Policy import/export as JSON.',
  teaches: 'Nothing. That is the point.',
  durationSeconds: 240,
  kingHp: 100,
  masons: 12,
  courses: 3,
  walls: FOUR(12, 2),
  demandRate: 1.0,
  hubsPerCorner: 2,
  keepBricks: 16,
  sizeMix: { S: 2, M: 3, L: 2 },
  modes: ['rulebook', 'zones', 'auction'],
};

export const ALL_LEVELS: LevelSpec[] = [...LEVELS, SANDBOX];

export function getLevel(idOrIndex: string | number): LevelSpec {
  if (typeof idOrIndex === 'number') {
    const l = LEVELS[idOrIndex - 1];
    if (!l) throw new Error(`no level ${idOrIndex} (1..${LEVELS.length})`);
    return l;
  }
  const n = Number(idOrIndex);
  if (Number.isFinite(n) && String(n) === idOrIndex.trim()) return getLevel(n);
  const l = ALL_LEVELS.find((x) => x.id === idOrIndex);
  if (!l) throw new Error(`unknown level '${idOrIndex}'. Known: ${ALL_LEVELS.map((x) => x.id).join(', ')}`);
  return l;
}
