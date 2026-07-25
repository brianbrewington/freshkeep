import type { SimEvent } from './events.js';
import type { ReportCard } from './report.js';
import type { Sim } from './sim.js';

/**
 * Telemetry is a first-class feature, not an afterthought: this is research data.
 * Local only in v1 — localStorage plus a downloadable JSON file. Schema versioned.
 */
export const TELEMETRY_SCHEMA_VERSION = 1;

export interface TelemetryRun {
  schemaVersion: number;
  /** ISO timestamp, supplied by the caller — the sim itself stays pure and clock-free. */
  recordedAt: string;
  level: string;
  levelName: string;
  seed: number;
  mode: 'rulebook' | 'zones' | 'auction';
  policy: { kind: string; name: string; source: string };
  masonCount: number;
  zones: boolean;
  report: ReportCard;
  /** Timestamped breach events, always included. */
  breaches: Array<{ t: number; wall: string; course: number; column: number }>;
  /** Full event log, included only when asked for (it is large). */
  events?: SimEvent[];
}

export function buildTelemetry(
  sim: Sim,
  report: ReportCard,
  opts: { recordedAt: string; includeEvents?: boolean },
): TelemetryRun {
  const mode: 'rulebook' | 'zones' | 'auction' =
    sim.policy.kind === 'auction' ? 'auction' : sim.zonesEnabled ? 'zones' : 'rulebook';
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    recordedAt: opts.recordedAt,
    level: sim.level.id,
    levelName: sim.level.name,
    seed: sim.seed,
    mode,
    policy: { kind: sim.policy.kind, name: sim.policy.name, source: sim.policy.source },
    masonCount: sim.masonCountAtStart,
    zones: sim.zonesEnabled,
    report,
    breaches: sim.events
      .filter((e): e is Extract<SimEvent, { type: 'breach' }> => e.type === 'breach')
      .map((e) => ({ t: e.t, wall: e.wall, course: e.course, column: e.column })),
    ...(opts.includeEvents ? { events: sim.events } : {}),
  };
}

const STORAGE_KEY = 'freshkeep.runs.v1';
const MAX_STORED_RUNS = 200;

export function appendToLocalStorage(run: TelemetryRun): void {
  if (typeof localStorage === 'undefined') return;
  let runs: TelemetryRun[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) runs = JSON.parse(raw) as TelemetryRun[];
  } catch {
    runs = [];
  }
  runs.push(run);
  if (runs.length > MAX_STORED_RUNS) runs = runs.slice(-MAX_STORED_RUNS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    /* quota — drop the oldest half and try once more */
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(-Math.floor(MAX_STORED_RUNS / 2))));
    } catch {
      /* give up silently; telemetry must never break a run */
    }
  }
}

export function loadStoredRuns(): TelemetryRun[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TelemetryRun[]) : [];
  } catch {
    return [];
  }
}
