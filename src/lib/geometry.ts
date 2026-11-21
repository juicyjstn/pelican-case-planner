import type { CaseSpec, Divider, DividerEnd, Layout, PlacedItem, Rect, ResolvedDivider } from '../types';
import { CASES } from '../data/cases';

const EPS = 0.5;

export function uid(prefix = 'x'): string {
  return prefix + Math.random().toString(36).slice(2, 9);
}

export function getCase(layout: Layout): CaseSpec {
  if (layout.caseId === 'custom' && layout.customCase) {
    return { id: 'custom', model: 'Custom', line: 'Custom', trekpak: true, ...layout.customCase };
  }
  return CASES.find((c) => c.id === layout.caseId) ?? CASES[0];
}

/** Base (bottom shell) depth; falls back to total minus lid when not published. */
export function baseDepth(c: CaseSpec): number {
  if (c.base != null) return c.base;
  return c.d - (c.lid ?? 0);
}

/** Thickness of the TrekPak perimeter lining, when that style is active. */
export function wallInset(layout: Layout): number {
  return layout.style === 'trekpak' ? layout.settings.perimeter : 0;
}

/** Divider height: user override, else Pelican's TrekPak height for the case, else base depth less floor pad. */
export function dividerHeight(layout: Layout, c: CaseSpec): number {
  if (layout.settings.dividerHeight > 0) return layout.settings.dividerHeight;
  if (layout.style === 'trekpak' && c.tpHeight) return c.tpHeight;
  return Math.max(10, baseDepth(c) - layout.settings.floorPad);
}

export function footprint(it: Pick<PlacedItem, 'gw' | 'gd' | 'gh' | 'orient' | 'rot'>) {
  let fw: number, fd: number, fh: number;
  if (it.orient === 'flat') [fw, fd, fh] = [it.gw, it.gd, it.gh];
  else if (it.orient === 'side') [fw, fd, fh] = [it.gw, it.gh, it.gd];
  else [fw, fd, fh] = [it.gd, it.gh, it.gw];
  if (it.rot) [fw, fd] = [fd, fw];
  return { w: fw, d: fd, h: fh };
}

export function itemRect(it: PlacedItem): Rect {
  const f = footprint(it);
  return { x: it.x, y: it.y, w: f.w, h: f.d };
}

export function overlaps(a: Rect, b: Rect, eps = 0.05): boolean {
  return a.x + eps < b.x + b.w && b.x + eps < a.x + a.w && a.y + eps < b.y + b.h && b.y + eps < a.y + a.h;
}

/* ------------------------------------------------------------------ */
/* Dividers                                                            */
/* ------------------------------------------------------------------ */

export interface DividerSolve {
  resolved: Map<string, ResolvedDivider>;
  /** divider uid -> problems */
  problems: Map<string, string[]>;
}

export function solveDividers(dividers: Divider[], c: CaseSpec, t: number, inset = 0): DividerSolve {
  const byId = new Map(dividers.map((d) => [d.uid, d]));
  const resolved = new Map<string, ResolvedDivider>();
  const problems = new Map<string, string[]>();
  const inProgress = new Set<string>();

  const addProblem = (id: string, msg: string) => {
    const list = problems.get(id) ?? [];
    if (!list.includes(msg)) list.push(msg);
    problems.set(id, list);
  };

  const run = (d: Divider) => (d.axis === 'h' ? c.l : c.w);
  const span = (d: Divider) => (d.axis === 'h' ? c.w : c.l);

  function endCoord(d: Divider, end: DividerEnd, side: 'a' | 'b'): number {
    const wall = side === 'a' ? inset : run(d) - inset;
    if (end.kind === 'wall') return wall;
    const target = byId.get(end.id);
    if (!target || target.axis === d.axis) {
      addProblem(d.uid, 'Lost its joint; re-fit it');
      return wall;
    }
    const rt = resolve(target);
    if (!rt) {
      addProblem(d.uid, 'Joint loop between dividers');
      return wall;
    }
    if (!(d.pos > rt.s0 + EPS && d.pos < rt.s1 - EPS)) {
      addProblem(d.uid, 'End is not touching the divider it joins');
    }
    return side === 'a' ? target.pos + t / 2 : target.pos - t / 2;
  }

  function resolve(d: Divider): ResolvedDivider | null {
    const done = resolved.get(d.uid);
    if (done) return done;
    if (inProgress.has(d.uid)) return null;
    inProgress.add(d.uid);
    const s0 = endCoord(d, d.a, 'a');
    const s1 = endCoord(d, d.b, 'b');
    inProgress.delete(d.uid);
    if (d.pos - t / 2 < inset - EPS || d.pos + t / 2 > span(d) - inset + EPS) addProblem(d.uid, 'Outside the case');
    if (s1 - s0 < 5) addProblem(d.uid, 'Too short');
    const rect: Rect =
      d.axis === 'h'
        ? { x: s0, y: d.pos - t / 2, w: s1 - s0, h: t }
        : { x: d.pos - t / 2, y: s0, w: t, h: s1 - s0 };
    const r: ResolvedDivider = { ...d, s0, s1, length: s1 - s0, rect };
    resolved.set(d.uid, r);
    return r;
  }

  for (const d of dividers) resolve(d);
  return { resolved, problems };
}

