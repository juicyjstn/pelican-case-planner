import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GearSpec, Layout, PlacedItem, Units } from './types';
import { useHistory } from './lib/history';
import { autoDivide, boxInDividers, rotateRoom, checkLayout, findFreeSpot, getCase, heal, removeDivider, solveDividers, uid, wallInset, wheelSide } from './lib/geometry';
import { buildCutList } from './lib/cutlist';
import { decodeHash, downloadText, normalizeLayout, safeStorage, shareUrl } from './lib/share';
import { fmt } from './lib/units';
import { colorFor, defaultSettings } from './data/defaults';
import { GEAR } from './data/gear';
import { Editor2D, screenDeltaToCase, type Selection, type Tool, type ViewRot } from './components/Editor2D';
import { Sidebar } from './components/Sidebar';
import { Inspector } from './components/Inspector';
import { PrintSheets, TemplateArt, type Paper } from './components/PrintSheets';
import { AppMenu } from './components/AppMenu';

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
    weight: g.weight,
  };
}

function starterLayout(): Layout {
  const base: Layout = { version: 1, name: '', caseId: '1510', style: 'trekpak', items: [], dividers: [], settings: defaultSettings('trekpak') };
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
  const [showBays, setShowBays] = useState(() => store.get('pcp.bays') !== '0');
  useEffect(() => store.set('pcp.bays', showBays ? '1' : '0'), [showBays]);
  const [rot, setRot] = useState<ViewRot>(() => {
    const v = Number(store.get('pcp.rot'));
    return ([0, 90, 180, 270] as const).includes(v as ViewRot) ? (v as ViewRot) : 0;
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = store.get('pcp.theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [pose, setPose] = useState<'flat' | 'standing'>(() => (store.get('pcp.pose') === 'standing' ? 'standing' : 'flat'));
  const turn = (by: 90 | -90) => setRot((r) => (((r + by + 360) % 360) as ViewRot));
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
  // Narrow screens: side panels become drawers over the case, closed by default.
  const narrow = useMediaQuery('(max-width: 900px)');
  const [leftOpen, setLeftOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    setLeftOpen(!narrow);
    setRightOpen(!narrow);
  }, [narrow]);
  const openLeft = () => {
    setLeftOpen((v) => !v);
    if (narrow) setRightOpen(false);
  };
  const openRight = () => {
    setRightOpen((v) => !v);
    if (narrow) setLeftOpen(false);
  };

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
    if (/[#&][lc]=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }, []);
  useEffect(() => store.set('pcp.units', units), [units]);
  useEffect(() => store.set('pcp.mode', mode), [mode]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store.set('pcp.theme', theme);
  }, [theme]);
  useEffect(() => store.set('pcp.rot', String(rot)), [rot]);
  useEffect(() => store.set('pcp.pose', pose), [pose]);
  useEffect(() => store.set('pcp.paper', paper), [paper]);

  const flash = (msg: string, ms = 2600) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), ms);
  };

  const addGear = (g: GearSpec) => {
    const it = itemFromGear(g);
    const spot = findFreeSpot(it, layout, c, solve.resolved);
    const placed = { ...it, ...spot };
    set((L) => ({ ...L, items: [...L.items, placed] }));
    setSelection({ kind: 'item', id: placed.uid });
    setTool('select');
    if (narrow) setLeftOpen(false); // done picking: get back to the case
  };

  const runAutoDivide = () => {
    const { dividers, stuck } = autoDivide(layout, c);
    set((L) => ({ ...L, dividers }));
    setSelection(null);
    const names = layout.items.filter((i) => stuck.includes(i.uid)).map((i) => i.label);
    flash(
      stuck.length
        ? `${dividers.length} dividers added. ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''} ${names.length > 1 ? 'are' : 'is'} too close to split; they share a bay.`
        : `${dividers.length} dividers added. Undo to go back.`,
      5000,
    );
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
        if (document.querySelector('.menu')) return; // the open menu handles its own Escape
        setTool('select');
        setSelection(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'h' && usesDividers) setTool((x) => (x === 'divider-h' ? 'select' : 'divider-h'));
      else if (e.key === 'v' && usesDividers) setTool((x) => (x === 'divider-v' ? 'select' : 'divider-v'));
      else if (e.key === 'r' && selection?.kind === 'item') {
        set((L) => ({ ...L, items: L.items.map((i) => (i.uid === selection.id ? { ...i, rot: !i.rot, room: rotateRoom(i.room, !i.rot) } : i)) }));
      } else if (e.key.startsWith('Arrow') && selection) {
        e.preventDefault();
        const step = e.altKey ? 0.5 : e.shiftKey ? layout.settings.grid * 8 : layout.settings.grid || 1;
        // Arrows move things the way they look on screen, whatever the plan rotation.
        const { dx, dy } = screenDeltaToCase(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
          rot,
        );
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
      flash(layout.items.some((i) => i.image) ? 'Link copied (photos are not included in links)' : 'Link copied');
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
        flash(l.name ? `Loaded ${l.name}` : 'Layout loaded');
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
    set({ ...starterLayout(), items: [], name: '' });
    setSelection(null);
  };

  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="app">
      <header className="topbar">
        <button className={`btn icon panel-toggle ${leftOpen ? 'on' : ''}`} onClick={openLeft} aria-label="Case and gear panel" aria-expanded={leftOpen} title="Case & gear">
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
        <div className="brand">
          <svg viewBox="0 0 32 24" className="logo" aria-hidden>
            <rect x="1" y="3" width="30" height="20" rx="4" />
            <rect x="11" y="0.5" width="10" height="4" rx="2" />
            <path d="M12 8v11M12 13h15" />
          </svg>
          <input className="name" value={layout.name} placeholder="Name your case" onChange={(e) => set((L) => ({ ...L, name: e.target.value }), false)} aria-label="Case name" />
        </div>
        <ViewSwitch mode={mode} setMode={setMode} className="view-top" />
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
          <button className={`btn icon panel-toggle ${rightOpen ? 'on' : ''}`} onClick={openRight} aria-label="Details panel" aria-expanded={rightOpen} title="Problems, cut list and settings">
            <svg viewBox="0 0 24 24" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
            {errors > 0 && <span className="badge">{errors}</span>}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => (loadFile(e.target.files?.[0]), (e.target.value = ''))} />
          <AppMenu
            units={units}
            setUnits={setUnits}
            theme={theme}
            setTheme={setTheme}
            paper={paper}
            onNew={newLayout}
            onOpen={() => fileRef.current?.click()}
            onCopyLink={share}
            onPrint={printTemplate}
            onSvg={downloadSvg}
            onJson={saveFile}
          />
        </div>
      </header>

      <div className={`drawer left ${leftOpen ? 'open' : ''}`} aria-hidden={!leftOpen}>
        <div className="drawer-head">
          <span>Case &amp; gear</span>
          <button className="btn icon" onClick={() => setLeftOpen(false)} aria-label="Close case and gear panel">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
        </div>
        <Sidebar layout={layout} c={c} units={units} myGear={myGear} setMyGear={setMyGear} set={set} onAddGear={addGear} />
      </div>

      <main className={`stage mode-${mode}`}>
        <ViewSwitch mode={mode} setMode={setMode} className="view-stage" />
        {mode !== '3d' && (
          <div className="pane pane2d">
            <div className="toolbar">
              <div className="seg">
                <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select and move (Esc)">
                  ⬚<span className="lbl"> Move</span>
                </button>
                {usesDividers && (
                  <>
                    <button className={tool === 'divider-h' ? 'on' : ''} onClick={() => setTool(tool === 'divider-h' ? 'select' : 'divider-h')} title="Click to place a left–right divider (H)">
                      ━<span className="lbl"> Divider</span>
                    </button>
                    <button className={tool === 'divider-v' ? 'on' : ''} onClick={() => setTool(tool === 'divider-v' ? 'select' : 'divider-v')} title="Click to place a top–bottom divider (V)">
                      ┃<span className="lbl"> Divider</span>
                    </button>
                  </>
                )}
              </div>
              <RotateControl rot={rot} turn={turn} />
              {usesDividers && layout.items.length > 0 && (
                <button className="btn small" onClick={runAutoDivide} title="Replace the dividers with an automatic layout around your gear (undo to go back)">
                  ✦<span className="lbl"> Auto-divide</span>
                  <span className="lbl-narrow"> Auto</span>
                </button>
              )}
              {usesDividers && layout.dividers.length > 0 && (
                <button className={`btn small toggle ${showBays ? 'on' : ''}`} onClick={() => setShowBays((v) => !v)} aria-pressed={showBays} title="Show the inside size of each compartment">
                  <span className="lbl">Bay sizes</span>
                  <span className="lbl-narrow">Bays</span>
                </button>
              )}
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
              rot={rot}
              showBays={showBays}
            />
          </div>
        )}
        {mode !== '2d' && (
          <div className="pane pane3d">
            <div className="toolbar">
              <div className="seg" role="group" aria-label="Case pose">
                <button className={pose === 'flat' ? 'on' : ''} onClick={() => setPose('flat')} title="Lying flat, lid open">
                  <span className="lbl">Lying flat</span>
                  <span className="lbl-narrow">Flat</span>
                </button>
                <button className={pose === 'standing' ? 'on' : ''} onClick={() => setPose('standing')} title="Standing on the edge at the bottom of the plan view">
                  Standing
                </button>
              </div>
              {(pose === 'standing' || mode === '3d') && <RotateControl rot={rot} turn={turn} />}
              {wheelSide(layout, c) !== 'none' && (
                <button
                  className="btn small"
                  onClick={() => {
                    setPose('standing');
                    setRot(wheelSide(layout, c) === 'left' ? 270 : 90);
                  }}
                  title="Stand the case on its wheels, like you'd roll it"
                >
                  <span className="lbl">Stand on wheels</span>
                  <span className="lbl-narrow">On wheels</span>
                </button>
              )}
              <label className="check">
                <input type="checkbox" checked={showLid} onChange={(e) => setShowLid(e.target.checked)} /> <span className="lbl">Show lid space</span>
                <span className="lbl-narrow">Lid</span>
              </label>
              <span className="tip">{pose === 'standing' ? 'Stands on the edge at the bottom of the plan · rotate to choose' : 'Drag to orbit · scroll to zoom · right-drag to pan'}</span>
            </div>
            <Suspense fallback={<div className="preview3d loading">Loading 3D…</div>}>
              <Preview3D layout={layout} c={c} solve={solve} issues={issues} showLid={showLid} selectedId={selection?.id} rot={rot} pose={pose} />
            </Suspense>
          </div>
        )}
        {errors > 0 && !(narrow && selection) && (
          <button className="stage-badge" onClick={() => (setRightOpen(true), narrow && setLeftOpen(false))}>
            {errors} fit problem{errors > 1 ? 's' : ''}
          </button>
        )}
        {narrow && selection && (
          <SelectionBar
            layout={layout}
            selection={selection}
            labelOf={labelOf}
            onRotate={() => set((L) => ({ ...L, items: L.items.map((i) => (i.uid === selection.id ? { ...i, rot: !i.rot, room: rotateRoom(i.room, !i.rot) } : i)) }))}
            onBoxIn={() => {
              const it = layout.items.find((i) => i.uid === selection.id);
              if (it) set((L) => ({ ...L, dividers: boxInDividers(it, L, c) }));
            }}
            onDuplicate={() => {
              const it = layout.items.find((i) => i.uid === selection.id);
              if (!it) return;
              const copy = { ...it, uid: uid('i'), x: it.x + 10, y: it.y + 10 };
              set((L) => ({ ...L, items: [...L.items, copy] }));
              setSelection({ kind: 'item', id: copy.uid });
            }}
            onDelete={deleteSelection}
            onDetails={() => (setRightOpen(true), setLeftOpen(false))}
            onClose={() => setSelection(null)}
          />
        )}
      </main>

      <div className={`drawer right ${rightOpen ? 'open' : ''}`} aria-hidden={!rightOpen}>
        <div className="drawer-head">
          <span>Details</span>
          <button className="btn icon" onClick={() => setRightOpen(false)} aria-label="Close details panel">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        <Inspector layout={layout} c={c} solve={solve} cuts={cuts} issues={issues} units={units} selection={selection} onSelect={setSelection} set={set} viewRot={rot} labelOf={labelOf} />
      </div>
      {narrow && (leftOpen || rightOpen) && <div className="backdrop" onClick={() => (setLeftOpen(false), setRightOpen(false))} />}

      {toast && <div className="toast">{toast}</div>}

      <PrintSheets layout={layout} c={c} solve={solve} labelOf={labelOf} cuts={cuts} units={units} paper={paper} />
    </div>
  );
}

