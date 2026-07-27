import type { EvalCtx, Ordering, Predicate, Tier, Policy } from './ir.js';
import { ORDERINGS, ORDERING_NAMES, policyFromTiers } from './ir.js';
import { DAMAGE_THRESHOLDS, damageState } from '../config.js';

/**
 * Mode 1 — Rulebook: a tiny declarative priority DSL.
 * Designed for legibility over power. This is a teaching tool, not a language.
 *
 *   # comments start with a hash
 *   PRIORITY 1: bricks WHERE hub AND integrity < 0.5
 *   PRIORITY 2: bricks WHERE course = top AND integrity < 0.4
 *   PRIORITY 3: bricks WHERE decayRate > fast AND size >= M
 *   DEFAULT:    nearest cracked brick
 *   INTERRUPT WHEN any brick integrity < 0.15 AND distance < 30
 *   IGNORE weathered
 */

export class PolicyParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'PolicyParseError';
  }
}

// --- Tokenizer ------------------------------------------------------------

type Tok = { t: 'ident' | 'num' | 'op' | 'lp' | 'rp'; v: string };

function tokenize(src: string, line: number): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { toks.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rp', v: c }); i++; continue; }
    if ('<>=!'.includes(c)) {
      let op = c;
      if (src[i + 1] === '=') { op += '='; i++; }
      i++;
      toks.push({ t: 'op', v: op });
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      toks.push({ t: 'num', v: src.slice(i, j).replace(/_/g, '') });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_\-]/.test(src[j])) j++;
      toks.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new PolicyParseError(`unexpected character '${c}'`, line);
  }
  return toks;
}

// --- Fields and values ----------------------------------------------------

const SIZE_ORD: Record<string, number> = { s: 0, m: 1, l: 2 };
const BAND_ORD: Record<string, number> = { top: 0, mid: 1, middle: 1, deep: 2 };

const NUMERIC_FIELDS: Record<string, (c: EvalCtx) => number> = {
  // BELIEF, always. A policy can only act on what is observable; there is
  // deliberately no way to ask for the hidden truth.
  integrity: (c) => c.brick.belief,
  damage: (c) => 1 - c.brick.belief,
  staleness: (c) => 1 - c.brick.belief,
  /** Seconds since a mason last finished work here. */
  age: (c) => Math.max(0, c.now - c.brick.lastSeen),
  decayrate: (c) => c.brick.decayRate,
  decay: (c) => c.brick.decayRate,
  throughput: (c) => c.brick.throughput,
  /**
   * `traffic` / `arc` is the brick's ANGULAR WIDTH — its share of the raiders
   * arriving on this wall. It used to alias `throughput`, i.e. the size class,
   * which is precisely the fallacy The Bubble Trap exists to break: a sliver of a
   * brick can be size L and answer almost nothing. Arc is the honest signal and,
   * unlike a hidden weight, the player can see it.
   *
   * It is still only a PROXY for real demand: when a level peaks its arrivals
   * into lobes, the traffic goes where the lobes are, not where the arc is.
   * That gap is the lesson, not a bug.
   */
  traffic: (c) => c.brick.angSpan,
  arc: (c) => c.brick.angSpan,
  distance: (c) => c.distance,
  course: (c) => c.brick.course,
  size: (c) => SIZE_ORD[c.brick.size.toLowerCase()],
};

const BOOLEAN_FIELDS: Record<string, Predicate> = {
  hub: (c) => c.brick.hub,
  spare: (c) => c.brick.spare,
  keep: (c) => c.brick.keep,
  intact: (c) => damageState(c.brick.belief) === 'intact',
  weathered: (c) => damageState(c.brick.belief) === 'weathered',
  cracked: (c) => damageState(c.brick.belief) === 'cracked',
  rubble: (c) => damageState(c.brick.belief) === 'rubble',
  /** Anything not at full integrity. */
  damaged: (c) => c.brick.belief < 1,
  /** Structurally passable-ish: cracked or rubble. What actually loses you the game. */
  structural: (c) => c.brick.belief < DAMAGE_THRESHOLDS.weathered,
  top: (c) => c.band === 'top',
  mid: (c) => c.band === 'mid',
  deep: (c) => c.band === 'deep',
  any: () => true,
  all: () => true,
  brick: () => true,
  bricks: () => true,
};

