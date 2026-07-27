# FRESHKEEP

### What do you look at, when there is more than you can watch?

Every monitoring problem has the same shape. Things go out of date on their own
schedule, and never on yours. Some of them matter enormously and most of them
hardly matter at all. You have finite attention, you do not find out whether
something was wrong until you go and look — and looking costs the same whether
you find a fire or find nothing.

A search engine choosing which pages to re-crawl before they rot. An on-call
engineer deciding which dashboards earn a glance at 3am. A port that can open one
container in a thousand. A radiologist setting re-screening intervals. A team
picking which tests to run before a release. A newsroom deciding which sources to
keep checking. Same question every time, and the answer is never *watch
everything*, because there was never enough of you to go around.

The uncomfortable part is that when you have plenty of capacity, every strategy
looks fine. Slack hides bad judgement. You only discover whether you were
allocating attention well when there stops being enough of it — which is exactly
when you can least afford to find out.

## The game

*You program masons to defend a kingdom of freshness.*

Walls are query result sets. Bricks are pages, each going stale at its own rate,
and a brick's width around the ring is its share of the traffic. Raiders are
queries, arriving from a demand distribution you never get to see. If the brick a
raider arrives at is holding, it leaves empty-handed. If it has crumbled, the
raider walks through and goes for the king.

**You never click a brick.** You write a policy — a small readable rulebook — and
the masons execute it autonomously while you watch. Then you press a button that
runs the identical siege again with half the crew, and find out whether your
policy was good or whether you were merely well staffed.

That button is the argument. Everything else is scaffolding for it.

The underlying model is not invented for the game: it comes from Brian
Brewington's dissertation, *Keeping Up With the Changing Web* (Dartmouth, 2000),
on how
often to revisit sources that change at rates you can only estimate. The
counterintuitive results the levels teach — that the fastest-changing sources can
be the ones worth abandoning, that a good allocation beats a naive one by more
and more as capacity shrinks — are results from that work, made playable.

**Status: M1 + M2 complete, on a radial board.** Deterministic simulation core,
rulebook DSL, auction mode, six teaching levels and six campaign levels,
telemetry, headless CLI, canvas renderer, live editor, report card and thesis
button. 68 tests.

## Running it

```bash
npm install
npm run dev        # the game, at http://localhost:5173
npm test           # 68 tests, incl. every acceptance criterion
npm run sim -- --help

npm run sim -- --level 3 --preset balanced             # a report card
npm run sim -- --level 3 --preset balanced --thesis    # THE THESIS BUTTON
npm run sim -- --level 3 --sweep                       # every preset, side by side
npm run sim -- --level seam --preset balanced --zones  # then --no-zones, and compare
npm run sim -- --level 6 --solution hold-the-keep
npm run sim -- --level 2 --policy ./my.rulebook --json --out run.json
npm run sim -- --level 3 --preset balanced --pressure 2   # twice the raiders

npx tsx tools/balance.ts matrix                   # every policy x every level
npx tsx tools/balance.ts knee cornerstones balanced decayMedian 0.02,0.05,6
npx tsx tools/scatter.ts cornerstones balanced 16,8,4   # standalone HTML
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

## Pressure

Mason count is the supply side of the game's central ratio. `--pressure` (and the
slider beside Masons) is the demand side — it scales how fast raiders arrive.
Both move the same ratio, which is the thing the game is actually about. The
thesis and Seam comparisons inherit it, so those stay controlled experiments.

## The two axes, and the ignored set

Two numbers decide whether a brick is worth walking to: **how fast it turns
over**, and **how much traffic it answers**. Both are computed per brick.
`decayRate` is the first. The second, `arrivalRate`, is the wall's share of
demand times the rank weights times the bearing density integrated over that
brick's own arc — so it accounts for peaked demand instead of assuming traffic
follows arc width. It is verified to sum to the level's demand rate and to
predict the arrivals each brick actually receives.

Together they place every brick on a plane, and the report card plots where your
masonry actually went on it: mean change time across, mean time between arrivals
up, filled circles where masons spent time, hollow rings for bricks left alone.

The shape to look for is the **ignored set**, and it grows as the crew shrinks:

```
$ npx tsx tools/scatter.ts cornerstones balanced 16,8,4
  16 masons    15/144 bricks ignored, carrying 17% of the traffic
   8 masons    65/144 ignored, carrying 37%
   4 masons   101/144 ignored, carrying 72%
