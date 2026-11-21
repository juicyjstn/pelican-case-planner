import { useEffect, useState } from 'react';
import type { Layout } from '../types';
import { CASES } from '../data/cases';
import { loadLibrary, type SavedLayout } from '../lib/library';

interface Props {
  currentId: string;
  onOpen: (e: SavedLayout) => void;
  onDuplicate: (e: SavedLayout) => void;
  onDelete: (e: SavedLayout) => void;
  onNew: () => void;
  onClose: () => void;
  /** bumps when the library changes, so the list refreshes */
  version: number;
}

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString();
}

function caseName(l: Layout) {
  if (l.caseId === 'custom') return 'Custom case';
  const c = CASES.find((x) => x.id === l.caseId);
  return c ? `${c.model}${c.line === 'Air' ? ' Air' : ''}` : l.caseId;
}

/** "My layouts": every layout saved in this browser. */
export function LayoutsDialog({ currentId, onOpen, onDuplicate, onDelete, onNew, onClose, version }: Props) {
  const [entries, setEntries] = useState<SavedLayout[]>([]);
  useEffect(() => {
    setEntries(Object.values(loadLibrary()).sort((a, b) => b.updated - a.updated));
  }, [version]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="My layouts" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>My layouts</h2>
          <button className="btn icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <ul className="layouts">
          {entries.map((e) => (
            <li key={e.id} className={e.id === currentId ? 'current' : ''}>
              <button className="layout-open" onClick={() => onOpen(e)}>
                <span className="layout-name">{e.layout.name || 'Untitled case'}</span>
                <span className="layout-meta">
                  {caseName(e.layout)} · {e.layout.items.length} item{e.layout.items.length === 1 ? '' : 's'} · {ago(e.updated)}
                  {e.id === currentId && <b> · open now</b>}
                </span>
              </button>
              <button className="btn small" onClick={() => onDuplicate(e)}>
                Duplicate
              </button>
              <button className="btn small danger" onClick={() => onDelete(e)} aria-label={`Delete ${e.layout.name || 'Untitled case'}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="dialog-foot">
          <span className="hint">Saved in this browser only. Use Export → JSON or Copy link to move a layout to another device.</span>
          <button className="btn primary" onClick={onNew}>
            New layout
          </button>
        </div>
      </div>
    </div>
  );
}
