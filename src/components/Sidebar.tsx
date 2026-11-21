import { useMemo, useState } from 'react';
import type { CaseSpec, DividerStyle, GearSpec, Layout, Units } from '../types';
import { CASES } from '../data/cases';
import { GEAR } from '../data/gear';
import { STYLES, defaultSettings } from '../data/defaults';
import { fmt, parseLength } from '../lib/units';
import { baseDepth, wheelSide } from '../lib/geometry';
import { Section } from './Section';
import { parseWeight } from '../lib/weight';
import { LengthInput } from './Inspector';
import type { WheelSide } from '../types';

export const REPO = 'juicyjstn/pelican-case-planner';

interface Props {
  layout: Layout;
  c: CaseSpec;
  units: Units;
  myGear: GearSpec[];
  setMyGear: (g: GearSpec[]) => void;
  set: (next: Layout | ((p: Layout) => Layout), commit?: boolean) => void;
  onAddGear: (g: GearSpec) => void;
}

export function Sidebar({ layout, c, units, myGear, setMyGear, set, onAddGear }: Props) {
  return (
    <aside className="sidebar">
      <CasePicker layout={layout} c={c} units={units} set={set} />
      <StylePicker layout={layout} c={c} set={set} />
      <GearLibrary units={units} myGear={myGear} setMyGear={setMyGear} onAddGear={onAddGear} />
    </aside>
  );
}

