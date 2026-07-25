import {
  ALL_LEVELS,
  BASICS,
  LEVELS,
  SANDBOX,
  DEFAULT_WEIGHTS,
  PRESETS,
  SOLUTIONS,
  Sim,
  buildReport,
  buildTelemetry,
  appendToLocalStorage,
  compileAuction,
  getLevel,
  resolveConfig,
  runSim,
  tryCompileRulebook,
  type AuctionWeights,
  type LevelSpec,
  type Policy,
  type ReportCard,
} from '../sim/index.js';
import { Renderer } from './render.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new Renderer(canvas);

type Mode = 'rulebook' | 'zones' | 'auction';

const ui = {
  level: $<HTMLSelectElement>('level'),
  mode: $<HTMLSelectElement>('mode'),
  preset: $<HTMLSelectElement>('preset'),
  editor: $<HTMLTextAreaElement>('editor'),
  err: $<HTMLParagraphElement>('err'),
  blurb: $<HTMLParagraphElement>('blurb'),
  pathology: $<HTMLParagraphElement>('pathology'),
  masonsRange: $<HTMLInputElement>('masons-range'),
  masonsOut: $<HTMLOutputElement>('masons-out'),
  seed: $<HTMLInputElement>('seed'),
  apply: $<HTMLButtonElement>('apply'),
  play: $<HTMLButtonElement>('play'),
  restart: $<HTMLButtonElement>('restart'),
  showTasks: $<HTMLInputElement>('show-tasks'),
  showBids: $<HTMLInputElement>('show-bids'),
  showDemand: $<HTMLInputElement>('show-demand'),
  bidsWrap: $<HTMLLabelElement>('bids-wrap'),
  levelName: $<HTMLSpanElement>('level-name'),
  clock: $<HTMLSpanElement>('clock'),
  hp: $<HTMLElement>('hp'),
  breaches: $<HTMLElement>('breaches'),
  masons: $<HTMLElement>('masons'),
  wallBars: $<HTMLDivElement>('wall-bars'),
  overlay: $<HTMLDivElement>('overlay'),
  card: $<HTMLDivElement>('card'),
  rulebookUi: $<HTMLDivElement>('rulebook-ui'),
  auctionUi: $<HTMLDivElement>('auction-ui'),
  weights: $<HTMLDivElement>('weights'),
};

const state = {
  level: ALL_LEVELS[0],
  mode: 'rulebook' as Mode,
  seed: 1,
  masons: ALL_LEVELS[0].masons,
  weights: { ...DEFAULT_WEIGHTS } as AuctionWeights,
  speed: 1,
  playing: false,
  sim: null as Sim | null,
  reported: false,
};

// --- population ------------------------------------------------------------

function addLevelGroup(label: string, levels: LevelSpec[], numbered: boolean): void {
  const g = document.createElement('optgroup');
  g.label = label;
  levels.forEach((l, i) => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = numbered ? `${i + 1} — ${l.name}` : l.name;
    g.append(o);
  });
  ui.level.append(g);
}
addLevelGroup('The basics — one mason, one idea', BASICS, false);
addLevelGroup('The campaign', LEVELS, true);
addLevelGroup('Sandbox', [SANDBOX], false);

function populatePresets(levelId: string): void {
  ui.preset.replaceChildren();
  const group = document.createElement('optgroup');
  group.label = 'Presets (each loses at least one level)';
  for (const p of PRESETS) {
    const o = document.createElement('option');
    o.value = `preset:${p.id}`;
    o.textContent = p.name;
    group.append(o);
  }
  ui.preset.append(group);

  const sols = SOLUTIONS.filter((s) => s.level === levelId);
  if (sols.length) {
    const g2 = document.createElement('optgroup');
    g2.label = 'Worked solution for this level';
    for (const s of sols) {
      const o = document.createElement('option');
      o.value = `solution:${s.id}`;
      o.textContent = s.name;
      g2.append(o);
    }
    ui.preset.append(g2);
  }
}