function RotateControl({ rot, turn }: { rot: ViewRot; turn: (by: 90 | -90) => void }) {
  return (
    <div className="seg rotate" role="group" aria-label="Rotate case">
      <button onClick={() => turn(-90)} title="Rotate case 90° counter-clockwise" aria-label="Rotate left">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
      <span className="deg">{rot}°</span>
      <button onClick={() => turn(90)} title="Rotate case 90° clockwise" aria-label="Rotate right">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
}

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

function ViewSwitch({ mode, setMode, className }: { mode: '2d' | 'split' | '3d'; setMode: (m: '2d' | 'split' | '3d') => void; className: string }) {
  return (
    <div className={`seg ${className}`} role="group" aria-label="View">
      {(['2d', 'split', '3d'] as const).map((m) => (
        <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
          {m === 'split' ? '2D + 3D' : m.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Touch-friendly actions for the selected item or divider, docked over the case on small screens. */
function SelectionBar(p: {
  layout: Layout;
  selection: NonNullable<Selection>;
  labelOf: Map<string, string>;
  onRotate: () => void;
  onBoxIn: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  const item = p.selection.kind === 'item' ? p.layout.items.find((i) => i.uid === p.selection.id) : undefined;
  const usesDividers = p.layout.style === 'trekpak' || p.layout.style === 'padded';
  const title = item ? item.label : `Divider ${p.labelOf.get(p.selection.id) ?? ''}`;
  return (
    <div className="selbar" role="toolbar" aria-label="Selection">
      <span className="selbar-title">{title}</span>
      <div className="selbar-actions">
        {item && (
          <button className="btn small" onClick={p.onRotate}>
            <svg viewBox="0 0 24 24" className="inline-icon" aria-hidden><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg> 90°
          </button>
        )}
        {item && usesDividers && (
          <button className="btn small" onClick={p.onBoxIn}>
            Box in
          </button>
        )}
        {item && (
          <button className="btn small" onClick={p.onDuplicate}>
            Copy
          </button>
        )}
        <button className="btn small danger" onClick={p.onDelete}>
          Delete
        </button>
        <button className="btn small primary" onClick={p.onDetails}>
          Edit
        </button>
        <button className="btn small icon-only" onClick={p.onClose} aria-label="Deselect">
          ✕
        </button>
      </div>
    </div>
  );
}