function CasePicker({ layout, c, units, set }: { layout: Layout; c: CaseSpec; units: Units; set: Props['set'] }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const custom = layout.caseId === 'custom';
  const setCase = (id: string) =>
    set((L) => ({
      ...L,
      caseId: id,
      wheels: undefined, // back to the new case's own default
      caseOverride: undefined, // measurements belong to the old case
      customCase: id === 'custom' ? (L.customCase ?? { l: c.l, w: c.w, d: c.d, lid: c.lid, base: c.base }) : L.customCase,
    }));
  const editCustom = (key: 'l' | 'w' | 'd' | 'lid' | 'base', text: string) => {
    setDraft((d) => ({ ...d, [key]: text }));
    const v = parseLength(text, units);
    if (v != null && v > 0) set((L) => ({ ...L, customCase: { ...L.customCase!, [key]: v } }));
  };
  return (
    <Section id="case" title={<><span className="step">1</span> Case</>} summary={`${c.model}${c.line === 'Air' ? ' Air' : ''}${c.measured ? ' · measured' : ''}`}>
      <select value={layout.caseId} onChange={(e) => setCase(e.target.value)} aria-label="Case model">
        {(['Protector', 'Air'] as const).map((line) => (
          <optgroup key={line} label={`Pelican ${line}`}>
            {CASES.filter((x) => x.line === line).map((x) => (
              <option key={x.id} value={x.id}>
                {x.model} {line === 'Air' ? 'Air' : ''} · {fmt(x.l, units)} × {fmt(x.w, units)}
                {x.tpFactory ? ' · TrekPak' : ''}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="custom">Custom dimensions…</option>
      </select>
      {custom ? (
        <div className="grid2">
          {(
            [
              ['l', 'Interior length'],
              ['w', 'Interior width'],
              ['base', 'Base depth'],
              ['lid', 'Lid depth'],
              ['d', 'Total depth'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                value={draft[k] ?? (c[k] != null ? fmt(c[k] as number, units).replace(/ mm|"/, '') : '')}
                onChange={(e) => editCustom(k, e.target.value)}
                onBlur={() => setDraft((d) => ({ ...d, [k]: undefined as unknown as string }))}
              />
            </label>
          ))}
        </div>
      ) : (
        <dl className="specs">
          <div>
            <dt>Interior{c.measured && <span className="measured-badge">measured</span>}</dt>
            <dd>
              {fmt(c.l, units)} × {fmt(c.w, units)}
            </dd>
          </div>
          <div>
            <dt>Base / lid</dt>
            <dd>
              {fmt(baseDepth(c), units)} / {c.lid != null ? fmt(c.lid, units) : '—'}
            </dd>
          </div>
          <div>
            <dt>Total depth</dt>
            <dd>{fmt(c.d, units)}</dd>
          </div>
          {c.source && (
            <div className="src">
              <a href={c.source} target="_blank" rel="noreferrer">
                Pelican spec page ↗
              </a>
            </div>
          )}
          {c.notes && <p className="note">{c.notes}</p>}
        </dl>
      )}
      {!custom && <MeasuredOverride layout={layout} c={c} units={units} set={set} />}
      <div className="wheels-row">
        <span className="wheels-label">Wheels</span>
        <div className="seg small" role="group" aria-label="Wheel end">
          {(
            [
              ['left', 'Left end'],
              ['right', 'Right end'],
              ['none', 'None'],
            ] as [WheelSide, string][]
          ).map(([id, label]) => (
            <button key={id} className={wheelSide(layout, c) === id ? 'on' : ''} onClick={() => set((L) => ({ ...L, wheels: id }))}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

/** Replace Pelican's published interior numbers with the user's own tape-measure readings. */
function MeasuredOverride({ layout, c, units, set }: { layout: Layout; c: CaseSpec; units: Units; set: Props['set'] }) {
  const [open, setOpen] = useState(!!c.measured);
  const fields = [
    ['l', 'Interior length'],
    ['w', 'Interior width'],
    ['base', 'Base depth'],
    ['lid', 'Lid depth'],
  ] as const;
  const val = (k: (typeof fields)[number][0]) => (k === 'base' ? baseDepth(c) : k === 'lid' ? c.lid ?? 0 : c[k]);
  const pub = c.published;
  if (!open)
    return (
      <button className="link small-link" onClick={() => setOpen(true)}>
        My case measures differently…
      </button>
    );
  return (
    <div className="measured">
      <div className="measured-head">
        <span>Your measurements</span>
        {c.measured && <span className="measured-badge">in use</span>}
      </div>
      <div className="grid2">
        {fields.map(([k, label]) => {
          const changed = layout.caseOverride?.[k] != null;
          const was = pub ? (k === 'base' ? pub.base : k === 'lid' ? pub.lid : pub[k]) : null;
          return (
            <label key={k} className={changed ? 'changed' : ''}>
              {label}
              <LengthInput mm={val(k)} units={units} min={1} onCommit={(v) => set((L) => ({ ...L, caseOverride: { ...L.caseOverride, [k]: v } }))} />
              {changed && was != null && <small className="was">Pelican: {fmt(was, units)}</small>}
            </label>
          );
        })}
      </div>
      <p className="hint">Measure wall to wall at the floor of the base, below the lip. The planner, cut list and template all use these numbers.</p>
      <div className="row">
        {c.measured && (
          <button className="btn small" onClick={() => set((L) => ({ ...L, caseOverride: undefined }))}>
            Use Pelican's numbers
          </button>
        )}
        <button className="btn small" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
    </div>
  );
}

function StylePicker({ layout, c, set }: { layout: Layout; c: CaseSpec; set: Props['set'] }) {
  const pick = (style: DividerStyle) =>
    set((L) => {
      const fresh = defaultSettings(style);
      // Keep the user's general preferences, reset the style-specific numbers.
      return {
        ...L,
        style,
        settings: { ...L.settings, floorPad: fresh.floorPad, dividerThickness: fresh.dividerThickness, perimeter: fresh.perimeter },
      };
    });
  return (
    <Section id="interior" title={<><span className="step">2</span> Interior</>} summary={STYLES.find((s) => s.id === layout.style)?.name}>
      <div className="style-grid">
        {STYLES.map((s) => (
          <button key={s.id} className={`style-card ${layout.style === s.id ? 'on' : ''}`} onClick={() => pick(s.id)} title={s.blurb}>
            <StyleIcon id={s.id} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <p className="hint">{STYLES.find((s) => s.id === layout.style)?.blurb}</p>
      {layout.style === 'trekpak' && !c.trekpak && <p className="note warn">Pelican doesn't sell a TrekPak kit for the {c.model}. You'd be cutting from spare strips.</p>}
    </Section>
  );
}

function StyleIcon({ id }: { id: DividerStyle }) {
  return (
    <svg viewBox="0 0 40 28" className="style-icon" aria-hidden>
      <rect x="1" y="1" width="38" height="26" rx="4" className="si-shell" />
      {id === 'foam' &&
        Array.from({ length: 6 }).map((_, i) =>
          Array.from({ length: 4 }).map((_, j) => <rect key={`${i}${j}`} x={4 + i * 5.4} y={4 + j * 5} width={4.6} height={4.2} className={i > 1 && i < 4 && j > 0 && j < 3 ? 'si-pluck' : 'si-cube'} />),
        )}
      {id === 'padded' && (
        <>
          <rect x="14" y="3" width="3" height="22" rx="1.5" className="si-pad" />
          <rect x="17" y="13" width="20" height="3" rx="1.5" className="si-pad" />
        </>
      )}
      {id === 'trekpak' && (
        <>
          <rect x="3" y="3" width="34" height="22" className="si-tp-frame" />
          <rect x="15" y="3" width="2" height="22" className="si-tp" />
          <rect x="17" y="13" width="20" height="2" className="si-tp" />
          <circle cx="17.5" cy="14" r="1.1" className="si-pin" />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

function score(g: GearSpec, q: string): number {
  if (!q) return 1;
  const hay = `${g.brand} ${g.name} ${g.category}`.toLowerCase().replace(/[^a-z0-9.+ ]/g, ' ');
  const compact = hay.replace(/\s+/g, '');
  let s = 0;
  for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const t = tok.replace(/[^a-z0-9.+]/g, '');
    if (!t) continue;
    if (hay.split(' ').includes(t)) s += 3;
    else if (hay.includes(t)) s += 2;
    else if (compact.includes(t)) s += 1.5;
    else return 0;
  }
  return s;
}

function GearLibrary({ units, myGear, setMyGear, onAddGear }: { units: Units; myGear: GearSpec[]; setMyGear: (g: GearSpec[]) => void; onAddGear: (g: GearSpec) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showForm, setShowForm] = useState(false);
  const all = useMemo(() => [...myGear, ...GEAR], [myGear]);
  const cats = useMemo(() => [...new Set(all.map((g) => g.category))].sort(), [all]);
  const results = useMemo(
    () =>
      all
        .map((g) => ({ g, s: score(g, q) }))
        .filter((x) => x.s > 0 && (!cat || x.g.category === cat))
        .sort((a, b) => b.s - a.s || a.g.brand.localeCompare(b.g.brand) || a.g.name.localeCompare(b.g.name))
        .slice(0, 80)
        .map((x) => x.g),
    [all, q, cat],
  );

  return (
    <Section id="gear" className="grow" title={<><span className="step">3</span> Gear</>} summary={`${all.length} items`}>
      <div className="search">
        <input type="search" placeholder="Search gear, e.g. focusrite 2i2" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search gear" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All</option>
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <ul className="gear-list">
        {results.map((g) => (
          <li key={g.id}>
            <button className="gear-row" onClick={() => onAddGear(g)} title="Add to case">
              <GearThumb g={g} />
              <span className="gear-text">
                <span className="gear-name">
                  {g.brand} {g.name}
                  {g.custom && <em className="mine">mine</em>}
                </span>
                <span className="gear-dims">
                  {fmt(g.w, units)} × {fmt(g.d, units)} × {fmt(g.h, units)}
                </span>
              </span>
              <span className="add">+</span>
            </button>
          </li>
        ))}
        {!results.length && (
          <li className="empty">
            No match for “{q}”.{' '}
            <button className="link" onClick={() => setShowForm(true)}>
              Add it yourself
            </button>
          </li>
        )}
      </ul>
      <button className="btn wide" onClick={() => setShowForm((v) => !v)}>
        {showForm ? 'Close' : '+ Add custom gear'}
      </button>
      {showForm && (
        <CustomGearForm
          units={units}
          initialName={q}
          onSave={(g, place) => {
            setMyGear([g, ...myGear]);
            if (place) onAddGear(g);
            setShowForm(false);
          }}
        />
      )}
      {myGear.length > 0 && (
        <details className="mygear">
          <summary>My gear ({myGear.length})</summary>
          <ul>
            {myGear.map((g) => (
              <li key={g.id}>
                <span>
                  {g.brand} {g.name}
                </span>
                <a href={submitUrl(g)} target="_blank" rel="noreferrer" title="Open a pre-filled GitHub issue to add this to the shared library">
                  Submit
                </a>
                <button className="link danger" onClick={() => setMyGear(myGear.filter((x) => x.id !== g.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function GearThumb({ g }: { g: GearSpec }) {
  const m = Math.max(g.w, g.d);
  const w = (g.w / m) * 26;
  const d = (g.d / m) * 26;
  return (
    <svg viewBox="0 0 30 30" className="thumb" aria-hidden>
      <rect x={15 - w / 2} y={15 - d / 2} width={w} height={d} rx={1.5} className="thumb-rect" />
    </svg>
  );
}

export function submitUrl(g: GearSpec): string {
  const json = JSON.stringify({ id: g.id.replace(/^my-/, ''), brand: g.brand, name: g.name, category: g.category, w: g.w, d: g.d, h: g.h, weight: g.weight, source: g.source ?? '' }, null, 2);
  const p = new URLSearchParams({
    template: 'gear-submission.yml',
    title: `[Gear] ${g.brand} ${g.name}`,
    brand: g.brand,
    name: g.name,
    category: g.category,
    dims: `${g.w} x ${g.d} x ${g.h}`,
    source: g.source ?? '',
    json,
  });
  return `https://github.com/${REPO}/issues/new?${p.toString()}`;
}

function CustomGearForm({ units, initialName, onSave }: { units: Units; initialName: string; onSave: (g: GearSpec, place: boolean) => void }) {
  const [f, setF] = useState({ brand: '', name: initialName, category: 'Misc', w: '', d: '', h: '', source: '', weight: '' });
  const w = parseLength(f.w, units);
  const d = parseLength(f.d, units);
  const h = parseLength(f.h, units);
  const ok = f.name.trim() && w && d && h;
  const build = (): GearSpec => ({
    id: `my-${(f.brand + '-' + f.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
    brand: f.brand.trim(),
    name: f.name.trim(),
    category: f.category,
    w: w!,
    d: d!,
    h: h!,
    source: f.source.trim() || undefined,
    weight: f.weight.trim() ? parseWeight(f.weight, units) ?? undefined : undefined,
    custom: true,
  });
  const u = units === 'in' ? 'in' : 'mm';
  return (
    <form
      className="custom-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(build(), true);
      }}
    >
      <div className="grid2">
        <label>
          Brand
          <input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        </label>
        <label>
          Model
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </label>
      </div>
      <label>
        Category
        <input list="cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <datalist id="cats">
          {['Audio Interface', 'Microphone', 'Recorder', 'Mixer', 'Headphones', 'Wireless', 'Camera', 'Lens', 'Drone', 'Lighting', 'Video', 'Computer', 'Tablet', 'Power', 'Controller', 'Synth', 'Misc'].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="grid3">
        {(
          [
            ['w', 'Width'],
            ['d', 'Depth'],
            ['h', 'Height'],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            {label} ({u})
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={units === 'in' ? '7 1/8' : '181'} inputMode="decimal" />
          </label>
        ))}
      </div>
      <label>
        Weight ({units === 'mm' ? 'kg' : 'lb'}, optional)
        <input value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} placeholder={units === 'mm' ? '0.6' : '1.3'} inputMode="decimal" />
      </label>
      <label>
        Source (spec page link or “calipers”)
        <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
      </label>
      <p className="hint">Measure the widest points, including knobs and jacks. Use a fraction like 7 1/8, a decimal, or add mm/cm.</p>
      <div className="row">
        <button className="btn primary" disabled={!ok}>
          Save &amp; place
        </button>
        <button type="button" className="btn" disabled={!ok} onClick={() => ok && window.open(submitUrl(build()), '_blank')}>
          Submit to library
        </button>
      </div>
    </form>
  );
}
