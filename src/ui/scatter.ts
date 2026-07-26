import type { ReportCard } from '../sim/index.js';

/**
 * Where the masonry went, on the two axes that decide whether it was worth
 * going. Axes are mean times — mean change time across, mean time between
 * arrivals up — so the busy, fast-turning bricks sit bottom-left and the quiet,
 * stable ones top-right. Filled = you spent time there; hollow = you ignored it.
 *
 * The shape to look for is the ignored set: as the crew shrinks, the hollow
 * region should grow out of the top-left — fast-changing bricks nobody asks for,
 * which are exactly the ones that look most alarming and are least worth saving.
 */
export function allocationScatter(c: ReportCard): string {
  const pts = c.allocation;
  if (pts.length < 2) return '';
  const W = 300;
  const H = 190;
  const pad = 26;

  const mct = (p: (typeof pts)[number]) => 1 / Math.max(p.changeRate, 1e-6);
  const mta = (p: (typeof pts)[number]) => 1 / Math.max(p.arrivalRate, 1e-6);
  const cap = (vals: number[]) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.92)] * 1.15 || 1;
  };
  const xMax = cap(pts.map(mct));
  const yMax = cap(pts.map(mta));
  const maxSec = Math.max(...pts.map((p) => p.seconds), 1e-6);

  const px = (v: number) => pad + (Math.min(v, xMax) / xMax) * (W - pad - 8);
  const py = (v: number) => H - pad - (Math.min(v, yMax) / yMax) * (H - pad - 10);

  const dots = pts
    .map((p) => {
      const share = p.seconds / maxSec;
      const r = 2.2 + Math.sqrt(share) * 6;
      const x = px(mct(p)).toFixed(1);
      const y = py(mta(p)).toFixed(1);
      return share < 0.02
        ? `<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="#6b5b48" stroke-width="1"/>`
        : `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="rgba(232,163,61,${(0.2 + share * 0.65).toFixed(2)})" stroke="rgba(232,163,61,0.8)" stroke-width="0.7"/>`;
    })
    .join('');

  const ignored = pts.filter((p) => p.seconds / maxSec < 0.02);
  const ignoredTraffic = ignored.reduce((s, p) => s + p.arrivalRate, 0);
  const allTraffic = pts.reduce((s, p) => s + p.arrivalRate, 0);

  return `<div class="bars">
    <div class="cap">Where the masonry went</div>
    <svg viewBox="0 0 ${W} ${H}" class="scatter" role="img">
      <line x1="${pad}" y1="${H - pad}" x2="${W - 4}" y2="${H - pad}" stroke="#33291e"/>
      <line x1="${pad}" y1="6" x2="${pad}" y2="${H - pad}" stroke="#33291e"/>
      ${dots}
      <text x="${W - 6}" y="${H - pad + 14}" text-anchor="end" fill="#7a6f5c" font-size="9">slower to change →</text>
      <text x="${pad - 6}" y="12" text-anchor="end" fill="#7a6f5c" font-size="9" transform="rotate(-90 ${pad - 6} 12)">less traffic →</text>
    </svg>
    <p class="note">${ignored.length} of ${pts.length} bricks were left alone, carrying ${((ignoredTraffic / (allTraffic || 1)) * 100).toFixed(0)}% of the traffic. Hollow rings are the ignored set — shrink the crew and watch it grow.</p>
  </div>`;
}