/** A comparison's right-hand side, resolved at eval time (named speeds depend on config). */
function valueFn(tok: Tok, field: string, line: number): (c: EvalCtx) => number {
  if (tok.t === 'num') {
    const n = Number(tok.v);
    if (!Number.isFinite(n)) throw new PolicyParseError(`bad number '${tok.v}'`, line);
    return () => n;
  }
  const v = tok.v.toLowerCase();
  if (field === 'size') {
    if (!(v in SIZE_ORD)) throw new PolicyParseError(`size must be S, M or L (got '${tok.v}')`, line);
    return () => SIZE_ORD[v];
  }
  if (field === 'course') {
    if (!(v in BAND_ORD)) throw new PolicyParseError(`course must be top, mid, deep or a number`, line);
    return () => BAND_ORD[v];
  }
  if (field === 'decayrate' || field === 'decay') {
    const named = { slow: 'slow', medium: 'medium', fast: 'fast' } as const;
    if (v in named) return (c) => c.cfg.decayNamed[v as 'slow' | 'medium' | 'fast'];
    throw new PolicyParseError(`decayRate must be slow, medium, fast or a number`, line);
  }
  throw new PolicyParseError(`'${tok.v}' is not a value ${field} can be compared to`, line);
}

function compare(op: string, left: (c: EvalCtx) => number, right: (c: EvalCtx) => number, line: number): Predicate {
  switch (op) {
    case '<': return (c) => left(c) < right(c);
    case '<=': return (c) => left(c) <= right(c);
    case '>': return (c) => left(c) > right(c);
    case '>=': return (c) => left(c) >= right(c);
    case '=':
    case '==': return (c) => left(c) === right(c);
    case '!=': return (c) => left(c) !== right(c);
    default: throw new PolicyParseError(`unknown operator '${op}'`, line);
  }
}

// --- Expression parser (recursive descent) --------------------------------

class Parser {
  private i = 0;
  constructor(private toks: Tok[], private line: number) {}

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private next(): Tok | undefined { return this.toks[this.i++]; }
  private isKeyword(k: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'ident' && t.v.toLowerCase() === k;
  }

  atEnd(): boolean { return this.i >= this.toks.length; }

  parseExpr(): Predicate {
    let left = this.parseTerm();
    while (this.isKeyword('or')) {
      this.next();
      const right = this.parseTerm();
      const l = left;
      left = (c) => l(c) || right(c);
    }
    return left;
  }

  private parseTerm(): Predicate {
    let left = this.parseFactor();
    while (this.isKeyword('and')) {
      this.next();
      const right = this.parseFactor();
      const l = left;
      left = (c) => l(c) && right(c);
    }
    return left;
  }

  private parseFactor(): Predicate {
    if (this.isKeyword('not')) {
      this.next();
      const inner = this.parseFactor();
      return (c) => !inner(c);
    }
    const t = this.peek();
    if (!t) throw new PolicyParseError('expected a condition', this.line);
    if (t.t === 'lp') {
      this.next();
      const inner = this.parseExpr();
      const close = this.next();
      if (!close || close.t !== 'rp') throw new PolicyParseError('missing )', this.line);
      return inner;
    }
    if (t.t !== 'ident') throw new PolicyParseError(`expected a field name, got '${t.v}'`, this.line);
    this.next();
    const name = t.v.toLowerCase();
    const nxt = this.peek();
    if (nxt && nxt.t === 'op') {
      this.next();
      const valTok = this.next();
      if (!valTok) throw new PolicyParseError(`expected a value after '${nxt.v}'`, this.line);
      if (!(name in NUMERIC_FIELDS)) {
        if (name === 'wall') {
          if (nxt.v !== '=' && nxt.v !== '==' && nxt.v !== '!=') {
            throw new PolicyParseError(
              `walls have no order, so '${nxt.v}' means nothing here — use wall = ${valTok.v} or wall != ${valTok.v}`,
              this.line,
            );
          }
          const wid = valTok.v;
          const eq = (c: EvalCtx) => c.brick.wallIds.includes(wid);
          return nxt.v === '!=' ? (c) => !eq(c) : eq;
        }
        throw new PolicyParseError(`'${t.v}' cannot be compared (it is a yes/no property)`, this.line);
      }
      // `course = top` compares bands, `course < 2` compares indices.
      let left = NUMERIC_FIELDS[name];
      if (name === 'course' && valTok.t === 'ident') {
        left = (c) => BAND_ORD[c.band] ?? c.brick.course;
      }
      return compare(nxt.v, left, valueFn(valTok, name, this.line), this.line);
    }
    if (name in BOOLEAN_FIELDS) return BOOLEAN_FIELDS[name];
    if (name in NUMERIC_FIELDS) {
      throw new PolicyParseError(`'${t.v}' needs a comparison, e.g. ${t.v} < 0.5`, this.line);
    }
    throw new PolicyParseError(`unknown property '${t.v}'`, this.line);
  }
}

