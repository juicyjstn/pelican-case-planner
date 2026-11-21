import { useEffect, useRef, useState } from 'react';
import type { Paper } from './PrintSheets';

interface Props {
  paper: Paper;
  onPrint: (paper: Paper) => void;
  onSvg: () => void;
}

const SIZES: { id: Paper; label: string; detail: string }[] = [
  { id: 'letter', label: 'Letter', detail: '8.5 × 11 in' },
  { id: 'a4', label: 'A4', detail: '210 × 297 mm' },
];

/** Export button: Print 1:1 (pick a paper size) or download a full-size SVG. */
export function ExportMenu({ paper, onPrint, onSvg }: Props) {
  const [open, setOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setPrintOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="export" ref={rootRef}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        Export <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button className={`menu-item ${printOpen ? 'on' : ''}`} role="menuitem" aria-expanded={printOpen} onClick={() => setPrintOpen((v) => !v)}>
            <span>
              <b>Print 1:1</b>
              <small>Full-size template and cut list</small>
            </span>
            <span className="caret">{printOpen ? '▴' : '▾'}</span>
          </button>
          {printOpen && (
            <div className="submenu">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  className="menu-item sub"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onPrint(s.id);
                  }}
                >
                  <span>
                    {s.label}
                    <small>{s.detail}</small>
                  </span>
                  {paper === s.id && <span className="last">last used</span>}
                </button>
              ))}
            </div>
          )}
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              close();
              onSvg();
            }}
          >
            <span>
              <b>SVG</b>
              <small>Full-size file for a plotter or print shop</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