/**
 * Re-attach both ends of `d` to the nearest stops (walls or perpendicular dividers)
 * either side of `seed`, measured along the divider's run.
 */
export function refit(d: Divider, all: Divider[], c: CaseSpec, t: number, seed?: number, inset = 0): Divider {
  const others = all.filter((o) => o.uid !== d.uid);
  const { resolved } = solveDividers(others, c, t, inset);
  const runLen = d.axis === 'h' ? c.l : c.w;
  const s = seed ?? runLen / 2;
  let aStop: DividerEnd = { kind: 'wall' };
  let bStop: DividerEnd = { kind: 'wall' };
  let aBest = -Infinity;
  let bBest = Infinity;
  for (const o of resolved.values()) {
    if (o.axis === d.axis) continue;
    if (!(d.pos > o.s0 + EPS && d.pos < o.s1 - EPS)) continue;
    if (o.pos < s && o.pos > aBest) {
      aBest = o.pos;
      aStop = { kind: 'div', id: o.uid };
    }
    if (o.pos > s && o.pos < bBest) {
      bBest = o.pos;
      bStop = { kind: 'div', id: o.uid };
    }
  }
  return { ...d, a: aStop, b: bStop };
}

/** After an edit, re-fit any divider whose joints no longer make sense. */
export function heal(dividers: Divider[], c: CaseSpec, t: number, inset = 0): Divider[] {
  let list = dividers;
  for (let pass = 0; pass < 4; pass++) {
    const ids = new Set(list.map((d) => d.uid));
    const { resolved, problems } = solveDividers(list, c, t, inset);
    const broken = list.filter(
      (d) =>
        (d.a.kind === 'div' && !ids.has(d.a.id)) ||
        (d.b.kind === 'div' && !ids.has(d.b.id)) ||
        (problems.get(d.uid) ?? []).some((p) => p.startsWith('End is not') || p.startsWith('Lost') || p.startsWith('Joint')),
    );
    if (!broken.length) return list;
    list = list.map((d) => {
      if (!broken.includes(d)) return d;
      const r = resolved.get(d.uid);
      const seed = r ? (r.s0 + r.s1) / 2 : undefined;
      return refit(d, list, c, t, seed, inset);
    });
  }
  return list;
}

