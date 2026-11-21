import type { CaseSpec, Layout, PlacedItem, Units } from '../types';
import { GEAR } from '../data/gear';

const byId = new Map(GEAR.map((g) => [g.id, g]));

/** grams, from the item or (for older layouts) the library */
export function itemWeight(it: PlacedItem): number | undefined {
  return it.weight ?? (it.gearId ? byId.get(it.gearId)?.weight : undefined);
}

export function fmtWeight(g: number, units: Units): string {
  if (units === 'mm') return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;
  const lb = g / 453.592;
  return lb >= 1 ? `${lb.toFixed(1)} lb` : `${(lb * 16).toFixed(1)} oz`;
}

/** Parse "2.5", "2.5 lb", "40 oz", "1.2 kg", "500 g"; bare numbers are lb (in) or kg (mm). */
export function parseWeight(text: string, units: Units): number | null {
  const m = text.trim().toLowerCase().match(/^(\d*\.?\d+)\s*(kg|g|lb|lbs|oz)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2] ?? (units === 'mm' ? 'kg' : 'lb');
  if (u === 'kg') return v * 1000;
  if (u === 'g') return v;
  if (u === 'oz') return v * 28.3495;
  return v * 453.592;
}

export interface WeightSummary {
  caseG: number | null;
  gearG: number;
  missing: PlacedItem[];
  totalG: number;
}

export function summarizeWeight(layout: Layout, c: CaseSpec): WeightSummary {
  let gearG = 0;
  const missing: PlacedItem[] = [];
  for (const it of layout.items) {
    const w = itemWeight(it);
    if (w == null) missing.push(it);
    else gearG += w;
  }
  const caseG = c.emptyKg != null ? c.emptyKg * 1000 : null;
  return { caseG, gearG, missing, totalG: (caseG ?? 0) + gearG };
}

/** Common airline limits, for a rough check. Always confirm with the airline. */
export const LIMITS = [
  { label: 'Carry-on, strict airlines (7 kg)', g: 7000 },
  { label: 'Carry-on, many others (10 kg)', g: 10000 },
  { label: 'Checked bag before overweight fees (50 lb)', g: 50 * 453.592 },
  { label: 'Checked bag maximum, most airlines (70 lb)', g: 70 * 453.592 },
];
