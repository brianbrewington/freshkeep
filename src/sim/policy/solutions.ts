import { compileRulebook } from './dsl.js';
import type { Policy } from './ir.js';

/**
 * Worked solutions — one per level that needs a written policy rather than an
 * edited preset. These are not the "right answers" so much as existence proofs:
 * every shipped level can be held by a rulebook a player could plausibly write
 * from what the report card tells them.
 *
 * The Culling in particular is deliberately unwinnable by any preset. Triage is
 * the lesson, and you have to write it down yourself.
 */
export interface Solution {
  id: string;
  name: string;
  /** The level this was written for. */
  level: string;
  /** What the player had to notice to write it. */
  insight: string;
  source: string;
}

export const SOLUTIONS: Solution[] = [
  {
    id: 'b1-answer',
    name: 'MIND THE KEYSTONE',
    level: 'b1-keystone',
    insight: 'The wide arc is not decoration. It intercepts most of what arrives, so it is worth more than the five little ones put together.',
    source: `# MIND THE KEYSTONE
PRIORITY 1: bricks WHERE size = L AND integrity < 0.6 BY nearest
PRIORITY 2: bricks WHERE cracked BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'b2-answer',
    name: 'ONLY THE CRACKS',
    level: 'b2-cosmetic',
    insight: 'Four of these bricks look terrible and let nobody through. Spend nothing on them.',
    source: `# ONLY THE CRACKS
PRIORITY 1: bricks WHERE cracked BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'b3-answer',
    name: 'SPEND IT WHERE IT COUNTS',
    level: 'b3-fixed-price',
    insight: 'Every repair costs the same slot, so the value of a repair is how much integrity it puts back.',
    source: `# SPEND IT WHERE IT COUNTS
PRIORITY 1: bricks WHERE integrity < 0.6 BY most damaged
DEFAULT:    none
`,
  },
  {
    id: 'b4-answer',
    name: 'LET IT TWITCH',
    level: 'b4-twitchy',
    insight: 'The sliver will crumble again the moment you leave. Let it. It answers almost nothing.',
    source: `# LET IT TWITCH
PRIORITY 1: bricks WHERE size = L AND integrity < 0.6 BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'b5-answer',
    name: 'BOTH GATES',
    level: 'b5-everywhere',
    insight: 'There is no clever ordering that beats the walk. The rulebook is fine; the crew is not.',
    source: `# BOTH GATES
PRIORITY 1: bricks WHERE size = L AND integrity < 0.7 BY most damaged
DEFAULT:    none
`,
  },
  {
    id: 'b6-answer',
    name: 'HOLD THE SPARE',
    level: 'b6-spare',
    insight: 'The spare stands behind every brick in the wall, so it is worth as much as all of them. Let a brick crack; do not let the spare crack with it.',
    source: `# HOLD THE SPARE
# Nothing else. Chasing the cracked bricks pulls the mason off the spare
# just long enough for the spare to crack too, which is the only way to lose.
PRIORITY 1: bricks WHERE spare AND integrity < 0.8 BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'the-line',
    name: 'THE LINE',
    level: 'cornerstones',
    insight: 'Cornerstones defend two walls each, so they are worth two repairs.',
    source: `# THE LINE
# Defend what raiders actually hit, and only what is structurally at risk.
PRIORITY 1: bricks WHERE hub AND integrity < 0.55 BY nearest
PRIORITY 2: bricks WHERE course = top AND integrity < 0.5 BY nearest
PRIORITY 3: bricks WHERE integrity < 0.4 BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'bubble-truth',
    name: 'BUBBLE TRUTH',
    level: 'bubble-trap',
    insight:
      'The widest arcs look like they must matter most, and catch almost nothing. Watch the demand overlay: the traffic piles onto a few narrow bricks. Hold those and let the impressive ones weather.',
    source: `# BUBBLE TRUTH
# Size is the signal you can see. Traffic is the one that matters.
PRIORITY 1: bricks WHERE size < L AND integrity < 0.7 BY nearest
PRIORITY 2: bricks WHERE integrity < 0.2 BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'short-leash',
    name: 'THE SHORT LEASH',
    level: 'long-walk',
    insight:
      'distance is a field you can filter on. Refusing far-away work is a strategy: a mason who spends the siege walking defends nothing at either end.',
    source: `# THE SHORT LEASH
# Positioning beats reacting.
PRIORITY 1: bricks WHERE course = top AND integrity < 0.6 AND distance < 260 BY nearest
PRIORITY 2: bricks WHERE integrity < 0.45 AND distance < 260 BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'hold-the-keep',
    name: 'HOLD THE KEEP',
    level: 'culling',
    insight:
      'When the crew halves and halves again the perimeter stops being defensible. Triage is not failure; it is the optimum under scarcity — and since every repair costs the same slot, you spend it late, on what is about to give way.',
    source: `# HOLD THE KEEP
# Farewell, east wall.
PRIORITY 1: bricks WHERE keep AND integrity < 0.6 BY nearest
PRIORITY 2: bricks WHERE hub AND integrity < 0.45 BY nearest
DEFAULT:    none
`,
  },
];

export function solutionPolicy(id: string): Policy {
  const s = SOLUTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown solution '${id}'. Known: ${SOLUTIONS.map((x) => x.id).join(', ')}`);
  return compileRulebook(s.source, s.name);
}
