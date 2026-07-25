# FRESHKEEP

*A game where you program masons to defend a kingdom of freshness.*

Walls are query result sets. Bricks are web pages, each decaying at its own rate.
Raiders are queries. You do not click to repair — you write a policy, and masons
execute it autonomously. Then you watch your policy win, or lose.

**Status: M1 + M2 complete, on a radial board.** The deterministic simulation core, the rulebook
DSL, auction mode, six levels, telemetry and the headless CLI (M1); and the
canvas renderer, live rulebook editor, controls, report card and thesis button
(M2). Everything is tested.

## Running it

```bash
npm install
npm run dev        # the game, at http://localhost:5173
npm test                                    # 32 tests, incl. every acceptance criterion
npm run sim -- --help

npm run sim -- --level 3 --preset balanced             # a report card
npm run sim -- --level 3 --preset balanced --thesis    # THE THESIS BUTTON
npm run sim -- --level 3 --sweep                       # every preset, side by side
npm run sim -- --level seam --preset balanced --zones  # then --no-zones, and compare
npm run sim -- --level 6 --solution hold-the-keep
npm run sim -- --level 2 --policy ./my.rulebook --json --out run.json
```

## The thesis button

The whole argument of the game, from the command line:

```
$ npm run sim -- --level 3 --preset balanced --thesis
  SURVIVED at 16 masons, FALLEN at 8. Freshness-age 0.656 → 0.754.
```

Same policy. Same seed. Same siege, raider for raider. Half the masons.
Level 3 is deliberately tuned to sit on that knee: 16 holds on every seed
tested, 8 falls on every seed tested.

## The board is radial

The king sits at the centre, courses are concentric rings, and a wall is an
angular **sector** of those rings. Raiders arrive on a bearing and walk a
straight line at the king — they are never re-aimed, and there is a test
asserting that a raider's distance to the king only ever decreases.

Walls partition the **whole** circle, because a sector that does not is a gap
raiders stroll through. A one-wall level is therefore one wall encircling the
kingdom.

The payoff is that **a brick's angular width IS its share of the traffic.**
Whatever spans a bearing intercepts everything arriving on it, so size,
throughput and demand stop being three numbers and become one picture. An L brick
(throughput 9) literally covers nine times the arc of an S brick, and each course
tiles its sector exactly — both asserted in `test/basics.test.ts`.

## Is demand flat or peaky?

Both, per level, via `demandPeakiness`. At 0 arrivals spread evenly around a
sector. Above 0 they concentrate into `demandLobes` bearings with Zipf weights
`1/(i+1)^peakiness`, which is what request traffic actually looks like. Lobe
centres are drawn from the seeded world RNG: hidden from the player, stable for a
seed, and **findable by watching** — turn on the `demand` overlay and a flat
kingdom shows a smooth ring while a peaky one shows lumps.

The teaching levels ship flat, because a level whose job is to isolate one
variable must not have a second one moving. The Bubble Trap ships peaky with
`lobeAnchor: 'small'`, so you can watch the traffic pour onto narrow bricks while
the wide impressive ones catch almost nothing.

This replaced an earlier `demandExponent` knob (traffic ∝ throughput^k), which
was rejected because a heavier tail on *size* makes size-greed correct and turns
BIGGEST FIRST — the bubble-game fallacy — into the strongest policy in the game.

## The basics — six one-mason kingdoms

Levels small enough to read at a glance. One mason, one ring, one idea; no hubs,
no zones, no keep ring, so a breach hits the king immediately and cause and
effect are one step apart. Each names the preset that plainly fails it, and the
level **opens on that preset** — watch the wrong policy lose, load the worked
solution, watch the identical siege hold.

