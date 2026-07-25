/**
 * The event log. Determinism is asserted against this: identical
 * (level, seed, policy, masonCount) must produce an identical log, forever.
 */

export type SimEvent =
  | { t: number; type: 'spawn'; raider: number; wall: string; course: number; column: number }
  | { t: number; type: 'repelled'; raider: number; wall: string; course: number; column: number; by: number }
  | { t: number; type: 'breach'; raider: number; wall: string; course: number; column: number }
  | { t: number; type: 'kingHit'; raider: number; damage: number; hp: number }
  | { t: number; type: 'rubble'; brick: number; wall: string }
  | { t: number; type: 'repairStart'; mason: number; brick: number; integrity: number; cosmetic: boolean }
  | { t: number; type: 'repairDone'; mason: number; brick: number; hub: boolean; cosmetic: boolean }
  | { t: number; type: 'interrupt'; mason: number; from: number | null; to: number }
  | { t: number; type: 'cull'; masons: number[]; remaining: number }
  | { t: number; type: 'end'; outcome: 'survived' | 'fallen'; hp: number };

/** Stable, compact serialization — the thing we hash in the determinism test. */
export function serializeEvents(events: SimEvent[]): string {
  return events
    .map((e) => {
      const t = e.t.toFixed(3);
      const rest = Object.keys(e)
        .filter((k) => k !== 't' && k !== 'type')
        .sort()
        .map((k) => `${k}=${JSON.stringify((e as Record<string, unknown>)[k])}`)
        .join(',');
      return `${t}|${e.type}|${rest}`;
    })
    .join('\n');
}
