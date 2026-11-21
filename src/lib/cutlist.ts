import type { ResolvedDivider } from '../types';

export interface Cut {
  /** letter label shown on the plan, e.g. "A" */
  label: string;
  ids: string[];
  length: number;
  qty: number;
  /** pins needed where this piece's ends join another divider */
  pins: number;
}

export interface StripPlan {
  strips: { cuts: { label: string; length: number }[]; used: number; waste: number }[];
  total: number;
}

export function labelFor(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** Group identical cut lengths (to 0.5 mm) and label them A, B, C... longest first. */
export function buildCutList(
  dividers: ResolvedDivider[],
  allowance: number,
  flutePitch = 0,
): { cuts: Cut[]; labelOf: Map<string, string> } {
  const groups = new Map<number, Cut>();
  for (const d of dividers) {
    let len = d.length + allowance;
    // TrekPak can only be cut on a flute: round to the nearest one.
    if (flutePitch > 0) len = Math.round(len / flutePitch) * flutePitch;
    const key = Math.round(len * 2) / 2;
    const pins = (d.a.kind === 'div' ? 1 : 0) + (d.b.kind === 'div' ? 1 : 0);
    const g = groups.get(key);
    if (g) {
      g.qty += 1;
      g.ids.push(d.uid);
      g.pins += pins;
    } else groups.set(key, { label: '', ids: [d.uid], length: key, qty: 1, pins });
  }
  const cuts = [...groups.values()].sort((a, b) => b.length - a.length);
  const labelOf = new Map<string, string>();
  cuts.forEach((c, i) => {
    c.label = labelFor(i);
    c.ids.forEach((id) => labelOf.set(id, c.label));
  });
  return { cuts, labelOf };
}

/** First-fit decreasing: how many stock strips to buy, and what to cut from each. */
export function planStrips(cuts: Cut[], stock: number, kerf = 1): StripPlan {
  const pieces = cuts.flatMap((c) => Array.from({ length: c.qty }, () => ({ label: c.label, length: c.length })));
  pieces.sort((a, b) => b.length - a.length);
  const strips: StripPlan['strips'] = [];
  for (const p of pieces) {
    if (p.length > stock) {
      strips.push({ cuts: [p], used: p.length, waste: 0 });
      continue;
    }
    const fit = strips.find((s) => s.used + kerf + p.length <= stock && s.used + p.length <= stock);
    if (fit) {
      fit.used += (fit.cuts.length ? kerf : 0) + p.length;
      fit.cuts.push(p);
      fit.waste = stock - fit.used;
    } else strips.push({ cuts: [p], used: p.length, waste: stock - p.length });
  }
  return { strips, total: pieces.reduce((s, p) => s + p.length, 0) };
}

export interface BuildStep {
  n: number;
  id: string;
  label: string;
  /** cut length including fit allowance */
  length: number;
  axis: 'h' | 'v';
  /** distance from the wall face (or perimeter panel) to the divider's near face */
  offset: number;
  offsetFrom: 'hinge' | 'left';
  /** what each end meets */
  ends: { a: string | null; b: string | null };
  pins: number;
}

/**
 * Order dividers so each goes in after anything it pins into (Kahn's algorithm):
 * wall-to-wall pieces first, then the pieces that join them.
 */
export function buildSteps(dividers: ResolvedDivider[], labelOf: Map<string, string>, allowance: number, inset: number): BuildStep[] {
  const byId = new Map(dividers.map((d) => [d.uid, d]));
  const deps = (d: ResolvedDivider) =>
    [d.a, d.b].flatMap((e) => (e.kind === 'div' && byId.has(e.id) ? [e.id] : []));
  const placed = new Set<string>();
  const order: ResolvedDivider[] = [];
  let remaining = [...dividers];
  while (remaining.length) {
    const ready = remaining.filter((d) => deps(d).every((id) => placed.has(id)));
    // Longest first among the ready ones; if a loop blocks progress, just take what's left.
    const batch = (ready.length ? ready : remaining).sort((x, y) => y.length - x.length);
    const next = batch[0];
    order.push(next);
    placed.add(next.uid);
    remaining = remaining.filter((d) => d !== next);
  }
  return order.map((d, i) => {
    const t = d.rect.h < d.rect.w ? d.rect.h : d.rect.w;
    const near = d.pos - t / 2 - inset;
    const endName = (e: ResolvedDivider['a']) => (e.kind === 'div' ? labelOf.get(e.id) ?? '?' : null);
    return {
      n: i + 1,
      id: d.uid,
      label: labelOf.get(d.uid) ?? '?',
      length: d.length + allowance,
      axis: d.axis,
      offset: near,
      offsetFrom: d.axis === 'h' ? 'hinge' : 'left',
      ends: { a: endName(d.a), b: endName(d.b) },
      pins: (d.a.kind === 'div' ? 1 : 0) + (d.b.kind === 'div' ? 1 : 0),
    };
  });
}