for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof AuctionWeights>) {
  const row = document.createElement('div');
  row.className = 'weight';
  row.innerHTML = `<span>w_${key}</span><input type="range" min="0" max="3" step="0.1" value="${DEFAULT_WEIGHTS[key]}" /><output>${DEFAULT_WEIGHTS[key].toFixed(1)}</output>`;
  const range = row.querySelector('input')!;
  const out = row.querySelector('output')!;
  range.addEventListener('input', () => {
    state.weights[key] = Number(range.value);
    out.textContent = Number(range.value).toFixed(1);
    start();
  });
  ui.weights.append(row);
}

// --- policy ----------------------------------------------------------------

function currentPolicy(): Policy | null {
  if (state.mode === 'auction') return compileAuction(state.weights, 'AUCTION');
  const res = tryCompileRulebook(ui.editor.value, presetLabel());
  if (!res.ok) {
    ui.err.textContent = res.error;
    return null;
  }
  ui.err.textContent = '';
  return res.policy;
}

function presetLabel(): string {
  const opt = ui.preset.selectedOptions[0];
  return opt ? opt.textContent ?? 'custom' : 'custom';
}

function loadSelectedPreset(): void {
  const [kind, id] = ui.preset.value.split(':');
  const src =
    kind === 'preset'
      ? PRESETS.find((p) => p.id === id)?.source
      : SOLUTIONS.find((s) => s.id === id)?.source;
  ui.editor.value = src ?? '';
  ui.pathology.textContent =
    kind === 'preset'
      ? PRESETS.find((p) => p.id === id)?.pathology ?? ''
      : SOLUTIONS.find((s) => s.id === id)?.insight ?? '';
  currentPolicy();
}

// --- level / run lifecycle -------------------------------------------------

function selectLevel(spec: LevelSpec): void {
  state.level = spec;
  state.masons = spec.masons;
  ui.blurb.textContent = spec.blurb;
  ui.levelName.textContent = spec.name;
  ui.masonsRange.max = String(Math.max(24, spec.masons * 2));
  ui.masonsRange.value = String(spec.masons);
  ui.masonsOut.textContent = String(spec.masons);
  populatePresets(spec.id);
  // A teaching level opens on the policy that fails it: watch it lose, then load
  // the worked solution and watch the identical siege hold.
  if (spec.wrongPreset) ui.preset.value = `preset:${spec.wrongPreset}`;

  for (const opt of Array.from(ui.mode.options)) {
    opt.disabled = !spec.modes.includes(opt.value as Mode);
  }
  if (!spec.modes.includes(state.mode)) {
    state.mode = spec.forceZones ? 'zones' : 'rulebook';
    ui.mode.value = state.mode;
  }
  if (spec.forceZones) {
    state.mode = 'zones';
    ui.mode.value = 'zones';
  }
  applyMode();
  loadSelectedPreset();
  start();
}

function applyMode(): void {
  const auction = state.mode === 'auction';
  ui.rulebookUi.hidden = auction;
  ui.auctionUi.hidden = !auction;
  ui.bidsWrap.hidden = !auction;
  if (auction) ui.showBids.checked = true;
}

function start(): void {
  const policy = currentPolicy();
  if (!policy) return;
  state.sim = new Sim({
    level: state.level,
    seed: state.seed,
    policy,
    masonCount: state.masons,
    zones: state.mode === 'zones',
  });
  state.reported = false;
  ui.overlay.hidden = true;
  renderer.fit(state.sim.world);
  buildWallBars(state.sim);
  draw();
}

function buildWallBars(sim: Sim): void {
  ui.wallBars.replaceChildren();
  for (const w of sim.world.walls) {
    const el = document.createElement('div');
    el.className = 'wall-bar';
    el.dataset.wall = w.id;
    el.innerHTML = `<span>${w.name}</span><div class="track"><div class="fill"></div></div>`;
    ui.wallBars.append(el);
  }
}

/**
 * Freshness per wall, weighted by the traffic each brick actually carries AND by
 * rank. Without the rank term a deliberately abandoned deep course drags the bar
 * into the red while the wall is in fact answering almost every query it gets —
 * the bar would punish correct triage.
 */
