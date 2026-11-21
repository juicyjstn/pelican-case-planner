import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Layout } from '../types';
import { defaultSettings } from '../data/defaults';
import { decodeCompact, encodeCompact } from './codec';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Layout without photos, numbers rounded to 0.1 mm to keep links short. */
export function stripForShare(layout: Layout): Layout {
  return {
    ...layout,
    items: layout.items.map(({ image: _image, ...it }) => ({ ...it, x: r1(it.x), y: r1(it.y), gw: r1(it.gw), gd: r1(it.gd), gh: r1(it.gh) })),
    dividers: layout.dividers.map((d) => ({ ...d, pos: r1(d.pos) })),
  };
}

export function encodeLayout(layout: Layout): string {
  return compressToEncodedURIComponent(JSON.stringify(stripForShare(layout)));
}

export function shareUrl(layout: Layout): string {
  const base = location.href.split('#')[0];
  return `${base}#c=${encodeCompact(layout)}`;
}

/** Validate and fill defaults on anything loaded from a link, file or storage. */
export function normalizeLayout(raw: unknown): Layout | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Layout>;
  if (o.version !== 1 || typeof o.caseId !== 'string') return null;
  return {
    version: 1,
    // 'My case' was the old default name; treat it as unnamed.
    name: typeof o.name === 'string' && o.name !== 'My case' ? o.name : '',
    caseId: o.caseId,
    customCase: o.customCase,
    caseOverride: o.caseOverride && typeof o.caseOverride === 'object' ? o.caseOverride : undefined,
    wheels: o.wheels === 'left' || o.wheels === 'right' || o.wheels === 'none' ? o.wheels : undefined,
    style: o.style ?? 'trekpak',
    items: Array.isArray(o.items) ? o.items : [],
    dividers: Array.isArray(o.dividers) ? o.dividers : [],
    settings: { ...defaultSettings(o.style ?? 'trekpak'), ...(o.settings ?? {}) },
  };
}

export function decodeHash(hash: string): Layout | null {
  const compact = hash.match(/[#&]c=([^&]+)/);
  if (compact) return decodeCompact(compact[1]);
  // Older lz-string JSON links
  const m = hash.match(/[#&]l=([^&]+)/);
  if (!m) return null;
  try {
    const json = decompressFromEncodedURIComponent(m[1]);
    return json ? normalizeLayout(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function safeStorage() {
  return {
    get(key: string): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage full or blocked */
      }
    },
  };
}