```

That is the whole thesis in three lines. With plenty of masons almost everything
gets attention and any policy looks defensible; as capacity falls you are forced
to choose, and *which* things you abandon is the only thing that matters.

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

Fields: `integrity` `damage` `decayRate` `traffic` (a.k.a. `arc`) `throughput`
`distance` `course` `size` `wall`, and the yes/no properties `hub` `spare` `keep`
`intact` `weathered` `cracked` `rubble` `damaged` `structural` `top` `mid` `deep`.
`AND` / `OR` / `NOT` / parentheses. `BY` orders within a tier: `nearest`
`largest` `most damaged` `fastest` `most valuable` and friends. Distance is
always the final tiebreak.

Two of those are easy to confuse, deliberately: **`throughput` is the size class**
(S/M/L = 1/3/9) and **`traffic` is the brick's angular share** — how much of the
ring it actually covers. On most levels they agree. On The Bubble Trap they do
not, and the gap is the lesson. `traffic` used to alias `throughput`, which meant
a field named for traffic returned size — exactly the fallacy the game is about.

`wall` accepts only `=` and `!=`; walls have no ordering, so `wall > E` is a parse
error rather than something that quietly compiles to `wall = E`.

Rulebooks, zone assignments and auction weights all compile to the same internal
representation: a scoring function over (mason, brick) pairs plus interrupt rules.

## Layout

```
src/sim/
  rng.ts          seeded PRNG; separate demand and resolution streams
  types.ts        Brick / Wall / Raider / Mason / King / World
  config.ts       every constant, all defaults, none of them laws
  level.ts        polar world construction: sectors, arcs, hubs, demand lobes,
                  and per-brick importance
  levels.ts       the six campaign levels + sandbox
  basics.ts       the six one-mason teaching levels
  sim.ts          the deterministic tick loop
  report.ts       report card, utilization, allocation, roast lines
  telemetry.ts    versioned JSON export + localStorage
  policy/
    ir.ts         the shared internal representation
    dsl.ts        rulebook tokenizer, parser, compiler
    presets.ts    the five pathology presets
    solutions.ts  worked solutions, one per level that needs a written policy
    auction.ts    Mode 3 bid weights
src/ui/
  render.ts       annulus-sector renderer
  scatter.ts      allocation plot — pure, so it is testable without a browser
  app.ts          shell, editor, controls, report card
src/cli/run.ts    headless runner
tools/
  balance.ts      policy x level x crew x seed sweeps, and knee-finding
  scatter.ts      renders the allocation sweep to standalone HTML
test/             determinism, DSL, acceptance, basics, geometry, scatter
```

## Acceptance criteria — all asserted in tests

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

## What the cross-model review changed

The sim and its tests were reviewed by **Grok 4.5** and **Composer 2.5** via
Cursor — deliberately non-Anthropic, so the reviewers did not share the author's
blind spots. Both independently reached the same verdict: *the tests measured the
balance spreadsheet, not the simulation.*

Their headline claim — "break `brickAt` and the suite still passes" — turned out
to be **false**; mutation-testing it fails 5 tests, and falsifying "arc = traffic"
fails 4 more, including the two teaching levels whose lesson depends on it. But
the deeper criticism was right and is now fixed: the geometry was only protected
*indirectly*, through balance outcomes. Breaking the bearing→brick mapping used to
fail with *"MIND THE KEYSTONE should hold The Keystone"*, which tells you nothing.
It now fails with *"column 0 (L) covers 92.0% of the circle but took 100.0% of the
raiders."*

Bugs the review surfaced, all reproduced before fixing:

- **`traffic` in the DSL meant size, not traffic.** It aliased `throughput`, the
  size class — precisely the fallacy The Bubble Trap exists to break. It now reads
  the brick's angular share, with `arc` as a synonym.
- **`wall > E` silently compiled as `wall = E`.** Walls have no order; the
  operator was discarded. It is now a parse error that says so.
- **The middle rank was dead on any two-course level.** `mid` floored onto course
  0, so the tutorial ran 95/5 instead of the configured 70/25/5. Measured at 96/4
  before, 75/25 after.
- **`structural` hardcoded `0.33`** instead of tracking `DAMAGE_THRESHOLDS`.
- **The hub-repair criterion was judged on a single seed.**

And one the *new* tests found on their first run, which neither reviewer nor the
author had spotted:

- **`norm()` was not idempotent.** `((a % TAU) + TAU) % TAU` round-trips lossily
  for a value already in range and can return one ULP low. Sector bounds are
  stored normalized, so a bearing landing exactly on a seam normalized to just
  below its own sector's start — belonging to **no wall at all**. Values in range
  are now returned untouched.

`test/geometry.test.ts` holds the assertions that would have caught these:
a spawn histogram against `angSpan` over 40 seeds, bearing→brick resolution at
arc edges, seam ownership, `inSector` boundary and wrap cases, and full
spawn-*sequence* equality across policies and crew sizes (the demand-isolation
guarantee was previously checked only as a total arrival count).

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

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, teach with it.

The underlying research is separate from the code licence: the allocation results
the levels encode are published work, cited above, and attribution there is a
matter of scholarly courtesy rather than a condition of the licence.

## Next

**The interview.** Before the siege the board is hidden and you may ask a limited
number of questions about it, each costing prep. Then you commit a rulebook and
cannot edit it while the siege runs. The skill is knowing which uncertainty would
actually change your policy — most people ask what the biggest brick is; the
question that pays is usually about variance.

**Accumulated uncertainty.** Decay is currently linear and therefore exactly
predictable, which makes the optimal policy a fixed rotation you can time with a
stopwatch. Real sources change memorylessly. The bar should decay as
`e^(−λ·age)` — the probability the brick still holds — so what drains is not the
wall but your *confidence* in it, and the mason cannot know what he'll find until
he arrives.

**The frontier level and the optimal boundary.** With both axes computed, the
next level is bricks scattered across the (change rate, traffic) plane where the
job is to find the line. Scoring it properly needs the allocation rule from the
dissertation rather than a reconstruction of it.

**A regime schedule.** Demand that shifts on a fixed, seeded schedule — the world
changes and a hardcoded policy doesn't. Deliberately *not* an adversary that
reacts to you: that would make every A/B a different world and take the thesis
button with it.

**Smaller:** zone *painting* (zones are currently one crew per wall — enough to
show the pathology, not the painting UI the spec describes), the auction
bid-equalisation overlay, apprenticeship mode, and the natural-language layer
that compiles to visible DSL before it runs.
