/**
 * Compact binary share-link format (v2).
 *
 * Lengths are stored as tenths of a millimetre in varints, library gear as a
 * 24-bit hash of its id, and settings only where they differ from the
 * style's defaults. A typical layout encodes to well under 100 characters.
 * Photos are never included.
 */
import type { CaseOverride, Divider, DividerStyle, Layout, Orientation, PlacedItem, Settings, WheelSide } from '../types';
import { GEAR } from '../data/gear';
import { colorFor, defaultSettings } from '../data/defaults';

const VERSION = 2;
const STYLES: DividerStyle[] = ['none', 'foam', 'padded', 'trekpak'];
const ORIENTS: Orientation[] = ['flat', 'side', 'end'];
const WHEELS: WheelSide[] = ['none', 'left', 'right'];
const OVERRIDE_KEYS = ['l', 'w', 'base', 'lid'] as const;
const SETTING_KEYS: (keyof Settings)[] = [
  'floorPad',
  'clearance',
  'grid',
  'dividerThickness',
  'fitAllowance',
  'stockLength',
  'cubeSize',
  'dividerHeight',
  'perimeter',
  'flutePitch',
];
const SNAP_BIT = SETTING_KEYS.length;

/** 24-bit FNV-1a hash: stable across library re-ordering. */
function hash24(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0xffffff;
}

let gearByHash: Map<number, (typeof GEAR)[number]> | null = null;
function gearIndex() {
  if (!gearByHash) gearByHash = new Map(GEAR.map((g) => [hash24(g.id), g]));
  return gearByHash;
}

const tenth = (mm: number) => Math.round(mm * 10);
const fromTenth = (n: number) => n / 10;

