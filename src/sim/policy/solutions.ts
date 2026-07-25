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
      'The breaches are not where the big bricks are. Traffic sits on the small, slow, top-course ones — so hold those high and let the impressive ones weather.',
    source: `# BUBBLE TRUTH
# Size is the signal you can see. Traffic is the one that matters.
PRIORITY 1: bricks WHERE course = top AND size = S AND integrity < 0.7 BY nearest
PRIORITY 2: bricks WHERE size = S AND integrity < 0.45 BY nearest
PRIORITY 3: bricks WHERE integrity < 0.25 BY nearest
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
PRIORITY 1: bricks WHERE course = top AND integrity < 0.6 AND distance < 300 BY nearest
PRIORITY 2: bricks WHERE integrity < 0.45 AND distance < 300 BY nearest
PRIORITY 3: bricks WHERE course = top AND integrity < 0.3 BY nearest
DEFAULT:    none
`,
  },
  {
    id: 'hold-the-keep',
    name: 'HOLD THE KEEP',
    level: 'culling',
    insight:
      'When the crew halves and halves again the perimeter stops being defensible. Triage is not failure; it is the optimum under scarcity.',
    source: `# HOLD THE KEEP
# Farewell, east wall.
PRIORITY 1: bricks WHERE keep AND integrity < 0.75 BY nearest
PRIORITY 2: bricks WHERE hub AND integrity < 0.5 BY nearest
PRIORITY 3: bricks WHERE course = top AND integrity < 0.4 BY nearest
DEFAULT:    none
`,
  },
];

export function solutionPolicy(id: string): Policy {
  const s = SOLUTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown solution '${id}'. Known: ${SOLUTIONS.map((x) => x.id).join(', ')}`);
  return compileRulebook(s.source, s.name);
}
