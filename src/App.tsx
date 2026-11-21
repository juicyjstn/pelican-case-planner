import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GearSpec, Layout, PlacedItem, Units } from './types';
import { useHistory } from './lib/history';
import { checkLayout, findFreeSpot, getCase, heal, removeDivider, solveDividers, uid, wallInset } from './lib/geometry';
import { buildCutList } from './lib/cutlist';
import { decodeHash, downloadText, normalizeLayout, safeStorage, shareUrl } from './lib/share';
import { fmt } from './lib/units';
import { colorFor, defaultSettings } from './data/defaults';
import { GEAR } from './data/gear';
import { Editor2D, type Selection, type Tool } from './components/Editor2D';
import { Sidebar } from './components/Sidebar';
import { Inspector } from './components/Inspector';
import { PrintSheets, TemplateArt, type Paper } from './components/PrintSheets';
import { ExportMenu } from './components/ExportMenu';

// three.js is large; load it only when the 3D pane is shown.
const Preview3D = lazy(() => import('./components/Preview3D').then((m) => ({ default: m.Preview3D })));

const store = safeStorage();
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const KEY = 'pcp.layout.v1';

function itemFromGear(g: GearSpec): PlacedItem {
  return {
    uid: uid('i'),
    gearId: g.id,
    label: g.brand ? `${g.brand} ${g.name}` : g.name,
    category: g.category,
    gw: g.w,
    gd: g.d,
    gh: g.h,
    orient: 'flat',
    rot: false,
    x: 0,
    y: 0,
    color: colorFor(g.category),
  };
}

function starterLayout(): Layout {
  const base: Layout = { version: 1, name: 'My case', caseId: '1510', style: 'trekpak', items: [], dividers: [], settings: defaultSettings('trekpak') };
  // A small example so the first visit isn't an empty box.
  const pick = (id: string) => GEAR.find((g) => g.id === id);
  const demo: [string, number, number][] = [
    ['focusrite-scarlett-2i2-4th', 20, 20],
    ['shure-sm58', 214, 20],
    ['shure-sm58', 280, 20],
  ];
  for (const [id, x, y] of demo) {
    const g = pick(id);
    if (g) base.items.push({ ...itemFromGear(g), x, y });
  }
  return base;
}

function initialLayout(): Layout {
  const fromLink = decodeHash(location.hash);
  if (fromLink) return fromLink;
  const saved = store.get(KEY);
  if (saved) {
    try {
      const l = normalizeLayout(JSON.parse(saved));
      if (l) return l;
    } catch {
      /* ignore corrupt storage */
    }
  }
  return starterLayout();
}