| level | lesson |
|---|---|
| The Keystone | one brick spans 92% of the circle; it is worth more than the other five together |
| Fair Weather | weathered damage is cosmetic — eight ugly bricks let nobody through, one cracked brick loses the kingdom |
| Fixed Price | every repair costs the same slot, so topping up a 0.9 brick buys nothing |
| The Twitchy One | drain rate says how *often*, never how *much* |
| Two Gates | one mason cannot be in two places; the same rulebook holds it with two |
| The Spare | a raider only passes when its *whole* target set has crumbled |

`test/basics.test.ts` asserts the pairing for each: the solution holds on ≥4 of 5
seeds, the named wrong preset holds on ≤1. That is what "the lesson is plain"
means, stated as an assertion rather than a hope.

## The visual language

Everything is designed to be read at a glance, because the player is watching a
policy rather than driving it.

| | |
|---|---|
| **integrity** | fill level along the brick's long axis |
| **intact** | warm stone |
| **weathered** | green discolouration and diagonal hatching — deliberately *unlike* a crack, because it is cosmetic and nothing gets through it |
| **cracked** | ochre with dark crack strokes — structural |
| **rubble** | scattered fragments, distinct from an empty socket |
| **cornerstone** | gold keystone diamond at the wall junction |
| **mason** | cream head, orange hard hat, slumps and dims when idle, `!` when interrupted |
| **raider** | red arrow; a puff ring and retreat when repelled, a treasure bag when it breaches |
| **drain rate** | 1–3 pips on every brick — slate / amber / red for slow / medium / fast, bucketed by the same `slow`/`medium`/`fast` thresholds the DSL exposes, so what you can see is exactly what you can write a rule about |
| **breach** | expanding red pulse at the segment that gave way |
| **demand** | optional halo outside the wall: smooth ring = flat, lumps = peaky |

Three separate signals, three separate shapes, so none can be mistaken for
another at a glance: cracks are jagged strokes, weathering is diagonal hatching,
drain rate is dots.

Crack and rubble sprites are hashed from the brick id, so they never jitter
between frames.

The live sim is on the console as `FRESHKEEP` — `FRESHKEEP.advance(1200)` steps
forty seconds, `FRESHKEEP.sim.totals` reads the running metrics.

## The rulebook DSL

```
# priority rules, evaluated top-down; first match wins
PRIORITY 1: bricks WHERE hub AND integrity < 0.5
PRIORITY 2: bricks WHERE course = top AND integrity < 0.4
PRIORITY 3: bricks WHERE decayRate > fast AND size >= M BY largest
DEFAULT:    nearest cracked brick
INTERRUPT WHEN any brick integrity < 0.15 AND distance < 30
IGNORE weathered
```

Fields: `integrity` `damage` `decayRate` `throughput` `distance` `course` `size` `wall`,
and the yes/no properties `hub` `spare` `keep` `intact` `weathered` `cracked` `rubble`
`damaged` `structural` `top` `mid` `deep`. `AND` / `OR` / `NOT` / parentheses.
`BY` orders within a tier: `nearest` `largest` `most damaged` `fastest`
`most valuable` and friends. Distance is always the final tiebreak.

Rulebooks, zone assignments and auction weights all compile to the same internal
representation: a scoring function over (mason, brick) pairs plus interrupt rules.

## Layout

```
src/sim/
  rng.ts          seeded PRNG; two independent streams (see below)
  types.ts        Brick / Wall / Raider / Mason / King / World
  config.ts       every constant, all defaults, none of them laws
  level.ts        LevelSpec + world construction (ring geometry, hubs, keep)
  levels.ts       the six shipped levels + sandbox
  sim.ts          the deterministic tick loop
  report.ts       report card, utilization, roast lines
  telemetry.ts    versioned JSON export + localStorage
  policy/
    ir.ts         the shared internal representation
    dsl.ts        rulebook tokenizer, parser, compiler
    presets.ts    the five pathology presets
    solutions.ts  worked solutions, one per level that needs a written policy
    auction.ts    Mode 3 bid weights
  basics.ts       the six one-mason teaching levels
src/cli/run.ts    headless runner
tools/balance.ts  policy x level x crew x seed sweeps, and knee-finding
test/             determinism, DSL, acceptance, basics
```