// --- Selector clauses -----------------------------------------------------

/** Strip an optional leading `bricks WHERE` / `brick WHERE`. */
function stripBricksWhere(words: string[]): string[] {
  if (words.length >= 2 && /^bricks?$/i.test(words[0]) && /^where$/i.test(words[1])) {
    return words.slice(2);
  }
  if (words.length >= 1 && /^where$/i.test(words[0])) return words.slice(1);
  return words;
}

/** Pull a trailing `BY <ordering>` off a clause. */
function splitBy(words: string[], line: number): { body: string[]; order: Ordering | null } {
  const idx = words.findIndex((w) => /^by$/i.test(w));
  if (idx === -1) return { body: words, order: null };
  const orderWords = words.slice(idx + 1).join(' ').toLowerCase().trim();
  const order = ORDERINGS[orderWords];
  if (!order) {
    throw new PolicyParseError(
      `unknown ordering '${orderWords}'. Try: ${ORDERING_NAMES.join(', ')}`,
      line,
    );
  }
  return { body: words.slice(0, idx), order };
}

/**
 * Parse a selector clause, accepting either full syntax
 * (`bricks WHERE hub AND integrity < 0.5 BY largest`)
 * or the readable shorthand (`nearest cracked brick`).
 */
function parseSelector(clause: string, line: number): { match: Predicate; order: Ordering } {
  const words = clause.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new PolicyParseError('empty rule', line);
  if (words.length === 1 && /^none$/i.test(words[0])) {
    return { match: () => false, order: ORDERINGS.nearest };
  }

  const { body, order: byOrder } = splitBy(words, line);
  const stripped = stripBricksWhere(body);
  const hadWhere = stripped.length !== body.length;

  if (hadWhere) {
    const p = new Parser(tokenize(stripped.join(' '), line), line);
    const match = p.parseExpr();
    if (!p.atEnd()) throw new PolicyParseError('trailing text after the condition', line);
    return { match, order: byOrder ?? ORDERINGS.nearest };
  }

  // Shorthand: [ordering] adjective* brick(s)
  let rest = stripped.slice();
  let order = byOrder;
  if (!order) {
    // Longest ordering phrase wins ("most damaged" before "most").
    for (const n of [...ORDERING_NAMES].sort((a, b) => b.length - a.length)) {
      const w = n.split(' ');
      if (rest.length >= w.length && rest.slice(0, w.length).join(' ').toLowerCase() === n) {
        order = ORDERINGS[n];
        rest = rest.slice(w.length);
        break;
      }
    }
  }
  rest = rest.filter((w) => !/^(brick|bricks|the|a)$/i.test(w));

  if (rest.length === 0) {
    return { match: () => true, order: order ?? ORDERINGS.nearest };
  }

  // Any remaining words are either adjectives or a full expression.
  const looksLikeExpr = /[<>=()]/.test(rest.join(' ')) || rest.some((w) => /^(and|or|not)$/i.test(w));
  if (looksLikeExpr) {
    const p = new Parser(tokenize(rest.join(' '), line), line);
    const match = p.parseExpr();
    if (!p.atEnd()) throw new PolicyParseError('trailing text after the condition', line);
    return { match, order: order ?? ORDERINGS.nearest };
  }

  const preds: Predicate[] = rest.map((w) => {
    const key = w.toLowerCase();
    if (!(key in BOOLEAN_FIELDS)) {
      throw new PolicyParseError(`don't know what a '${w}' brick is`, line);
    }
    return BOOLEAN_FIELDS[key];
  });
  return {
    match: (c) => preds.every((p) => p(c)),
    order: order ?? ORDERINGS.nearest,
  };
}

