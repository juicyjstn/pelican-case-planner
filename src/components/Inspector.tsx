import { useEffect, useState } from 'react';
import type { CaseSpec, Layout, Orientation, PlacedItem, Settings, Units } from '../types';
import { baseDepth, boxInDividers, caseSideAt, rotateRoom, dividerHeight, footprint, heal, refit, removeDivider, uid, wallInset, type DividerSolve, type Issue } from '../lib/geometry';
import { planStrips, type Cut } from '../lib/cutlist';
import { fmt, fmtBoth, parseLength } from '../lib/units';
import { pluckCells, type Selection } from './Editor2D';
import { Section } from './Section';

interface Props {
  layout: Layout;
  c: CaseSpec;
  solve: DividerSolve;
  cuts: Cut[];
  issues: Issue[];
  units: Units;
  selection: Selection;
  onSelect: (s: Selection) => void;
  set: (next: Layout | ((p: Layout) => Layout), commit?: boolean) => void;
  /** plan rotation, so 'extra room' sides match what's on screen */
  viewRot?: number;
}

export function LengthInput({ mm, units, onCommit, min = 0 }: { mm: number; units: Units; onCommit: (v: number) => void; min?: number }) {
  const shown = units === 'mm' ? String(Math.round(mm * 10) / 10) : fmt(mm, 'in').replace('"', '');
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = parseLength(text, units);
    if (v != null && v >= min) onCommit(v);
    else setText(shown);
  };
  return (
    <input
      className="len"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function Inspector(props: Props) {
  const { layout, selection, issues } = props;
  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');
  const item = selection?.kind === 'item' ? layout.items.find((i) => i.uid === selection.id) : undefined;
  const div = selection?.kind === 'divider' ? props.solve.resolved.get(selection.id) : undefined;

  return (
    <aside className="inspector">
      <Section
        id="status"
        className={`status ${errors.length ? 'bad' : warns.length ? 'meh' : 'good'}`}
        title={errors.length ? `${errors.length} problem${errors.length > 1 ? 's' : ''}` : warns.length ? 'Fits, with notes' : layout.items.length ? 'Everything fits' : 'Add some gear'}
        summary={warns.length && !errors.length ? `${warns.length} note${warns.length > 1 ? 's' : ''}` : undefined}
      >
        {[...errors, ...warns].slice(0, 8).map((i, n) => (
          <button key={n} className={`issue ${i.severity}`} onClick={() => i.target && props.onSelect({ kind: layout.items.some((x) => x.uid === i.target) ? 'item' : 'divider', id: i.target })}>
            {i.message}
          </button>
        ))}
      </Section>
      {item && <ItemPanel {...props} item={item} />}
      {div && <DividerPanel {...props} id={div.uid} />}
      {(layout.style === 'trekpak' || layout.style === 'padded') && <CutListPanel {...props} />}
      {layout.style === 'foam' && <FoamPanel {...props} />}
      <SettingsPanel {...props} />
    </aside>
  );
}

function ItemPanel({ item, layout, c, units, set, onSelect, viewRot }: Props & { item: PlacedItem }) {
  const f = footprint(item);
  const upd = (patch: Partial<PlacedItem>) => set((L) => ({ ...L, items: L.items.map((i) => (i.uid === item.uid ? { ...i, ...patch } : i)) }));
  const room = c.d - layout.settings.floorPad;
  const base = baseDepth(c) - layout.settings.floorPad;
  const pct = Math.min(1, f.h / room);
  const orients: { id: Orientation; label: string }[] = [
    { id: 'flat', label: 'Flat' },
    { id: 'side', label: 'On side' },
    { id: 'end', label: 'On end' },
  ];
  const onImage = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        // Downscale so saved layouts stay small.
        const max = 600;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        upd({ image: cv.toDataURL('image/jpeg', 0.82) });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  return (
    <Section id="selected-gear" title="Selected gear" summary={item.label}>
      <input className="title-input" value={item.label} onChange={(e) => upd({ label: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      <div className="grid3">
        <label>
          Width
          <LengthInput mm={item.gw} units={units} min={1} onCommit={(v) => upd({ gw: v })} />
        </label>
        <label>
          Depth
          <LengthInput mm={item.gd} units={units} min={1} onCommit={(v) => upd({ gd: v })} />
        </label>
        <label>
          Height
          <LengthInput mm={item.gh} units={units} min={1} onCommit={(v) => upd({ gh: v })} />
        </label>
      </div>
      <div className="seg">
        {orients.map((o) => (
          <button key={o.id} className={item.orient === o.id ? 'on' : ''} onClick={() => upd({ orient: o.id })}>
            {o.label}
          </button>
        ))}
        <button onClick={() => upd({ rot: !item.rot, room: rotateRoom(item.room, !item.rot) })} title="Rotate 90° (R)">
          <svg viewBox="0 0 24 24" className="inline-icon" aria-hidden><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg> 90°
        </button>
      </div>
      <div className="height-meter" title="Height used of the space available">
        <div className="hm-bar">
          <div className="hm-base" style={{ width: `${(base / room) * 100}%` }} />
          <div className={`hm-fill ${f.h > room ? 'over' : f.h > base ? 'lid' : ''}`} style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="hm-text">
          {fmt(f.h, units)} tall · {fmt(Math.max(0, base - f.h), units)} under base rim · {fmt(Math.max(0, room - f.h), units)} to lid
        </div>
      </div>
      <RoomEditor item={item} units={units} viewRot={viewRot ?? 0} upd={upd} />
      <div className="grid2">
        <label>
          From left end
          <LengthInput mm={item.x} units={units} onCommit={(v) => upd({ x: v })} />
        </label>
        <label>
          From hinge wall
          <LengthInput mm={item.y} units={units} onCommit={(v) => upd({ y: v })} />
        </label>
      </div>
      <div className="row">
        <label className="color">
          <input type="color" value={item.color} onChange={(e) => upd({ color: e.target.value })} />
          Color
        </label>
        <label className="btn small file">
          {item.image ? 'Replace photo' : 'Top photo…'}
          <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} hidden />
        </label>
        {item.image && (
          <button className="btn small" onClick={() => upd({ image: undefined })}>
            Clear photo
          </button>
        )}
      </div>
      <div className="row">
        {(layout.style === 'trekpak' || layout.style === 'padded') && (
          <button className="btn primary" onClick={() => set((L) => ({ ...L, dividers: boxInDividers(item, L, c) }))} title="Add dividers on every open side of this item">
            Box it in
          </button>
        )}
        <button
          className="btn"
          onClick={() => {
            const copy = { ...item, uid: uid('i'), x: item.x + 10, y: item.y + 10 };
            set((L) => ({ ...L, items: [...L.items, copy] }));
            onSelect({ kind: 'item', id: copy.uid });
          }}
        >
          Duplicate
        </button>
        <button
          className="btn danger"
          onClick={() => {
            set((L) => ({ ...L, items: L.items.filter((i) => i.uid !== item.uid) }));
            onSelect(null);
          }}
        >
          Delete
        </button>
      </div>
    </Section>
  );
}

function DividerPanel({ id, layout, c, solve, units, set, onSelect }: Props & { id: string }) {
  const d = solve.resolved.get(id)!;
  const t = layout.settings.dividerThickness;
  const ins = wallInset(layout);
  const probs = solve.problems.get(id) ?? [];
  const endName = (e: typeof d.a) => (e.kind === 'wall' ? (ins ? 'perimeter wall' : 'case wall') : 'divider (pin)');
  const face = d.axis === 'h' ? d.pos - t / 2 : d.pos - t / 2;
  return (
    <Section id="selected-divider" title="Selected divider" summary={fmt(d.length + layout.settings.fitAllowance, units)}>
      <p className="big-measure">{fmtBoth(d.length + layout.settings.fitAllowance, units)}</p>
      <p className="hint">
        {d.axis === 'h' ? 'Runs left–right' : 'Runs top–bottom'}, from {endName(d.a)} to {endName(d.b)}. Height {fmt(dividerHeight(layout, c), units)}.
      </p>
      <label>
        {d.axis === 'h' ? 'Face nearest the hinge wall, from it' : 'Face nearest the left end, from it'}
        <LengthInput
          mm={face}
          units={units}
          onCommit={(v) =>
            set((L) => ({ ...L, dividers: heal(L.dividers.map((x) => (x.uid === id ? { ...x, pos: v + t / 2 } : x)), c, t, ins) }))
          }
        />
      </label>
      {probs.map((p) => (
        <p key={p} className="note warn">
          {p}
        </p>
      ))}
      <div className="row">
        <button className="btn" onClick={() => set((L) => ({ ...L, dividers: heal(L.dividers.map((x) => (x.uid === id ? refit(x, L.dividers, c, t, (d.s0 + d.s1) / 2, ins) : x)), c, t, ins) }))}>
          Re-fit ends
        </button>
        <button
          className="btn danger"
          onClick={() => {
            set((L) => ({ ...L, dividers: removeDivider(L.dividers, id, c, t, ins) }));
            onSelect(null);
          }}
        >
          Delete
        </button>
      </div>
    </Section>
  );
}

/** Extra keep-clear room on each side of an item, laid out as you see it on screen. */
function RoomEditor({ item, units, viewRot, upd }: { item: PlacedItem; units: Units; viewRot: number; upd: (p: Partial<PlacedItem>) => void }) {
  const [open, setOpen] = useState(() => !!item.room && Object.values(item.room).some((v) => (v ?? 0) > 0));
  const side = (screen: 't' | 'r' | 'b' | 'l') => caseSideAt(screen, viewRot);
  const value = (screen: 't' | 'r' | 'b' | 'l') => item.room?.[side(screen)] ?? 0;
  const setSide = (screen: 't' | 'r' | 'b' | 'l', v: number) => upd({ room: { ...item.room, [side(screen)]: v } });
  if (!open)
    return (
      <button className="link small-link" onClick={() => setOpen(true)}>
        + Extra room for cables or knobs
      </button>
    );
  const cell = (screen: 't' | 'r' | 'b' | 'l', label: string) => (
    <label className={`room-${screen}`}>
      {label}
      <LengthInput mm={value(screen)} units={units} onCommit={(v) => setSide(screen, v)} />
    </label>
  );
  return (
    <div className="room-editor">
      <div className="room-head">
        <span>Extra room</span>
        <button className="link small-link" onClick={() => (upd({ room: undefined }), setOpen(false))}>
          Clear
        </button>
      </div>
      <div className="room-grid">
        {cell('t', '↑ Above')}
        {cell('l', '← Left')}
        <div className="room-box" title={item.label} />
        {cell('r', 'Right →')}
        {cell('b', '↓ Below')}
      </div>
      <p className="hint">Kept clear for cables, knobs or a handle. Snapping, Box it in and the template all leave this space; it turns with the item.</p>
    </div>
  );
}

function CutListPanel({ layout, c, cuts, units }: Props) {
  const trek = layout.style === 'trekpak';
  const plan = planStrips(cuts, layout.settings.stockLength);
  const pins = cuts.reduce((s, x) => s + x.pins, 0);
  const pieces = cuts.reduce((s, x) => s + x.qty, 0);
  return (
    <Section id="cutlist" title={trek ? 'TrekPak cut list' : 'Divider list'} summary={pieces ? `${pieces} piece${pieces > 1 ? 's' : ''}` : 'none yet'}>
      {!cuts.length ? (
        <p className="hint">Draw dividers with the H / V tools, or select gear and press “Box it in”.</p>
      ) : (
        <>
          <table className="cuts">
            <thead>
              <tr>
                <th>Cut</th>
                <th>Qty</th>
                <th>Length</th>
                {trek && <th>Pins</th>}
              </tr>
            </thead>
            <tbody>
              {cuts.map((x) => (
                <tr key={x.label}>
                  <td>
                    <span className="cut-tag">{x.label}</span>
                  </td>
                  <td>{x.qty}</td>
                  <td>
                    {fmt(x.length, units)}
                    <small>{fmt(x.length, units === 'in' ? 'mm' : 'in')}</small>
                  </td>
                  {trek && <td>{x.pins}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {pieces} piece{pieces > 1 ? 's' : ''}, {fmt(plan.total, units)} total at {fmt(dividerHeight(layout, c), units)} tall
            {trek ? `, ${pins} pin${pins === 1 ? '' : 's'}` : ''}.
          </p>
          {trek && (
            <>
              <h3>
                Buy {plan.strips.length} × {fmt(layout.settings.stockLength, units)} strip{plan.strips.length > 1 ? 's' : ''}
              </h3>
              <div className="strips">
                {plan.strips.map((s, i) => (
                  <div key={i} className="strip" title={`${fmt(s.waste, units)} left over`}>
                    {s.cuts.map((p, j) => (
                      <span key={j} style={{ width: `${(p.length / layout.settings.stockLength) * 100}%` }}>
                        {p.label}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <p className="hint">Measure in the case before each cut. TrekPak only cuts on a flute, so a piece may land up to half a flute longer or shorter. Set the flute pitch in Settings to round for it.</p>
            </>
          )}
        </>
      )}
    </Section>
  );
}

function FoamPanel({ layout, c }: Props) {
  const { plucked, cols, rows } = pluckCells(layout, c);
  return (
    <Section id="foam" title="Pick-n-pluck" summary={`${plucked.size} cubes`}>
      <p>
        Remove <strong>{plucked.size}</strong> of {cols * rows} cubes (hatched).
      </p>
      <p className="hint">Cube pitch varies by foam; measure yours and set it in Settings. Pluck one cube less than shown for a tighter fit.</p>
    </Section>
  );
}

function SettingsPanel({ layout, units, set, c }: Props) {
  const s = layout.settings;
  const upd = (patch: Partial<Settings>) => set((L) => ({ ...L, settings: { ...L.settings, ...patch } }));
  const uses = layout.style === 'trekpak' || layout.style === 'padded';
  const row = (label: string, key: keyof Settings, hint?: string) => (
    <label title={hint}>
      {label}
      <LengthInput mm={s[key] as number} units={units} onCommit={(v) => upd({ [key]: v } as Partial<Settings>)} />
    </label>
  );
  return (
    <Section id="settings" className="settings" title="Settings" defaultOpen={false}>
      <div className="grid2">
        {row('Floor foam / pad', 'floorPad', 'Foam under the gear; raises everything')}
        {row('Gear clearance', 'clearance', 'Gap left around gear when snapping')}
        {row('Snap grid', 'grid')}
        {uses && row('Divider thickness', 'dividerThickness', 'TrekPak panels are 7/16" (11 mm)')}
        {uses && (
          <label>
            Divider height
            <LengthInput mm={dividerHeight(layout, c)} units={units} onCommit={(v) => upd({ dividerHeight: v })} />
          </label>
        )}
        {layout.style === 'trekpak' && row('Perimeter wall', 'perimeter', 'TrekPak perimeter panels lining the case walls; 0 if you skip them')}
        {layout.style === 'trekpak' && row('Fit allowance', 'fitAllowance', 'Added to every cut for a press fit')}
        {layout.style === 'trekpak' && row('Flute pitch', 'flutePitch', 'Distance between flutes on your panel; 0 = no rounding')}
        {layout.style === 'trekpak' && row('Strip length', 'stockLength', "Pelican sells 15\", 23\" and 30\" strips")}
        {layout.style === 'foam' && row('Cube size', 'cubeSize')}
      </div>
      <label className="check">
        <input type="checkbox" checked={s.snap} onChange={(e) => upd({ snap: e.target.checked })} /> Snap to edges and grid
      </label>
      {s.dividerHeight > 0 && (
        <button className="link" onClick={() => upd({ dividerHeight: 0 })}>
          Reset divider height to the case default
        </button>
      )}
    </Section>
  );
}