export default function App() {
  const hist = useHistory<Layout>(initialLayout());
  const { state: layout, set, checkpoint, undo, redo } = hist;
  const [units, setUnits] = useState<Units>(() => (store.get('pcp.units') as Units) || 'in');
  const [mode, setMode] = useState<'2d' | 'split' | '3d'>(() => (store.get('pcp.mode') as '2d') || 'split');
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [showLid, setShowLid] = useState(false);
  const [paper, setPaper] = useState<Paper>(() => (store.get('pcp.paper') as Paper) || 'letter');
  const [toast, setToast] = useState<string | null>(null);
  const [myGear, setMyGearState] = useState<GearSpec[]>(() => {
    try {
      return JSON.parse(store.get('pcp.mygear') || '[]');
    } catch {
      return [];
    }
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const setMyGear = (g: GearSpec[]) => {
    setMyGearState(g);
    store.set('pcp.mygear', JSON.stringify(g));
  };

  const c = getCase(layout);
  const t = layout.settings.dividerThickness;
  const ins = wallInset(layout);
  const usesDividers = layout.style === 'trekpak' || layout.style === 'padded';
  const solve = useMemo(() => solveDividers(usesDividers ? layout.dividers : [], c, t, ins), [layout.dividers, c, t, ins, usesDividers]);
  const { cuts, labelOf } = useMemo(
    () => buildCutList([...solve.resolved.values()], layout.settings.fitAllowance, layout.style === 'trekpak' ? layout.settings.flutePitch : 0),
    [solve, layout.settings.fitAllowance, layout.settings.flutePitch, layout.style],
  );
  const fmtLen = useCallback((mm: number) => fmt(mm, units), [units]);
  const issues = useMemo(() => checkLayout(layout, c, solve, fmtLen), [layout, c, solve, fmtLen]);

  // Re-seat dividers when the case size, thickness or perimeter changes.
  useEffect(() => {
    set((L) => {
      const healed = heal(L.dividers, c, t, ins);
      return healed === L.dividers ? L : { ...L, dividers: healed };
    }, false);
  }, [c.l, c.w, t, ins]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave; drop the share hash once it has been loaded.
  useEffect(() => {
    store.set(KEY, JSON.stringify(layout));
  }, [layout]);
  useEffect(() => {
    if (location.hash.includes('l=')) history.replaceState(null, '', location.pathname + location.search);
  }, []);
  useEffect(() => store.set('pcp.units', units), [units]);
  useEffect(() => store.set('pcp.mode', mode), [mode]);
  useEffect(() => store.set('pcp.paper', paper), [paper]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 2600);
  };

  const addGear = (g: GearSpec) => {
    const it = itemFromGear(g);
    const spot = findFreeSpot(it, layout, c, solve.resolved);
    const placed = { ...it, ...spot };
    set((L) => ({ ...L, items: [...L.items, placed] }));
    setSelection({ kind: 'item', id: placed.uid });
    setTool('select');
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.kind === 'item') set((L) => ({ ...L, items: L.items.filter((i) => i.uid !== selection.id) }));
    else set((L) => ({ ...L, dividers: removeDivider(L.dividers, selection.id, c, t, ins) }));
    setSelection(null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod) return;
      if (e.key === 'Escape') {
        setTool('select');
        setSelection(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'h' && usesDividers) setTool((x) => (x === 'divider-h' ? 'select' : 'divider-h'));
      else if (e.key === 'v' && usesDividers) setTool((x) => (x === 'divider-v' ? 'select' : 'divider-v'));
      else if (e.key === 'r' && selection?.kind === 'item') {
        set((L) => ({ ...L, items: L.items.map((i) => (i.uid === selection.id ? { ...i, rot: !i.rot } : i)) }));
      } else if (e.key.startsWith('Arrow') && selection) {
        e.preventDefault();
        const step = e.altKey ? 0.5 : e.shiftKey ? layout.settings.grid * 8 : layout.settings.grid || 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (selection.kind === 'item') set((L) => ({ ...L, items: L.items.map((i) => (i.uid === selection.id ? { ...i, x: i.x + dx, y: i.y + dy } : i)) }));
        else
          set((L) => ({
            ...L,
            dividers: heal(
              L.dividers.map((d) => (d.uid === selection.id ? { ...d, pos: d.pos + (d.axis === 'h' ? dy : dx) } : d)),
              c,
              t,
              ins,
            ),
          }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const share = async () => {
    const url = shareUrl(layout);
    try {
      await navigator.clipboard.writeText(url);
      flash(layout.items.some((i) => i.image) ? 'Link copied (photos are not included in links)' : 'Share link copied');
    } catch {
      prompt('Copy this link:', url);
    }
  };
  const saveFile = () => downloadText(`${layout.name.replace(/[^\w-]+/g, '_') || 'case'}.case.json`, JSON.stringify(layout, null, 2));
  const loadFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then((txt) => {
      try {
        const l = normalizeLayout(JSON.parse(txt));
        if (!l) throw new Error('bad');
        set(l);
        setSelection(null);
        flash(`Loaded ${l.name}`);
      } catch {
        flash("That file isn't a case layout");
      }
    });
  };
  const downloadSvg = () => {
    const pad = 15;
    const art = renderToStaticMarkup(<TemplateArt layout={layout} c={c} solve={solve} labelOf={labelOf} units={units} />);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.l + 2 * pad}mm" height="${c.w + 2 * pad}mm" viewBox="${-pad} ${-pad} ${c.l + 2 * pad} ${c.w + 2 * pad}" font-family="Helvetica, Arial, sans-serif">${art}</svg>`;
    downloadText(`${layout.name.replace(/[^\w-]+/g, '_') || 'case'}-template.svg`, svg, 'image/svg+xml');
  };
  const printTemplate = (p: Paper) => {
    // Render the tiles for this paper size before the print dialog snapshots the page.
    flushSync(() => setPaper(p));
    window.print();
  };
  const newLayout = () => {
    if (!confirm('Start a new empty layout? (You can undo this.)')) return;
    set({ ...starterLayout(), items: [], name: 'My case' });
    setSelection(null);
  };

  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 24" className="logo" aria-hidden>
            <rect x="1" y="3" width="30" height="20" rx="4" />
            <rect x="11" y="0.5" width="10" height="4" rx="2" />
            <path d="M12 8v11M12 13h15" />
          </svg>
          <input className="name" value={layout.name} onChange={(e) => set((L) => ({ ...L, name: e.target.value }), false)} aria-label="Layout name" />
        </div>
        <div className="seg" role="group" aria-label="View">
          {(['2d', 'split', '3d'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'split' ? '2D + 3D' : m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Units">
          <button className={units === 'in' ? 'on' : ''} onClick={() => setUnits('in')}>
            in
          </button>
          <button className={units === 'mm' ? 'on' : ''} onClick={() => setUnits('mm')}>
            mm
          </button>
        </div>
        <div className="actions">
          <div className="undo-group" role="group" aria-label="History">
            <button className="btn icon" onClick={undo} disabled={!hist.canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button className="btn icon" onClick={redo} disabled={!hist.canRedo} title={`Redo (${MOD}⇧Z)`} aria-label="Redo">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
          </div>
          <button className="btn" onClick={newLayout}>
            New
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Open
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => (loadFile(e.target.files?.[0]), (e.target.value = ''))} />
          <button className="btn" onClick={share}>
            Share link
          </button>
          <ExportMenu paper={paper} onPrint={printTemplate} onSvg={downloadSvg} onJson={saveFile} />
        </div>
      </header>

      <Sidebar layout={layout} c={c} units={units} myGear={myGear} setMyGear={setMyGear} set={set} onAddGear={addGear} />

      <main className={`stage mode-${mode}`}>
        {mode !== '3d' && (
          <div className="pane pane2d">
            <div className="toolbar">
              <div className="seg">
                <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select and move (Esc)">
                  ⬚ Move
                </button>
                {usesDividers && (
                  <>
                    <button className={tool === 'divider-h' ? 'on' : ''} onClick={() => setTool(tool === 'divider-h' ? 'select' : 'divider-h')} title="Click to place a left–right divider (H)">
                      ━ Divider
                    </button>
                    <button className={tool === 'divider-v' ? 'on' : ''} onClick={() => setTool(tool === 'divider-v' ? 'select' : 'divider-v')} title="Click to place a top–bottom divider (V)">
                      ┃ Divider
                    </button>
                  </>
                )}
              </div>
              <span className="tip">
                {tool === 'select'
                  ? 'Drag to move · R rotate · arrows nudge · scroll to zoom · double-click to fit'
                  : 'Click inside the case to place a divider. It extends to the nearest walls. Esc when done.'}
              </span>
            </div>
            <Editor2D
              layout={layout}
              c={c}
              solve={solve}
              labelOf={labelOf}
              issues={issues}
              units={units}
              tool={tool}
              selection={selection}
              onSelect={setSelection}
              set={set}
              checkpoint={checkpoint}
            />
          </div>
        )}
        {mode !== '2d' && (
          <div className="pane pane3d">
            <div className="toolbar">
              <label className="check">
                <input type="checkbox" checked={showLid} onChange={(e) => setShowLid(e.target.checked)} /> Show lid space
              </label>
              <span className="tip">Drag to orbit · scroll to zoom · right-drag to pan</span>
            </div>
            <Suspense fallback={<div className="preview3d loading">Loading 3D…</div>}>
              <Preview3D layout={layout} c={c} solve={solve} issues={issues} showLid={showLid} selectedId={selection?.id} />
            </Suspense>
          </div>
        )}
        {errors > 0 && <div className="stage-badge">{errors} fit problem{errors > 1 ? 's' : ''}</div>}
      </main>

      <Inspector layout={layout} c={c} solve={solve} cuts={cuts} issues={issues} units={units} selection={selection} onSelect={setSelection} set={set} />

      {toast && <div className="toast">{toast}</div>}

      <PrintSheets layout={layout} c={c} solve={solve} labelOf={labelOf} cuts={cuts} units={units} paper={paper} />
    </div>
  );
}