// --- Line-oriented compiler ----------------------------------------------

export function compileRulebook(source: string, name = 'custom'): Policy {
  const lines = source.split(/\r?\n/);
  const priorities: Array<{ n: number; tier: Tier }> = [];
  const interrupts: Predicate[] = [];
  const ignores: Predicate[] = [];
  let fallback: { match: Predicate; order: Ordering } | null = null;

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const text = raw.replace(/#.*$/, '').trim();
    if (!text) return;

    let m = /^PRIORITY\s+(\d+)\s*:?\s*(.*)$/i.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (priorities.some((p) => p.n === n)) {
        throw new PolicyParseError(`PRIORITY ${n} is defined twice`, lineNo);
      }
      const sel = parseSelector(m[2], lineNo);
      priorities.push({ n, tier: { index: n, label: `PRIORITY ${n}`, match: sel.match, order: sel.order } });
      return;
    }

    m = /^DEFAULT\s*:?\s*(.*)$/i.exec(text);
    if (m) {
      if (fallback) throw new PolicyParseError('DEFAULT is defined twice', lineNo);
      fallback = parseSelector(m[1], lineNo);
      return;
    }

    m = /^INTERRUPT(?:\s+WHEN)?\s*:?\s*(.*)$/i.exec(text);
    if (m) {
      // `any brick <expr>` reads well; the `any brick` part is decoration.
      const body = m[1].replace(/^\s*(any|some)\s+bricks?\s+/i, '');
      const p = new Parser(tokenize(body, lineNo), lineNo);
      const pred = p.parseExpr();
      if (!p.atEnd()) throw new PolicyParseError('trailing text after the interrupt condition', lineNo);
      interrupts.push(pred);
      return;
    }

    m = /^IGNORE\s*:?\s*(.*)$/i.exec(text);
    if (m) {
      const body = m[1].trim();
      if (/^none$/i.test(body)) return;
      const p = new Parser(tokenize(stripBricksWhere(body.split(/\s+/)).join(' '), lineNo), lineNo);
      const pred = p.parseExpr();
      if (!p.atEnd()) throw new PolicyParseError('trailing text after IGNORE', lineNo);
      ignores.push(pred);
      return;
    }

    throw new PolicyParseError(
      `don't understand '${text.split(/\s+/)[0]}'. Lines start with PRIORITY, DEFAULT, INTERRUPT or IGNORE`,
      lineNo,
    );
  });

  if (priorities.length === 0 && !fallback) {
    throw new PolicyParseError('a rulebook needs at least one PRIORITY or a DEFAULT', 1);
  }

  priorities.sort((a, b) => a.n - b.n);
  const tiers: Tier[] = priorities.map((p, i) => ({ ...p.tier, index: i }));
  if (fallback) {
    const fb: { match: Predicate; order: Ordering } = fallback;
    tiers.push({ index: tiers.length, label: 'DEFAULT', match: fb.match, order: fb.order });
  }

  const ignore: Predicate | null =
    ignores.length === 0 ? null : (c) => ignores.some((p) => p(c));

  return policyFromTiers(name, source, tiers, ignore, interrupts);
}

/** Non-throwing variant for the editor UI. */
export function tryCompileRulebook(
  source: string,
  name = 'custom',
): { ok: true; policy: Policy } | { ok: false; error: string; line: number } {
  try {
    return { ok: true, policy: compileRulebook(source, name) };
  } catch (e) {
    if (e instanceof PolicyParseError) return { ok: false, error: e.message, line: e.line };
    return { ok: false, error: String(e), line: 0 };
  }
}
