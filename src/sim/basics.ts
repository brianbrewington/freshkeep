import type { BrickPlan, LevelSpec, WallSpec } from './level.js';

/**
 * THE BASICS — six kingdoms small enough to read at a glance.
 *
 * One mason, one ring, one idea each. No hubs, no zones, no keep ring: a raider
 * that gets through hits the king immediately, so cause and effect are one step
 * apart. Demand is flat on every one of them, because a level whose job is to
 * isolate a single variable must not have a second one moving.
 *
 * Each names the preset that plainly fails it. That pairing is the lesson: watch
 * the wrong policy lose, then watch the right one hold, with nothing else changed.
 */

/** One wall encircling the kingdom. A sector that does not close is a gap. */
function ring(plan: BrickPlan[], spares = 0): WallSpec[] {
  return [{ id: 'N', name: 'the wall', side: 'N', columns: plan.length, spares, demandShare: 1, plan: [plan] }];
}

const BASE = {
  courses: 1,
  hubsPerCorner: 0,
  keepBricks: 0,
  sizeMix: { S: 1, M: 1, L: 1 },
  modes: ['rulebook'] as Array<'rulebook' | 'zones' | 'auction'>,
  masons: 1,
};

export const BASICS: LevelSpec[] = [
  {
    ...BASE,
    id: 'b1-keystone',
    name: 'The Keystone',
    blurb:
      'One enormous brick and five little ones. Raiders arrive from every direction and walk straight at the king.',
    teaches:
      'A brick’s width is its share of the traffic. One brick here answers two thirds of everything that arrives — save that one and you have saved most of the kingdom.',
    durationSeconds: 80,
    kingHp: 70,
    demandRate: 0.9,
    // Spans are explicit so the traffic share is exact: the keystone answers 92%
    // of everything that arrives, the five little ones 1.6% each.
    walls: ring([
      { size: 'L', span: 0.92, decay: 0.03, integrity: 0.9 },
      { size: 'S', span: 0.016, decay: 0.02, integrity: 0.9 },
      { size: 'S', span: 0.016, decay: 0.02, integrity: 0.9 },
      { size: 'S', span: 0.016, decay: 0.02, integrity: 0.9 },
      { size: 'S', span: 0.016, decay: 0.02, integrity: 0.9 },
      { size: 'S', span: 0.016, decay: 0.02, integrity: 0.9 },
    ]),
    // Fixing whatever is closest spends the whole siege on bricks nobody queries.
    wrongPreset: 'nearest',
  },

  {
    ...BASE,
    id: 'b2-cosmetic',
    name: 'Fair Weather',
    blurb:
      'Most of this wall looks awful. One brick, quietly, is the only one raiders can actually get through.',
    teaches:
      'Weathered damage is COSMETIC. Nobody passes a weathered brick, however bad it looks. Only cracked bricks — under a third — let anyone through.',
    durationSeconds: 80,
    kingHp: 50,
    demandRate: 0.9,
    walls: ring([
      // The only real hole in the kingdom, and half the traffic.
      { size: 'L', span: 0.5, decay: 0.02, integrity: 0.3 },
      // Eight bricks that drift for ever inside the weathered band: permanently
      // ugly, permanently damaged, permanently impassable. They never crack, so
      // every second spent on them is a second the real hole was widening.
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.62 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.58 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.64 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.6 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.57 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.63 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.59 },
      { size: 'M', span: 0.0625, decay: 0.003, integrity: 0.61 },
    ]),
    wrongPreset: 'nearest',
  },

  {
    ...BASE,
    id: 'b3-fixed-price',
    name: 'Fixed Price',
    blurb:
      'Five bricks barely scratched, one nearly gone. Every repair costs a mason the same time, whatever the brick.',
    teaches:
      'Fix-time is constant. A slot spent lifting a brick from 0.9 to full buys you almost nothing; the same slot spent on the one about to fall buys you the kingdom.',
    durationSeconds: 80,
    kingHp: 40,
    demandRate: 0.9,
    walls: ring([
      { size: 'M', decay: 0.004, integrity: 0.9 },
      { size: 'M', decay: 0.004, integrity: 0.88 },
      { size: 'M', decay: 0.004, integrity: 0.92 },
      { size: 'M', decay: 0.004, integrity: 0.89 },
      { size: 'M', decay: 0.004, integrity: 0.91 },
      { size: 'M', decay: 0.02, integrity: 0.2 },
    ]),
    wrongPreset: 'nearest',
  },

  {
    ...BASE,
    id: 'b4-twitchy',
    name: 'The Twitchy One',
    blurb:
      'A sliver of a brick that crumbles before your eyes, and a broad calm one that barely moves. Three red pips versus one.',
    teaches:
      'Drain rate tells you how OFTEN a brick needs you, never how MUCH it is worth. The twitchy sliver answers almost no queries; the calm expanse answers nearly all of them.',
    durationSeconds: 80,
    kingHp: 50,
    demandRate: 0.9,
    walls: ring([
      { size: 'L', span: 0.96, decay: 0.014, integrity: 0.9 },
      { size: 'S', span: 0.02, decay: 0.12, integrity: 0.9 },
      { size: 'S', span: 0.02, decay: 0.12, integrity: 0.9 },
    ]),
    wrongPreset: 'twitchiest',
  },

  {
    ...BASE,
    id: 'b5-everywhere',
    name: 'Two Gates',
    blurb:
      'Two great bricks on opposite sides of the kingdom, both draining. One mason. Walk.',
    teaches:
      'Travel time is a hard constraint, not a tuning detail. No policy makes one mason be in two places — but two masons hold it with the same rulebook. Press the thesis button.',
    durationSeconds: 90,
    kingHp: 30,
    demandRate: 0.9,
    // The two gates sit exactly opposite: half a ring of walking between them.
    walls: ring([
      { size: 'L', span: 0.48, decay: 0.04, integrity: 0.9 },
      { size: 'S', span: 0.02, decay: 0.004, integrity: 1 },
      { size: 'L', span: 0.48, decay: 0.04, integrity: 0.9 },
      { size: 'S', span: 0.02, decay: 0.004, integrity: 1 },
    ]),
    wrongPreset: 'nearest',
  },

  {
    ...BASE,
    id: 'b6-spare',
    name: 'The Spare',
    blurb:
      'Six bricks crumbling faster than anyone could hold them, and one spare sitting behind the lot. The spare covers the whole wall on its own.',
    teaches:
      'Redundancy: a raider only gets through when its WHOLE target set has crumbled — the brick it aimed at and the spare behind it. You do not need everything perfect. You need not-everything-broken.',
    durationSeconds: 90,
    kingHp: 30,
    demandRate: 1.2,
    // The three bricks crumble faster than one mason can ever hold them. The
    // spare drifts slowly and stands behind all three — so it is the only thing
    // worth holding, and holding it alone repels everything.
    walls: ring(
      [
        { size: 'M', decay: 0.06, integrity: 0.6 },
        { size: 'M', decay: 0.06, integrity: 0.6 },
        { size: 'M', decay: 0.06, integrity: 0.6 },
        { size: 'M', decay: 0.06, integrity: 0.6 },
        { size: 'M', decay: 0.06, integrity: 0.6 },
        { size: 'M', decay: 0.06, integrity: 0.6 },
      ],
      1,
    ),
    // Six bricks crumbling this fast are beyond one mason. The spare is not.
    decayRateFor: (b) => (b.spare ? 0.05 : 0.06),
    // BALANCED is the wrong policy here, which is the point: a thoroughly decent
    // general heuristic loses because it treats the spare as just another brick.
    wrongPreset: 'balanced',
  },
];

