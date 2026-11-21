import type { Layout } from '../types';
import { normalizeLayout, safeStorage } from './share';

/** Several named layouts kept in the browser, plus which one is open. */
export interface SavedLayout {
  id: string;
  updated: number;
  layout: Layout;
}

const LIB = 'pcp.library.v1';
const CURRENT = 'pcp.currentId';
const LEGACY = 'pcp.layout.v1';
const store = safeStorage();

export function newId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function loadLibrary(): Record<string, SavedLayout> {
  try {
    const raw = JSON.parse(store.get(LIB) || '{}') as Record<string, SavedLayout>;
    const out: Record<string, SavedLayout> = {};
    for (const [id, e] of Object.entries(raw)) {
      const l = normalizeLayout(e?.layout);
      if (l) out[id] = { id, updated: e.updated || 0, layout: l };
    }
    if (Object.keys(out).length) return out;
  } catch {
    /* fall through to migration */
  }
  // First run with the library: adopt the single autosaved layout, if any.
  try {
    const legacy = normalizeLayout(JSON.parse(store.get(LEGACY) || 'null'));
    if (legacy) {
      const id = newId();
      const lib = { [id]: { id, updated: Date.now(), layout: legacy } };
      saveLibrary(lib);
      store.set(CURRENT, id);
      return lib;
    }
  } catch {
    /* nothing to migrate */
  }
  return {};
}

export function saveLibrary(lib: Record<string, SavedLayout>) {
  store.set(LIB, JSON.stringify(lib));
}

export function getCurrentId(): string | null {
  return store.get(CURRENT);
}

export function setCurrentId(id: string) {
  store.set(CURRENT, id);
}

/** Write one layout into the library (autosave). */
export function putLayout(id: string, layout: Layout) {
  const lib = loadLibraryRaw();
  lib[id] = { id, updated: Date.now(), layout };
  saveLibrary(lib);
  store.set(LEGACY, JSON.stringify(layout)); // keep the old key fresh for older versions
}

export function deleteLayout(id: string) {
  const lib = loadLibraryRaw();
  delete lib[id];
  saveLibrary(lib);
}

function loadLibraryRaw(): Record<string, SavedLayout> {
  try {
    return JSON.parse(store.get(LIB) || '{}');
  } catch {
    return {};
  }
}