## Acceptance criteria — all asserted in `test/acceptance.test.ts`

| Criterion | Where |
|---|---|
| Identical `(seed, policy, masonCount)` → identical event log | `determinism.test.ts` |
| Every preset loses ≥1 level; no preset wins all six | `acceptance.test.ts` |
| L3: BALANCED @16 wins, @4 loses | `acceptance.test.ts` |
| L5: shared pool strictly dominates forced zones, same policy + seed | `acceptance.test.ts` |
| L3: winning runs have higher hub-repair ratio than losing runs | `acceptance.test.ts` |
| Masons never teleport; per-tick displacement ≤ speed × dt | `determinism.test.ts` |
| Repairing weathered bricks tracked as wasted attention | `acceptance.test.ts` |
| A complete run exports as valid versioned JSON | `determinism.test.ts` |

Performance: 55µs per tick at 192 bricks / 20 masons / 21 raiders — about 0.33%
of a 60fps frame, so the renderer has the budget it needs.

## Fix-time is constant

A repair takes the same seconds whatever the brick — huge or tiny, twitchy or
stable, barely weathered or flat rubble. This deliberately reverses the spec's
"scaled by brick size: big bricks take longer".

It makes the mason's decision a pure question of *value* — which brick is worth a
slot — instead of a cost/benefit sum in which cheap little repairs are always
defensible. It is also what makes cosmetic repair genuinely expensive: topping up
a brick that was never in danger burns exactly as much of your crew as saving one
that was.

The strategic consequence showed up immediately in the balance data: every
shipped policy wanted *lower* thresholds afterwards. When a slot costs the same
either way, you spend it late, on what is about to give way. BALANCED's
cornerstone rule went from `< 0.6` to `< 0.5`, and the triage solution for The
Culling went from `< 0.75` to `< 0.35`.

## What counts as a breach

A **breach** is a raider walking through an unmaintained wall segment. It is
counted the moment the wall fails to answer, regardless of what happens next.

Some breaching raiders are then turned back by the inner keep ring and never
touch the king, so the report card splits the number: *reached the king* versus
*stopped by the keep ring*. King HP only moves for the first group, but both are
breaches — the wall did not answer the query either way.

Raiders resolve at the **face** of the wall and never come to rest inside the
masonry. Which course a raider queries still decides what defends it (its target
set); it simply does not walk in to find out.

## Decisions the spec left open

Recorded here because they are judgment calls, not derivations.

**Target set.** The spec says a wall answers a raider "if the specific brick
segment the raider targets is intact", and also that "a raider blocked by ANY
intact brick in its target column is repelled", while defining spares per
*course*. Those do not quite compose. Resolution used: a raider's target set is
the grid brick it aims at, plus that course's spare bricks, plus any hub on that
course. Anything in the set at or above the cracked threshold repels it; if the
whole set is cracked, pass probability is the product of the individual
probabilities. This keeps rank-weighted targeting load-bearing — if one intact
brick anywhere in a column saved you, deep courses would matter as much as the
head, and the 70/25/5 weighting would mean nothing.

**Size vs. traffic.** The spec makes size *be* the query-throughput weight, but
The Bubble Trap requires demand concentrated on small, slow-decaying bricks. So
`throughput` is the visible, nominal signal (what a policy can read) and
`demandWeight` is the hidden share of real arrivals. It defaults to `throughput`
and only The Bubble Trap decouples them. Without this split, "currency ≠ value"
has nothing to be about — the value would be legible right there on the brick.