/**
 * The seventh basic retires Fair Weather's rule on purpose, rather than letting
 * the campaign quietly invalidate it — and it teaches the thing that only
 * uncertainty can teach.
 *
 * Under `linear` you can wait: damage is visible, so "act when it gets bad" is a
 * real strategy. Here there is nothing to wait FOR. Confidence drains whether or
 * not anything has happened, no brick ever looks like an emergency, and by the
 * time one does you have been leaking for a minute. The only defence is a rate.
 */
export const B7: LevelSpec = {
  ...BASE,
  id: 'b7-no-alarm',
  name: 'No Alarm Will Come',
  blurb:
    'A kingdom you cannot see — only remember. One brick crumbles loudly and six sit quiet, and you will never be told which of them is letting raiders through.',
  teaches:
    'There is no "about to break" to react to, because you cannot see the wall — only how long since you looked. Waiting for an alarm loses; committing to a short round is the whole of the strategy.',
  durationSeconds: 150,
  kingHp: 230,
  demandRate: 1.0,
  decayModel: 'uncertain',
  walls: ring([
    // The loud one. Confidence here collapses faster than one mason can hold it,
    // and it carries a fifth of the traffic. Chasing it is the losing line.
    { size: 'M', span: 0.2, decay: 0.09, integrity: 1 },
    // Six quiet bricks carrying four fifths of the traffic between them. None of
    // them ever looks alarming. All of them leak.
    ...Array.from({ length: 6 }, () => ({ size: 'M' as const, span: 0.8 / 6, decay: 0.012, integrity: 1 })),
  ]),
  // FIREFIGHTER waits for integrity < 0.15. That signal never arrives in time,
  // because there is no signal — only age.
  wrongPreset: 'firefighter',
};

BASICS.push(B7);

export function isBasic(id: string): boolean {
  return BASICS.some((l) => l.id === id);
}
