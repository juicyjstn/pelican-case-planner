import type { Units } from '../types';

export const MM_PER_IN = 25.4;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** 7.3125 in -> 7 5/16" ; rounds to the nearest 1/16. */
export function fracInches(inches: number, denom = 16): string {
  const neg = inches < 0;
  let v = Math.abs(inches);
  let whole = Math.floor(v);
  let num = Math.round((v - whole) * denom);
  if (num === denom) {
    whole += 1;
    num = 0;
  }
  let s = '';
  if (num === 0) s = `${whole}`;
  else {
    const g = gcd(num, denom);
    const f = `${num / g}/${denom / g}`;
    s = whole ? `${whole} ${f}` : f;
  }
  return (neg ? '-' : '') + s + '"';
}

export function fmt(mm: number, units: Units, opts: { decimals?: boolean } = {}): string {
  if (units === 'mm') return `${Math.round(mm * 10) / 10} mm`;
  const inches = mm / MM_PER_IN;
  if (opts.decimals) return `${inches.toFixed(2)}"`;
  return fracInches(inches);
}

/** Both units, e.g. 7 5/16" (185.7 mm) */
export function fmtBoth(mm: number, units: Units): string {
  const other: Units = units === 'in' ? 'mm' : 'in';
  return `${fmt(mm, units)} (${fmt(mm, other)})`;
}

/**
 * Parse a user-typed length. Accepts "7 5/16", "7-5/16", "7.31", "5/8", "185mm", "18.5cm", '7.3"'.
 * Bare numbers are interpreted in `units`.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(/["”]|in(ch(es)?)?$/g, '').trim();
  if (!s) return null;
  const mmMatch = s.match(/^(-?\d*\.?\d+)\s*mm$/);
  if (mmMatch) return parseFloat(mmMatch[1]);
  const cmMatch = s.match(/^(-?\d*\.?\d+)\s*cm$/);
  if (cmMatch) return parseFloat(cmMatch[1]) * 10;
  const mixed = s.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/);
  let value: number | null = null;
  if (mixed) value = +mixed[1] + +mixed[2] / +mixed[3];
  else {
    const frac = s.match(/^(\d+)\/(\d+)$/);
    if (frac) value = +frac[1] / +frac[2];
    else if (/^-?\d*\.?\d+$/.test(s)) value = parseFloat(s);
  }
  if (value === null || !isFinite(value)) return null;
  return units === 'in' ? value * MM_PER_IN : value;
}

export const inch = (v: number) => v * MM_PER_IN;
