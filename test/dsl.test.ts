import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, compileRulebook, PolicyParseError, tryCompileRulebook, PRESETS, presetPolicy } from '../src/sim/index.js';
import type { Brick, Mason } from '../src/sim/types.js';
import type { EvalCtx } from '../src/sim/policy/ir.js';

function brick(over: Partial<Brick> = {}): Brick {
  return {
    id: 1,
    wallIds: ['N'],
    course: 0,
    column: 0,
    spare: false,
    hub: false,
    keep: false,
    x: 0,
    y: 0,
    angle: 0,
    angSpan: 0.5,
    radius: 300,
    size: 'M',
    throughput: 3,
    demandWeight: 3,
    arrivalRate: 0.01,
    integrity: 1,
    decayRate: 0.01,
    claimedBy: null,
    zone: null,
    ...over,
  };
}

function ctx(b: Partial<Brick>, distance = 10, band: 'top' | 'mid' | 'deep' = 'top'): EvalCtx {
  return {
    brick: brick(b),
    mason: { id: 0, x: 0, y: 0 } as Mason,
    distance,
    band,
    cfg: DEFAULT_CONFIG,
  };
}

describe('rulebook DSL', () => {
  it('parses the example from the spec', () => {
    const p = compileRulebook(`
# priority rules, evaluated top-down; first match wins the tiebreak
PRIORITY 1: bricks WHERE hub AND integrity < 0.5
PRIORITY 2: bricks WHERE course = top AND integrity < 0.4
PRIORITY 3: bricks WHERE decayRate > fast AND size >= M
DEFAULT:    nearest cracked brick
INTERRUPT WHEN any brick integrity < 0.15 AND distance < 30
IGNORE weathered
`);
    // A cracked hub is priority 1.
    expect(p.evaluate(ctx({ hub: true, integrity: 0.2 }))?.tier).toBe(0);
    // A cracked top-course brick falls to priority 2.
    expect(p.evaluate(ctx({ integrity: 0.3 }))?.tier).toBe(1);
    // A fast-decaying large brick is priority 3 even at full integrity.
    expect(p.evaluate(ctx({ integrity: 0.9, decayRate: 0.09, size: 'L' }))?.tier).toBe(2);
    // IGNORE weathered removes the 0.33-0.66 band entirely.
    expect(p.evaluate(ctx({ integrity: 0.5 }))).toBeNull();
    expect(p.evaluate(ctx({ hub: true, integrity: 0.5 }))).toBeNull();
  });

  it('honours IGNORE before priorities, which can silently kill a rule', () => {
    // This is a real and easy mistake: PRIORITY 1's whole band is inside the
    // weathered band, so IGNORE deletes it. The compiler does not object.
    const p = compileRulebook(`
PRIORITY 1: bricks WHERE hub AND integrity < 0.6
DEFAULT: nearest cracked brick
IGNORE weathered
`);
    expect(p.evaluate(ctx({ hub: true, integrity: 0.5 }))).toBeNull();
    expect(p.evaluate(ctx({ hub: true, integrity: 0.2 }))?.tier).toBe(0);
  });

  it('fires interrupts only when the whole condition holds', () => {
    const p = compileRulebook(`
PRIORITY 1: bricks WHERE damaged
INTERRUPT WHEN any brick integrity < 0.15 AND distance < 30
`);
    expect(p.hasInterrupts).toBe(true);
    expect(p.interrupt(ctx({ integrity: 0.1 }, 20))).toBe(true);
    expect(p.interrupt(ctx({ integrity: 0.1 }, 200))).toBe(false);
    expect(p.interrupt(ctx({ integrity: 0.5 }, 20))).toBe(false);
  });

  it('reports hasInterrupts=false when a rulebook has none', () => {
    expect(compileRulebook('DEFAULT: nearest cracked brick').hasInterrupts).toBe(false);
  });

  it('orders within a tier by the BY clause, with distance as the final tiebreak', () => {
    const p = compileRulebook('PRIORITY 1: bricks WHERE damaged BY largest');
    const big = p.evaluate(ctx({ integrity: 0.5, size: 'L', throughput: 9 }, 500))!;
    const small = p.evaluate(ctx({ integrity: 0.5, size: 'S', throughput: 1 }, 10))!;
    expect(big.tier).toBe(small.tier);
    expect(big.score).toBeGreaterThan(small.score);

    const near = p.evaluate(ctx({ integrity: 0.5, throughput: 3 }, 10))!;
    const far = p.evaluate(ctx({ integrity: 0.5, throughput: 3 }, 900))!;
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('compares sizes, course bands, named decay speeds and walls', () => {
    const p = compileRulebook(`
PRIORITY 1: bricks WHERE size >= M
PRIORITY 2: bricks WHERE course = deep
PRIORITY 3: bricks WHERE decayRate > fast
PRIORITY 4: bricks WHERE wall = E
DEFAULT: none
`);
    expect(p.evaluate(ctx({ size: 'L' }))?.tier).toBe(0);
    expect(p.evaluate(ctx({ size: 'S' }, 10, 'deep'))?.tier).toBe(1);
    expect(p.evaluate(ctx({ size: 'S', decayRate: 0.9 }))?.tier).toBe(2);
    expect(p.evaluate(ctx({ size: 'S', wallIds: ['E'] }))?.tier).toBe(3);
    expect(p.evaluate(ctx({ size: 'S' }))).toBeNull();
  });

  it('supports OR, NOT and parentheses', () => {
    const p = compileRulebook('PRIORITY 1: bricks WHERE (hub OR keep) AND NOT intact');
    expect(p.evaluate(ctx({ hub: true, integrity: 0.2 }))?.tier).toBe(0);
    expect(p.evaluate(ctx({ keep: true, integrity: 0.2 }))?.tier).toBe(0);
    expect(p.evaluate(ctx({ hub: true, integrity: 1 }))).toBeNull();
    expect(p.evaluate(ctx({ integrity: 0.2 }))).toBeNull();
  });

  it('accepts the readable shorthand selectors', () => {
    const p = compileRulebook('DEFAULT: nearest cracked brick');
    expect(p.evaluate(ctx({ integrity: 0.2 }))?.tier).toBe(0);
    expect(p.evaluate(ctx({ integrity: 0.5 }))).toBeNull();
    expect(compileRulebook('DEFAULT: none').evaluate(ctx({ integrity: 0 }))).toBeNull();
    expect(compileRulebook('DEFAULT: largest hub brick').evaluate(ctx({ hub: true, integrity: 0.5 }))?.tier).toBe(0);
  });

  it('rejects bad input with a line number', () => {
    const bad = tryCompileRulebook('PRIORITY 1: bricks WHERE hub\nPRIORITY 2: bricks WHERE frobnicate');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.line).toBe(2);
      expect(bad.error).toContain('frobnicate');
    }
    expect(() => compileRulebook('PRIORITY 1: bricks WHERE integrity')).toThrow(PolicyParseError);
    expect(() => compileRulebook('SUMMON masons')).toThrow(PolicyParseError);
    expect(() => compileRulebook('PRIORITY 1: bricks WHERE hub\nPRIORITY 1: bricks WHERE keep')).toThrow(
      /defined twice/,
    );
    expect(() => compileRulebook('# nothing but a comment')).toThrow(PolicyParseError);
  });

  it('compiles every shipped preset', () => {
    for (const p of PRESETS) {
      const policy = presetPolicy(p.id);
      expect(policy.name).toBe(p.name);
      expect(policy.source).toBe(p.source);
    }
  });
});