**The keep ring mitigates; it does not wall.** First implementation had healthy
keep bricks repel with certainty. Simulation showed that made "ignore the
perimeter, hold the sixteen inner bricks" a dominant strategy that won every
level with 60–80 breaches. A keep that certainly repels makes the whole game
optional. It now turns back `keepRepelChance` (0.6) of what reaches it: useless
to a player who abandoned the walls all game, decisive to one who has genuinely
run out of masons. `HOLD THE KEEP` now loses levels 2, 4 and 5 and wins only The
Culling, which is what the design asked for.

**Two RNG streams.** Demand (arrival timing and targeting) draws from a
different stream than combat resolution, so the number of resolution rolls can
never shift the arrival sequence. Same seed → same siege, regardless of policy or
mason count. Without this the thesis button and The Seam's A/B compare two
different sieges, and neither comparison means anything.

**Interrupt hysteresis.** A mason can be preempted at most once per task. The
first implementation re-evaluated interrupts every tick, and masons thrashed:
the moment one started repairing, its brick climbed out of the interrupt band,
another brick became the emergency, and it walked away from work already paid
for. 8 completed repairs per run became 83 when this was fixed. The greedy
router with hysteresis is the designed behaviour, not a shortcut.

**The Culling rewards triage above every preset**, on purpose, and there is a
test asserting the ranking. Triage is the lesson; you have to write it yourself.

**Masons will not walk to a brick for a rounding error** (`minRepairBenefit`).
Without that floor a mason parks on one brick and "completes" a repair every tick
as it decays 0.999 → 1.0: forty thousand repairs per run, no movement, and a
hub-repair ratio computed against a meaningless denominator. Fixing it raised
effective capacity enough to rebalance the whole game.

**Heavier-tailed demand was tried and rejected.** Making traffic scale as
`throughput ** 1.8` was an attempt to give value-aware policies something to
exploit. It backfired: with a heavy tail, size-greed becomes *correct*, and
BIGGEST FIRST — the bubble-game fallacy — turns into the strongest policy under
scarcity. Size-greed has to fail because it ignores structural risk, travel and
shared structure, not because size is a lie. The knob survives as a sandbox dial,
defaulted to the spec's plain 1/3/9.

**The Seam's zoned run can post a BETTER average freshness while losing.** Not a
bug — the point. Zone-locked crews on a quiet wall polish bricks nobody queries,
which lifts the global average while the busy wall comes down. There is a test
asserting the inversion happens on at least one seed: an average taken over the
wrong denominator flatters a bad allocation.

**Cornerstones crumble faster than ordinary bricks.** Hubs have to be
structurally decisive, not merely present. With ordinary decay a policy could
ignore them and still win, the hub-repair ratio stopped separating winners from
losers, and the level taught nothing about shared masonry.

**The Bubble Trap has one spare brick per course, not two.** Redundancy rewards
uniform sweeping: when a raider only gets through if the *whole* target set has
crumbled, spreading effort evenly is near-optimal, and NEAREST FIRST wins every
level at every mason count. With a single spare a raider's fate turns on the
specific brick it aimed at, so which bricks you keep fresh maps directly onto
which queries get answered — and every preset loses the level while a
traffic-aware policy holds it.

## A trap worth surfacing in the editor (M2)

`IGNORE` is applied before the priority tiers, so `IGNORE weathered` silently
deletes any rule whose whole threshold band sits inside 0.33–0.66. The shipped
BALANCED preset originally had exactly this bug — its hub rule never fired. The
compiler does not object and neither would a player. `dsl.test.ts` documents the
behaviour; the editor should lint it.

## Not built (and deliberately not)

No optimal routing or TSP solving — greedy plus hysteresis, full stop. No
fog-of-war. No multiplayer, accounts or backend. No raider HP or combat. No
natural-language policy execution without a visible DSL compilation step.

## Next: M3+

Zone *painting* (zones are currently one crew per wall, which is enough to show
the pathology but is not the painting UI the spec describes), the auction
bid-equalisation overlay, apprenticeship mode, and the natural-language layer
that compiles to visible DSL before it runs.