function wallFreshness(sim: Sim, wallId: string): number {
  let num = 0;
  let den = 0;
  for (const b of sim.world.bricks) {
    if (!b.wallIds.includes(wallId)) continue;
    const w = Math.max(0.001, b.demandWeight) * sim.cfg.rankValue[sim.bandOf(b)];
    num += w * b.integrity;
    den += w;
  }
  return den > 0 ? num / den : 1;
}

// --- loop ------------------------------------------------------------------

let lastFrame = 0;
let accumulator = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const sim = state.sim;
  if (!sim) return;

  const elapsed = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
  lastFrame = now;

  if (state.playing && !sim.done) {
    accumulator += elapsed * state.speed;
    let guard = 0;
    while (accumulator >= sim.cfg.dt && !sim.done && guard++ < 600) {
      sim.step();
      accumulator -= sim.cfg.dt;
    }
  }

  draw();

  if (sim.done && !state.reported) {
    state.reported = true;
    state.playing = false;
    ui.play.textContent = '▶ Play';
    showReport(sim);
  }
}

function draw(): void {
  const sim = state.sim;
  if (!sim) return;
  renderer.draw(sim, {
    showTasks: ui.showTasks.checked,
    showBids: ui.showBids.checked,
    showDemand: ui.showDemand.checked,
  });

  const k = sim.world.king;
  ui.clock.textContent = `${sim.world.t.toFixed(1)}s / ${sim.level.durationSeconds}s`;
  ui.hp.textContent = `${Math.round(k.hp)}/${k.maxHp}`;
  ui.hp.classList.toggle('hurt', k.hp < k.maxHp * 0.35);
  ui.breaches.textContent = String(sim.totals.breaches);
  ui.masons.textContent = String(sim.world.masons.filter((m) => m.alive).length);

  for (const el of Array.from(ui.wallBars.children) as HTMLElement[]) {
    const f = wallFreshness(sim, el.dataset.wall!);
    const fill = el.querySelector('.fill') as HTMLElement;
    fill.style.width = `${(f * 100).toFixed(1)}%`;
    fill.style.background = f > 0.6 ? '#7fbf7f' : f > 0.35 ? '#d9b04a' : '#d05a4a';
  }
}

// --- report card -----------------------------------------------------------

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function showReport(sim: Sim): void {
  const c = buildReport(sim);
  appendToLocalStorage(buildTelemetry(sim, c, { recordedAt: new Date().toISOString() }));
  renderCard(c, sim);
  ui.overlay.hidden = false;
}

