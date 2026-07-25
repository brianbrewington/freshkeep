import { describe, expect, it } from 'vitest';
import {
  Sim,
  buildReport,
  buildTelemetry,
  compileAuction,
  DEFAULT_WEIGHTS,
  getLevel,
  hashString,
  presetPolicy,
  serializeEvents,
  TELEMETRY_SCHEMA_VERSION,
} from '../src/sim/index.js';

function logHash(levelId: string, seed: number, presetId: string, masons?: number, zones?: boolean): string {
  const sim = new Sim({
    level: getLevel(levelId),
    seed,
    policy: presetPolicy(presetId),
    masonCount: masons,
    zones,
  }).run();
  return hashString(serializeEvents(sim.events));
}

describe('determinism — identical (seed, policy, masonCount) → identical event log', () => {
  it('reproduces the same log across runs of the same configuration', () => {
    for (const level of ['tutorial', 'cornerstones', 'culling']) {
      const a = logHash(level, 42, 'balanced');
      const b = logHash(level, 42, 'balanced');
      expect(b, `level ${level}`).toBe(a);
    }
  });

  it('produces a different log for a different seed', () => {
    expect(logHash('cornerstones', 1, 'balanced')).not.toBe(logHash('cornerstones', 2, 'balanced'));
  });

  it('produces a different log for a different policy', () => {
    expect(logHash('cornerstones', 1, 'balanced')).not.toBe(logHash('cornerstones', 1, 'biggest'));
  });

  it('produces a different log for a different mason count', () => {
    expect(logHash('cornerstones', 1, 'balanced', 16)).not.toBe(
      logHash('cornerstones', 1, 'balanced', 8),
    );
  });

  it('is deterministic in auction mode too', () => {
    const run = () =>
      new Sim({
        level: getLevel('culling'),
        seed: 9,
        policy: compileAuction(DEFAULT_WEIGHTS),
      }).run();
    expect(hashString(serializeEvents(run().events))).toBe(hashString(serializeEvents(run().events)));
  });

  it('never teleports a mason: per-tick displacement is bounded by speed * dt', () => {
    const sim = new Sim({ level: getLevel('long-walk'), seed: 3, policy: presetPolicy('biggest') });
    const last = new Map<number, { x: number; y: number }>();
    let maxStep = 0;
    while (!sim.done) {
      sim.step();
      for (const m of sim.world.masons) {
        if (!m.alive) continue;
        const prev = last.get(m.id);
        if (prev) maxStep = Math.max(maxStep, Math.hypot(m.x - prev.x, m.y - prev.y));
        last.set(m.id, { x: m.x, y: m.y });
      }
    }
    const bound = sim.cfg.masonSpeed * sim.cfg.dt;
    expect(maxStep).toBeLessThanOrEqual(bound + 1e-9);
    expect(maxStep).toBeGreaterThan(0);
  });
});

describe('telemetry', () => {
  it('exports a complete run as valid versioned JSON', () => {
    const sim = new Sim({ level: getLevel('cornerstones'), seed: 5, policy: presetPolicy('balanced') }).run();
    const run = buildTelemetry(sim, buildReport(sim), {
      recordedAt: '2026-07-24T00:00:00.000Z',
      includeEvents: true,
    });
    const round = JSON.parse(JSON.stringify(run));

    expect(round.schemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
    expect(round.level).toBe('cornerstones');
    expect(round.seed).toBe(5);
    expect(round.mode).toBe('rulebook');
    // The full policy text is recorded verbatim — the run is reproducible from this alone.
    expect(round.policy.source).toContain('PRIORITY 1');
    expect(round.masonCount).toBeGreaterThan(0);
    expect(Array.isArray(round.breaches)).toBe(true);
    expect(round.events.length).toBeGreaterThan(0);
    expect(round.events.at(-1).type).toBe('end');
    for (const b of round.breaches) {
      expect(typeof b.t).toBe('number');
      expect(typeof b.wall).toBe('string');
    }
  });
});
