import { useEffect, useRef, useState } from 'react';
import type { Units } from '../types';
import type { Paper } from './PrintSheets';

interface Props {
  units: Units;
  setUnits: (u: Units) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  paper: Paper;
  onNew: () => void;
  onOpen: () => void;
  onLayouts: () => void;
  onCopyLink: () => void;
  onPrint: (paper: Paper) => void;
  onSvg: () => void;
  onJson: () => void;
}

const SIZES: { id: Paper; label: string; detail: string }[] = [
  { id: 'letter', label: 'Letter', detail: '8.5 × 11 in' },
  { id: 'a4', label: 'A4', detail: '210 × 297 mm' },
];

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="mi-icon" aria-hidden>
    <path d={d} />
  </svg>
);
const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  new: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  layouts: 'M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  export: 'M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  svg: 'M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4',
  json: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1',
  ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z',
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" className={`mi-icon chevron ${open ? 'up' : ''}`} aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Top-right hamburger: file actions, units, copy link and export. */
export function AppMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setExportOpen(false);
    setPrintOpen(false);
  };
  const run = (fn: () => void) => () => {
    close();
    fn();
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
    <div className="appmenu" ref={rootRef}>
      <button className="btn icon menu-toggle" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Icon d={ICONS.menu} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button className="menu-item" role="menuitem" onClick={run(p.onNew)}>
            <Icon d={ICONS.new} />
            <span className="mi-text">New layout</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={run(p.onLayouts)}>
            <Icon d={ICONS.layouts} />
            <span className="mi-text">My layouts…</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={run(p.onOpen)}>
            <Icon d={ICONS.open} />
            <span className="mi-text">Open file…</span>
          </button>

          <div className="menu-sep" />
          <div className="menu-item static">
            <Icon d={ICONS.ruler} />
            <span className="mi-text">Units</span>
            <div className="seg small" role="group" aria-label="Units">
              <button className={p.units === 'in' ? 'on' : ''} onClick={() => p.setUnits('in')}>
                in
              </button>
              <button className={p.units === 'mm' ? 'on' : ''} onClick={() => p.setUnits('mm')}>
                mm
              </button>
            </div>
          </div>

          <div className="menu-item static">
            <Icon d={p.theme === 'light' ? ICONS.sun : ICONS.moon} />
            <span className="mi-text">Theme</span>
            <div className="seg small theme-toggle" role="group" aria-label="Theme">
              <button className={p.theme === 'light' ? 'on' : ''} onClick={() => p.setTheme('light')} aria-label="Light mode" title="Light mode">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d={ICONS.sun} />
                </svg>
              </button>
              <button className={p.theme === 'dark' ? 'on' : ''} onClick={() => p.setTheme('dark')} aria-label="Dark mode" title="Dark mode">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d={ICONS.moon} />
                </svg>
              </button>
            </div>
          </div>

          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" onClick={run(p.onCopyLink)}>
            <Icon d={ICONS.link} />
            <span className="mi-text">Copy link</span>
          </button>
          <button className={`menu-item ${exportOpen ? 'on' : ''}`} role="menuitem" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>
            <Icon d={ICONS.export} />
            <span className="mi-text">Export</span>
            <Chevron open={exportOpen} />
          </button>
          {exportOpen && (
            <div className="submenu">
              <button className={`menu-item ${printOpen ? 'on' : ''}`} role="menuitem" aria-expanded={printOpen} onClick={() => setPrintOpen((v) => !v)}>
                <Icon d={ICONS.print} />
                <span className="mi-text">
                  Print 1:1
                  <small>Full-size template and cut list</small>
                </span>
                <Chevron open={printOpen} />
              </button>
              {printOpen && (
                <div className="submenu">
                  {SIZES.map((s) => (
                    <button key={s.id} className="menu-item" role="menuitem" onClick={run(() => p.onPrint(s.id))}>
                      <span className="mi-text row">
                        {s.label}
                        <small>{s.detail}</small>
                      </span>
                      {p.paper === s.id && <span className="last">last used</span>}
                    </button>
                  ))}
                </div>
              )}
              <button className="menu-item" role="menuitem" onClick={run(p.onSvg)}>
                <Icon d={ICONS.svg} />
                <span className="mi-text">
                  SVG
                  <small>Full-size file for a plotter or print shop</small>
                </span>
              </button>
              <button className="menu-item" role="menuitem" onClick={run(p.onJson)}>
                <Icon d={ICONS.json} />
                <span className="mi-text">
                  JSON
                  <small>Layout file you can reopen with Open</small>
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