function renderCard(c: ReportCard, sim: Sim): void {
  const u = c.utilization;
  const wasted = u.repairingWeathered;
  const useful = Math.max(0, u.repairing - wasted);
  const byWall = Object.entries(c.breachesByWall).sort((a, b) => b[1] - a[1]);

  ui.card.innerHTML = `
    <h2 class="${c.outcome}">${c.outcome === 'survived' ? 'THE KINGDOM HOLDS' : 'THE KING HAS FALLEN'}</h2>
    <p class="sub">${c.levelName} · ${c.policyName}${c.zones ? ' · ZONES' : ''} · seed ${c.seed} · ${c.masonsAtStart}${c.masonsAtEnd !== c.masonsAtStart ? `→${c.masonsAtEnd}` : ''} masons · ${c.durationSeconds}s</p>
    <p class="roast">“${c.roast}”</p>
    <div class="grid">
      ${metric('King', `${c.kingHp}/${c.kingHpMax}`, '')}
      ${metric('Breaches', String(c.breaches), byWall.length ? byWall.map(([k, v]) => `${wallName(sim, k)} ${v}`).join(' · ') : 'nothing got through')}
      ${metric('Freshness-age', c.freshnessAge.toFixed(3), 'traffic-weighted staleness, lower is better')}
      ${metric('Hub repairs', c.hubRepairRatio.toFixed(3), `${c.hubRepairs} of ${c.repairsCompleted} — did you find the shared structure?`)}
      ${metric('Wasted attention', pct(wasted), `${c.cosmeticRepairs} cosmetic repairs`)}
      ${metric('Repelled', String(c.repelled), `of ${c.arrivals} arrivals`)}
    </div>
    <div class="bars">
      <div class="cap">Mason time</div>
      <div class="bar">
        <div class="seg" style="width:${u.idle * 100}%;background:#5b5344" title="idle">${u.idle > 0.08 ? `idle ${pct(u.idle)}` : ''}</div>
        <div class="seg" style="width:${u.traveling * 100}%;background:#8a7a5c" title="traveling">${u.traveling > 0.1 ? `traveling ${pct(u.traveling)}` : ''}</div>
        <div class="seg" style="width:${useful * 100}%;background:#7fbf7f" title="repairing">${useful > 0.1 ? `repairing ${pct(useful)}` : ''}</div>
        <div class="seg" style="width:${wasted * 100}%;background:#d05a4a" title="repairing weathered — wasted">${wasted > 0.08 ? `wasted ${pct(wasted)}` : ''}</div>
      </div>
    </div>
    <p class="teaches"><b>This level teaches:</b> ${c.teaches}</p>
    <div class="actions">
      <button class="primary" id="thesis-btn">Run this exact policy again with fewer masons</button>
      ${sim.level.forceZones ? '<button id="seam-btn">Replay the identical siege with one shared pool</button>' : ''}
      <button id="close-btn">Close</button>
    </div>`;

  $('close-btn').addEventListener('click', () => {
    ui.overlay.hidden = true;
  });
  $('thesis-btn').addEventListener('click', () => runThesis(c));
  const seam = document.getElementById('seam-btn');
  seam?.addEventListener('click', () => runSeamCompare(c));
}

function wallName(sim: Sim, id: string): string {
  return sim.world.wallsById[id]?.name ?? id;
}

function metric(label: string, value: string, note: string): string {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
}

/** The thesis button. Same policy, same seed, same siege, half the masons. */
function runThesis(prev: ReportCard): void {
  const btn = $<HTMLButtonElement>('thesis-btn');
  btn.disabled = true;
  btn.textContent = 'Running the identical siege…';
  setTimeout(() => {
    const policy = currentPolicy();
    if (!policy) return;
    const fewer = Math.max(1, Math.floor(prev.masonsAtStart / 2));
    const b = runSim({
      level: state.level,
      seed: state.seed,
      policy,
      masonCount: fewer,
      zones: state.mode === 'zones',
    }).report;
    renderComparison(
      'The one dial that matters',
      'Same policy. Same seed. The same raiders, in the same order. Half the masons.',
      prev,
      b,
      `${prev.masonsAtStart} masons`,
      `${fewer} masons`,
    );
  }, 30);
}

/** The Seam's A/B: identical siege, zone-locked crews vs one shared pool. */
function runSeamCompare(prev: ReportCard): void {
  const btn = $<HTMLButtonElement>('seam-btn');
  btn.disabled = true;
  btn.textContent = 'Running the identical siege…';
  setTimeout(() => {
    const policy = currentPolicy();
    if (!policy) return;
    const pooled = runSim({
      level: state.level,
      seed: state.seed,
      policy,
      masonCount: prev.masonsAtStart,
      zones: false,
    }).report;
    renderComparison(
      'The seam',
      'Same policy, same masons, same siege. The only change is that crews may now cross the line.',
      prev,
      pooled,
      'Zoned crews',
      'One shared pool',
    );
  }, 30);
}