class Writer {
  bytes: number[] = [];
  u(n: number) {
    // unsigned varint
    n = Math.max(0, Math.floor(n));
    while (n >= 0x80) {
      this.bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.bytes.push(n);
  }
  i(n: number) {
    // zigzag signed varint
    this.u(n >= 0 ? n * 2 : -n * 2 - 1);
  }
  len(mm: number) {
    this.i(tenth(mm));
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.u(b.length);
    this.bytes.push(...b);
  }
  fixed(n: number, size: number) {
    for (let k = size - 1; k >= 0; k--) this.bytes.push((n >>> (8 * k)) & 0xff);
  }
}

class Reader {
  p = 0;
  constructor(private b: Uint8Array) {}
  more() {
    return this.p < this.b.length;
  }
  u(): number {
    let n = 0;
    let mul = 1;
    for (;;) {
      if (this.p >= this.b.length) throw new Error('truncated');
      const x = this.b[this.p++];
      n += (x & 0x7f) * mul;
      if (x < 0x80) return n;
      mul *= 128;
    }
  }
  i(): number {
    const z = this.u();
    return z % 2 ? -(z + 1) / 2 : z / 2;
  }
  len(): number {
    return fromTenth(this.i());
  }
  str(): string {
    const n = this.u();
    if (this.p + n > this.b.length) throw new Error('truncated');
    const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  fixed(size: number): number {
    let n = 0;
    for (let k = 0; k < size; k++) n = n * 256 + this.b[this.p++];
    return n;
  }
}

function b64url(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function encodeCompact(layout: Layout): string {
  const w = new Writer();
  w.u(VERSION);
  w.str(layout.caseId);
  if (layout.caseId === 'custom') {
    const cc = layout.customCase!;
    w.len(cc.l), w.len(cc.w), w.len(cc.d), w.len(cc.lid ?? -0.1), w.len(cc.base ?? -0.1);
  }
  w.u(STYLES.indexOf(layout.style));
  w.str(layout.name);

  const defs = defaultSettings(layout.style);
  let mask = 0;
  SETTING_KEYS.forEach((k, bit) => {
    if (tenth(layout.settings[k] as number) !== tenth(defs[k] as number)) mask |= 1 << bit;
  });
  if (layout.settings.snap !== defs.snap) mask |= 1 << SNAP_BIT;
  w.u(mask);
  SETTING_KEYS.forEach((k, bit) => mask & (1 << bit) && w.len(layout.settings[k] as number));

  const lib = gearIndex();
  w.u(layout.items.length);
  for (const it of layout.items) {
    const g = it.gearId ? lib.get(hash24(it.gearId)) : undefined;
    const inLib = !!g && g.id === it.gearId;
    const defaultLabel = g ? (g.brand ? `${g.brand} ${g.name}` : g.name) : '';
    const dimsChanged = inLib && (tenth(g!.w) !== tenth(it.gw) || tenth(g!.d) !== tenth(it.gd) || tenth(g!.h) !== tenth(it.gh));
    const colorChanged = it.color.toLowerCase() !== colorFor(it.category).toLowerCase();
    const labelChanged = inLib && it.label !== defaultLabel;
    let flags = ORIENTS.indexOf(it.orient);
    if (it.rot) flags |= 4;
    if (inLib) flags |= 8;
    if (dimsChanged) flags |= 16;
    if (colorChanged) flags |= 32;
    if (labelChanged) flags |= 64;
    w.u(flags);
    if (inLib) w.fixed(hash24(it.gearId!), 3);
    else {
      w.str(it.label);
      w.str(it.category);
    }
    if (!inLib || dimsChanged) w.len(it.gw), w.len(it.gd), w.len(it.gh);
    if (labelChanged) w.str(it.label);
    if (colorChanged) w.fixed(parseInt(it.color.slice(1, 7), 16) || 0, 3);
    w.len(it.x), w.len(it.y);
  }

  const index = new Map(layout.dividers.map((d, i) => [d.uid, i]));
  w.u(layout.dividers.length);
  for (const d of layout.dividers) {
    const aRef = d.a.kind === 'div' ? index.get(d.a.id) : undefined;
    const bRef = d.b.kind === 'div' ? index.get(d.b.id) : undefined;
    w.u((d.axis === 'v' ? 1 : 0) | (aRef !== undefined ? 2 : 0) | (bRef !== undefined ? 4 : 0));
    w.len(d.pos);
    if (aRef !== undefined) w.u(aRef);
    if (bRef !== undefined) w.u(bRef);
  }
  // Trailing, optional (older links simply end before these):
  //   wheel code (0 = case default), then an extension bitmask and its fields.
  const ov = layout.caseOverride;
  const hasOv = !!ov && Object.values(ov).some((v) => v != null);
  const ext = hasOv ? 1 : 0;
  if (layout.wheels || ext) w.u(layout.wheels ? WHEELS.indexOf(layout.wheels) + 1 : 0);
  if (ext) {
    w.u(ext);
    if (hasOv) for (const k of OVERRIDE_KEYS) w.len(ov![k] ?? -0.1);
  }
  return b64url(w.bytes);
}

export function decodeCompact(code: string): Layout | null {
  try {
    const r = new Reader(unb64url(code));
    if (r.u() !== VERSION) return null;
    const caseId = r.str();
    let customCase: Layout['customCase'];
    if (caseId === 'custom') {
      const l = r.len(), w = r.len(), d = r.len(), lid = r.len(), base = r.len();
      customCase = { l, w, d, lid: lid < 0 ? null : lid, base: base < 0 ? null : base };
    }
    const style = STYLES[r.u()] ?? 'trekpak';
    const name = r.str();
    const settings = defaultSettings(style);
    const mask = r.u();
    SETTING_KEYS.forEach((k, bit) => {
      if (mask & (1 << bit)) (settings[k] as number) = r.len();
    });
    if (mask & (1 << SNAP_BIT)) settings.snap = !settings.snap;

    const lib = gearIndex();
    const items: PlacedItem[] = [];
    const nItems = r.u();
    for (let n = 0; n < nItems; n++) {
      const flags = r.u();
      let gearId: string | undefined;
      let label = '';
      let category = 'Misc';
      let gw = 0, gd = 0, gh = 0;
      if (flags & 8) {
        const g = lib.get(r.fixed(3));
        if (!g) throw new Error('unknown gear');
        gearId = g.id;
        label = g.brand ? `${g.brand} ${g.name}` : g.name;
        category = g.category;
        [gw, gd, gh] = [g.w, g.d, g.h];
      } else {
        label = r.str();
        category = r.str();
      }
      if (!(flags & 8) || flags & 16) [gw, gd, gh] = [r.len(), r.len(), r.len()];
      if (flags & 64) label = r.str();
      const color = flags & 32 ? '#' + r.fixed(3).toString(16).padStart(6, '0') : colorFor(category);
      const x = r.len();
      const y = r.len();
      items.push({
        uid: 'i' + n.toString(36) + Math.random().toString(36).slice(2, 6),
        gearId,
        label,
        category,
        gw,
        gd,
        gh,
        orient: ORIENTS[flags & 3] ?? 'flat',
        rot: !!(flags & 4),
        x,
        y,
        color,
      });
    }

    const nDiv = r.u();
    const uids = Array.from({ length: nDiv }, (_, i) => 'd' + i.toString(36) + Math.random().toString(36).slice(2, 6));
    const dividers: Divider[] = [];
    for (let n = 0; n < nDiv; n++) {
      const f = r.u();
      const pos = r.len();
      const a = f & 2 ? { kind: 'div' as const, id: uids[r.u()] } : { kind: 'wall' as const };
      const b = f & 4 ? { kind: 'div' as const, id: uids[r.u()] } : { kind: 'wall' as const };
      dividers.push({ uid: uids[n], axis: f & 1 ? 'v' : 'h', pos, a, b });
    }
    let wheels: WheelSide | undefined;
    let caseOverride: CaseOverride | undefined;
    if (r.more()) {
      const code = r.u();
      wheels = code ? WHEELS[code - 1] : undefined;
    }
    if (r.more()) {
      const ext = r.u();
      if (ext & 1) {
        caseOverride = {};
        for (const k of OVERRIDE_KEYS) {
          const v = r.len();
          if (v >= 0) caseOverride[k] = v;
        }
      }
    }
    return { version: 1, name, caseId, customCase, style, items, dividers, settings, wheels, caseOverride };
  } catch {
    return null;
  }
}
