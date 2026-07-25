import { compileRulebook } from './dsl.js';
import type { Policy } from './ir.js';

/**
 * Preset rulebooks, named after their pathology. The player edits from these.
 * Acceptance criterion: every one of these loses at least one shipped level,
 * and no single preset wins all six.
 */
export interface Preset {
  id: string;
  name: string;
  /** The pathology, in one line, shown next to the preset in the picker. */
  pathology: string;
  source: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'biggest',
    name: 'BIGGEST FIRST',
    pathology: 'Size-greedy. The bubble-game fallacy: big things look important.',
    source: `# BIGGEST FIRST
# Always walk to the largest damaged brick on the board.
PRIORITY 1: bricks WHERE damaged BY largest
DEFAULT:    largest damaged brick
`,
  },
  {
    id: 'twitchiest',
    name: 'TWITCHIEST FIRST',
    pathology: 'Decay-greedy. Change-rate is not value.',
    source: `# TWITCHIEST FIRST
# Chase whatever is decaying fastest.
PRIORITY 1: bricks WHERE damaged BY fastest
DEFAULT:    fastest damaged brick
`,
  },
  {
    id: 'nearest',
    name: 'NEAREST FIRST',
    pathology: 'Pure actionability. Never idle, never strategic.',
    source: `# NEAREST FIRST
# Fix whatever is closest. Cheap, busy, and blind.
PRIORITY 1: bricks WHERE damaged BY nearest
DEFAULT:    nearest damaged brick
`,
  },
  {
    id: 'firefighter',
    name: 'FIREFIGHTER',
    pathology: 'Threshold-triggered only. Over-waiting: acts once the wall is already gone.',
    source: `# FIREFIGHTER
# Do nothing until something is nearly rubble.
PRIORITY 1: bricks WHERE integrity < 0.15 BY nearest
DEFAULT:    none
INTERRUPT WHEN integrity < 0.1
IGNORE weathered
`,
  },
  {
    id: 'balanced',
    name: 'BALANCED',
    pathology: 'A decent hand-tuned product heuristic. Good — until the masons run out.',
    source: `# BALANCED
# Cornerstones, then the head of the results, then anything structural.
PRIORITY 1: bricks WHERE hub AND integrity < 0.6 BY nearest
PRIORITY 2: bricks WHERE course = top AND integrity < 0.45 BY most valuable
PRIORITY 3: bricks WHERE cracked BY nearest
PRIORITY 4: bricks WHERE integrity < 0.5 AND decayRate > medium BY nearest
DEFAULT:    none
INTERRUPT WHEN integrity < 0.15 AND distance < 150
`,
  },
];

export function presetPolicy(id: string): Policy {
  const p = PRESETS.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
  if (!p) throw new Error(`unknown preset '${id}'. Known: ${PRESETS.map((x) => x.id).join(', ')}`);
  return compileRulebook(p.source, p.name);
}