function renderComparison(
  title: string,
  sub: string,
  a: ReportCard,
  b: ReportCard,
  aLabel: string,
  bLabel: string,
): void {
  const side = (c: ReportCard, label: string) => `
    <div class="side">
      <div class="o ${c.outcome === 'survived' ? 'survived-t' : 'fallen-t'}">${c.outcome === 'survived' ? 'HELD' : 'FELL'}</div>
      <div class="n">${label}</div>
      <div class="f">king ${c.kingHp}/${c.kingHpMax} · ${c.breaches} breaches</div>
      <div class="f">freshness-age ${c.freshnessAge.toFixed(3)}</div>
      <div class="f">idle ${pct(c.utilization.idle)}</div>
    </div>`;

  const flipped = a.outcome !== b.outcome;
  ui.card.innerHTML = `
    <h2>${title}</h2>
    <p class="sub">${sub}</p>
    <div class="thesis">
      <div class="cmp">${side(a, aLabel)}<div class="arrow">→</div>${side(b, bLabel)}</div>
      <p class="verdict">${
        flipped
          ? `Nothing about the policy changed. <b>The outcome did.</b>`
          : `Both runs ended the same way — but staleness moved ${a.freshnessAge.toFixed(3)} → ${b.freshnessAge.toFixed(3)} and breaches ${a.breaches} → ${b.breaches}.`
      }</p>
    </div>
    <div class="actions">
      <button class="primary" id="back-btn">Back to the report card</button>
      <button id="close2-btn">Close</button>
    </div>`;
  $('back-btn').addEventListener('click', () => {
    if (state.sim) renderCard(a, state.sim);
  });
  $('close2-btn').addEventListener('click', () => {
    ui.overlay.hidden = true;
  });
}

// --- events ----------------------------------------------------------------

ui.level.addEventListener('change', () => selectLevel(getLevel(ui.level.value)));
ui.mode.addEventListener('change', () => {
  state.mode = ui.mode.value as Mode;
  applyMode();
  start();
});
ui.preset.addEventListener('change', () => {
  loadSelectedPreset();
  start();
});
ui.editor.addEventListener('input', () => currentPolicy());
for (const el of [ui.showTasks, ui.showBids, ui.showDemand]) {
  el.addEventListener('change', draw);
}
ui.masonsRange.addEventListener('input', () => {
  state.masons = Number(ui.masonsRange.value);
  ui.masonsOut.textContent = ui.masonsRange.value;
});
ui.masonsRange.addEventListener('change', start);
ui.seed.addEventListener('change', () => {
  state.seed = Number(ui.seed.value);
  start();
});
ui.apply.addEventListener('click', () => {
  start();
  state.playing = true;
  ui.play.textContent = '❚❚ Pause';
});
ui.play.addEventListener('click', () => {
  if (state.sim?.done) start();
  state.playing = !state.playing;
  ui.play.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
});
ui.restart.addEventListener('click', () => {
  start();
  state.playing = false;
  ui.play.textContent = '▶ Play';
});
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.speed'))) {
  btn.addEventListener('click', () => {
    state.speed = Number(btn.dataset.speed);
    for (const b of Array.from(document.querySelectorAll('.speed'))) b.classList.remove('on');
    btn.classList.add('on');
  });
}
window.addEventListener('resize', () => {
  if (state.sim) renderer.fit(state.sim.world);
});

// Keep the canvas honest about its own size as the layout settles.
new ResizeObserver(() => {
  if (state.sim) renderer.fit(state.sim.world);
}).observe(canvas.parentElement!);

// --- console handle --------------------------------------------------------
// The game doubles as an experiment platform, so the live sim is reachable from
// the console: FRESHKEEP.advance(1200) steps 40s, FRESHKEEP.sim.totals, etc.
declare global {
  interface Window {
    FRESHKEEP: {
      readonly sim: Sim | null;
      state: typeof state;
      advance(ticks: number): Sim | null;
      restart(): void;
      runSim: typeof runSim;
    };
  }
}
window.FRESHKEEP = {
  get sim() {
    return state.sim;
  },
  state,
  advance(ticks: number) {
    for (let i = 0; i < ticks && state.sim && !state.sim.done; i++) state.sim.step();
    draw();
    return state.sim;
  },
  restart: start,
  runSim,
};

// --- go --------------------------------------------------------------------

selectLevel(BASICS[0]);
resolveConfig(state.level);
requestAnimationFrame(frame);