/** Remove a divider; anything that joined it re-fits to the next stop. */
export function removeDivider(dividers: Divider[], id: string, c: CaseSpec, t: number, inset = 0): Divider[] {
  const { resolved } = solveDividers(dividers, c, t, inset);
  const rest = dividers.filter((d) => d.uid !== id);
  const out = rest.map((d) => {
    const touches = (d.a.kind === 'div' && d.a.id === id) || (d.b.kind === 'div' && d.b.id === id);
    if (!touches) return d;
    const r = resolved.get(d.uid);
    return refit(d, rest, c, t, r ? (r.s0 + r.s1) / 2 : undefined, inset);
  });
  return heal(out, c, t, inset);
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

function nearest(value: number, candidates: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestD = threshold;
  for (const cand of candidates) {
    const dist = Math.abs(cand - value);
    if (dist <= bestD) {
      bestD = dist;
      best = cand;
    }
  }
  return best;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  at: number;
}

/** Snap an item's top-left so its edges meet walls, divider faces and other gear. */
export function snapItem(
  item: PlacedItem,
  x: number,
  y: number,
  layout: Layout,
  c: CaseSpec,
  resolved: Map<string, ResolvedDivider>,
  threshold: number,
): { x: number; y: number; guides: SnapGuide[] } {
  const { clearance: cl, grid, snap } = layout.settings;
  const f = footprint(item);
  const guides: SnapGuide[] = [];
  if (!snap) return { x, y, guides };

  const ins = wallInset(layout);
  const leftC: number[] = [ins + cl];
  const rightC: number[] = [c.l - ins - cl];
  const topC: number[] = [ins + cl];
  const botC: number[] = [c.w - ins - cl];
  for (const r of resolved.values()) {
    leftC.push(r.rect.x + r.rect.w + cl);
    rightC.push(r.rect.x - cl);
    topC.push(r.rect.y + r.rect.h + cl);
    botC.push(r.rect.y - cl);
  }
  for (const o of layout.items) {
    if (o.uid === item.uid) continue;
    const r = itemRect(o);
    leftC.push(r.x + r.w + cl, r.x);
    rightC.push(r.x - cl, r.x + r.w);
    topC.push(r.y + r.h + cl, r.y);
    botC.push(r.y - cl, r.y + r.h);
  }

  let nx = x;
  const l = nearest(x, leftC, threshold);
  const rr = nearest(x + f.w, rightC, threshold);
  if (l !== null && (rr === null || Math.abs(l - x) <= Math.abs(rr - (x + f.w)))) {
    nx = l;
    guides.push({ axis: 'x', at: l });
  } else if (rr !== null) {
    nx = rr - f.w;
    guides.push({ axis: 'x', at: rr });
  } else if (grid > 0) nx = Math.round(x / grid) * grid;

  let ny = y;
  const t = nearest(y, topC, threshold);
  const b = nearest(y + f.d, botC, threshold);
  if (t !== null && (b === null || Math.abs(t - y) <= Math.abs(b - (y + f.d)))) {
    ny = t;
    guides.push({ axis: 'y', at: t });
  } else if (b !== null) {
    ny = b - f.d;
    guides.push({ axis: 'y', at: b });
  } else if (grid > 0) ny = Math.round(y / grid) * grid;

  return { x: nx, y: ny, guides };
}

/** Snap a divider centreline so a face sits `clearance` off a nearby gear edge. */
export function snapDividerPos(
  d: ResolvedDivider,
  pos: number,
  layout: Layout,
  threshold: number,
): { pos: number; guide: number | null } {
  const { clearance: cl, grid, snap, dividerThickness: t } = layout.settings;
  if (!snap) return { pos, guide: null };
  const cands: number[] = [];
  for (const it of layout.items) {
    const r = itemRect(it);
    if (d.axis === 'h') {
      if (r.x + r.w < d.s0 || r.x > d.s1) continue;
      cands.push(r.y - cl - t / 2, r.y + r.h + cl + t / 2);
    } else {
      if (r.y + r.h < d.s0 || r.y > d.s1) continue;
      cands.push(r.x - cl - t / 2, r.x + r.w + cl + t / 2);
    }
  }
  const hit = nearest(pos, cands, threshold);
  if (hit !== null) return { pos: hit, guide: hit };
  if (grid > 0) return { pos: Math.round(pos / grid) * grid, guide: null };
  return { pos, guide: null };
}

/** Find a free spot for a new item, scanning left-to-right, top-to-bottom. */
export function findFreeSpot(item: PlacedItem, layout: Layout, c: CaseSpec, resolved: Map<string, ResolvedDivider>) {
  const f = footprint(item);
  const step = 5;
  const cl = layout.settings.clearance;
  const ins = wallInset(layout);
  const blockers: Rect[] = [...layout.items.map(itemRect), ...[...resolved.values()].map((r) => r.rect)];
  for (let y = ins + cl; y + f.d <= c.w - ins - cl + 0.01; y += step) {
    for (let x = ins + cl; x + f.w <= c.l - ins - cl + 0.01; x += step) {
      const r = { x: x - cl, y: y - cl, w: f.w + 2 * cl, h: f.d + 2 * cl };
      if (!blockers.some((b) => overlaps(r, b))) return { x, y };
    }
  }
  return { x: Math.max(0, (c.l - f.w) / 2), y: Math.max(0, (c.w - f.d) / 2) };
}

/** Dividers that would wall an item into its own compartment. */
export function boxInDividers(item: PlacedItem, layout: Layout, c: CaseSpec): Divider[] {
  const t = layout.settings.dividerThickness;
  const cl = layout.settings.clearance;
  const r = itemRect(item);
  const ins = wallInset(layout);
  let list = [...layout.dividers];
  const exists = (axis: 'h' | 'v', pos: number) => list.some((d) => d.axis === axis && Math.abs(d.pos - pos) < 1);
  const want: { axis: 'h' | 'v'; pos: number; seed: number }[] = [];
  const top = r.y - cl - t / 2;
  const bot = r.y + r.h + cl + t / 2;
  const left = r.x - cl - t / 2;
  const right = r.x + r.w + cl + t / 2;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // Only add a wall where there is room for it (not hard against the case wall).
  if (top - t / 2 > ins + 3) want.push({ axis: 'h', pos: top, seed: cx });
  if (bot + t / 2 < c.w - ins - 3) want.push({ axis: 'h', pos: bot, seed: cx });
  if (left - t / 2 > ins + 3) want.push({ axis: 'v', pos: left, seed: cy });
  if (right + t / 2 < c.l - ins - 3) want.push({ axis: 'v', pos: right, seed: cy });
  for (const w of want) {
    if (exists(w.axis, w.pos)) continue;
    const d: Divider = { uid: uid('d'), axis: w.axis, pos: w.pos, a: { kind: 'wall' }, b: { kind: 'wall' } };
    list.push(refit(d, list, c, t, w.seed, ins));
  }
  return heal(list, c, t, ins);
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type Severity = 'error' | 'warn';
export interface Issue {
  severity: Severity;
  target?: string;
  message: string;
}

export function checkLayout(layout: Layout, c: CaseSpec, solve: DividerSolve, fmtLen: (mm: number) => string): Issue[] {
  const issues: Issue[] = [];
  const base = baseDepth(c);
  const pad = layout.settings.floorPad;
  const ins = wallInset(layout);
  const caseRect: Rect = { x: ins, y: ins, w: c.l - 2 * ins, h: c.w - 2 * ins };
  const rects = layout.items.map((it) => ({ it, r: itemRect(it), f: footprint(it) }));
  for (const { it, r, f } of rects) {
    if (r.x < caseRect.x - 0.05 || r.y < caseRect.y - 0.05 || r.x + r.w > caseRect.x + caseRect.w + 0.05 || r.y + r.h > caseRect.y + caseRect.h + 0.05) {
      issues.push({ severity: 'error', target: it.uid, message: `${it.label} sticks out past the ${ins ? 'perimeter wall' : 'case wall'}` });
    }
    const stack = f.h + pad;
    if (stack > c.d + 0.05) {
      issues.push({ severity: 'error', target: it.uid, message: `${it.label} is ${fmtLen(stack - c.d)} too tall; the lid won't close` });
    } else if (stack > base + 0.05) {
      issues.push({
        severity: 'warn',
        target: it.uid,
        message: `${it.label} rises ${fmtLen(stack - base)} into the lid; lid foam must give or be cut`,
      });
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i].r, rects[j].r)) {
        issues.push({ severity: 'error', target: rects[i].it.uid, message: `${rects[i].it.label} overlaps ${rects[j].it.label}` });
      }
    }
    if (layout.style === 'padded' || layout.style === 'trekpak') {
      for (const d of solve.resolved.values()) {
        if (overlaps(rects[i].r, d.rect)) {
          issues.push({ severity: 'error', target: rects[i].it.uid, message: `${rects[i].it.label} is cut by a divider` });
          break;
        }
      }
    }
  }
  if (layout.style === 'padded' || layout.style === 'trekpak') {
    for (const [id, list] of solve.problems) {
      for (const m of list) issues.push({ severity: 'warn', target: id, message: `Divider: ${m}` });
    }
  }
  return issues;
}
