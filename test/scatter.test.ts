import { describe, expect, it } from 'vitest';
import { getLevel, presetPolicy, runSim } from '../src/sim/index.js';
import { allocationScatter } from '../src/ui/scatter.js';

/**
 * The scatter is a pure function of the report card, so it can be checked without
 * a browser. What matters is not how it looks but what it CLAIMS: filled markers
 * where masonry went, hollow rings for the ignored set, and an ignored set that
 * grows as the crew shrinks.
 */
const card = (masonCount: number) =>
  runSim({ level: getLevel('cornerstones'), seed: 1, policy: presetPolicy('balanced'), masonCount })
    .report;

const hollow = (svg: string) => (svg.match(/fill="none"/g) ?? []).length;
const filled = (svg: string) => (svg.match(/fill="rgba\(232,163,61/g) ?? []).length;

describe('allocation scatter', () => {
  it('plots one marker per brick that receives traffic', () => {
    const c = card(16);
    const svg = allocationScatter(c);
    expect(svg).toContain('<svg');
    expect(hollow(svg) + filled(svg)).toBe(c.allocation.length);
  });

  it('grows the ignored set as the crew shrinks — the bandwidth sweep', () => {
    const rich = allocationScatter(card(16));
    const lean = allocationScatter(card(8));
    const poor = allocationScatter(card(4));
    expect(hollow(lean)).toBeGreaterThan(hollow(rich));
    expect(hollow(poor)).toBeGreaterThan(hollow(lean));
    // And the reverse for tended bricks: fewer masons, fewer bricks touched.
    expect(filled(poor)).toBeLessThan(filled(rich));
  });

  it('reports how much traffic the ignored set carries', () => {
    const svg = allocationScatter(card(4));
    expect(svg).toMatch(/\d+ of \d+ bricks were left alone, carrying \d+% of the traffic/);
  });

  it('degrades quietly when there is nothing to plot', () => {
    expect(allocationScatter({ allocation: [] } as never)).toBe('');
  });
});
