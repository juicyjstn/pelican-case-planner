import type { CaseSpec, Layout, Units } from '../types';
import { dividerHeight, footprint, keepOut, wallInset, type DividerSolve } from '../lib/geometry';
import type { Cut } from '../lib/cutlist';
import { fmt, MM_PER_IN } from '../lib/units';
import { pluckCells } from './Editor2D';

export type Paper = 'letter' | 'a4';
const PAPER = { letter: { w: 215.9, h: 279.4 }, a4: { w: 210, h: 297 } };
const MARGIN = 10;
const HEADER = 9;
const OVERLAP = 12;

interface Props {
  layout: Layout;
  c: CaseSpec;
  solve: DividerSolve;
  labelOf: Map<string, string>;
  cuts: Cut[];
  units: Units;
  paper: Paper;
}

export function tilePlan(c: CaseSpec, paper: Paper) {
  const P = PAPER[paper];
  const options = [
    { orient: 'portrait' as const, pw: P.w, ph: P.h },
    { orient: 'landscape' as const, pw: P.h, ph: P.w },
  ].map((o) => {
    const cw = o.pw - 2 * MARGIN;
    const ch = o.ph - 2 * MARGIN - HEADER;
    const stepX = cw - OVERLAP;
    const stepY = ch - OVERLAP;
    const cols = Math.max(1, Math.ceil((c.l - OVERLAP) / stepX));
    const rows = Math.max(1, Math.ceil((c.w - OVERLAP) / stepY));
    return { ...o, cw, ch, stepX, stepY, cols, rows, count: cols * rows };
  });
  return options[0].count <= options[1].count ? options[0] : options[1];
}

/** Full-size drawing of the layout in mm, used by both the print tiles and the SVG download. */
export function TemplateArt({ layout, c, solve, labelOf, units }: Omit<Props, 'cuts' | 'paper'>) {
  const ins = wallInset(layout);
  const cl = layout.settings.clearance;
  const showDiv = layout.style === 'trekpak' || layout.style === 'padded';
  return (
    <g className="tpl">
      <rect x={0} y={0} width={c.l} height={c.w} fill="none" stroke="#000" strokeWidth={0.5} />
      {ins > 0 && <rect x={ins} y={ins} width={c.l - 2 * ins} height={c.w - 2 * ins} fill="none" stroke="#000" strokeWidth={0.25} strokeDasharray="4 2" />}
      {layout.style === 'foam' &&
        (() => {
          const p = pluckCells(layout, c);
          return [...p.plucked].map((k) => {
            const [i, j] = k.split(',').map(Number);
            return <rect key={k} x={p.ox + i * p.s} y={p.oy + j * p.s} width={p.s} height={p.s} fill="#ddd" stroke="#999" strokeWidth={0.2} />;
          });
        })()}
      {showDiv &&
        [...solve.resolved.values()].map((d) => (
          <g key={d.uid}>
            <rect x={d.rect.x} y={d.rect.y} width={d.rect.w} height={d.rect.h} fill="#bbb" stroke="#000" strokeWidth={0.3} />
            <text
              x={d.axis === 'h' ? (d.s0 + d.s1) / 2 : d.pos}
              y={d.axis === 'h' ? d.pos + 1.3 : (d.s0 + d.s1) / 2}
              fontSize={3.6}
              textAnchor="middle"
              transform={d.axis === 'v' ? `rotate(-90 ${d.pos} ${(d.s0 + d.s1) / 2})` : undefined}
              fontWeight={700}
            >
              {labelOf.get(d.uid)} · {fmt(d.length + layout.settings.fitAllowance, units)}
            </text>
          </g>
        ))}
      {layout.items.map((it) => {
        const f = footprint(it);
        return (
          <g key={it.uid}>
            {layout.style === 'foam' && cl > 0 && (
              <rect x={it.x - cl} y={it.y - cl} width={f.w + 2 * cl} height={f.d + 2 * cl} fill="none" stroke="#000" strokeWidth={0.25} strokeDasharray="1.5 1" />
            )}
            {it.room && (() => {
              const k = keepOut(it);
              return k.w > f.w || k.h > f.d ? <rect x={k.x} y={k.y} width={k.w} height={k.h} fill="none" stroke="#000" strokeWidth={0.25} strokeDasharray="3 1.5" /> : null;
            })()}
            <rect x={it.x} y={it.y} width={f.w} height={f.d} fill="none" stroke="#000" strokeWidth={0.4} />
            <line x1={it.x} y1={it.y} x2={it.x + f.w} y2={it.y + f.d} stroke="#000" strokeWidth={0.1} />
            <line x1={it.x + f.w} y1={it.y} x2={it.x} y2={it.y + f.d} stroke="#000" strokeWidth={0.1} />
            <text x={it.x + f.w / 2} y={it.y + f.d / 2 - 1} fontSize={Math.min(5, f.w / Math.max(6, it.label.length * 0.6))} textAnchor="middle" fontWeight={600}>
              {it.label}
            </text>
            <text x={it.x + f.w / 2} y={it.y + f.d / 2 + 4} fontSize={3} textAnchor="middle">
              {fmt(f.w, units)} × {fmt(f.d, units)} · ↑{fmt(f.h, units)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Calibration({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={MM_PER_IN} height={4} fill="none" stroke="#000" strokeWidth={0.3} />
      <rect y={5} width={50} height={4} fill="none" stroke="#000" strokeWidth={0.3} />
      <text x={MM_PER_IN + 2} y={3.2} fontSize={3}>
        1 inch
      </text>
      <text x={52} y={8.2} fontSize={3}>
        50 mm: measure these to confirm 100% scale
      </text>
    </g>
  );
}

export function PrintSheets(props: Props) {
  const { layout, c, cuts, units, paper } = props;
  const plan = tilePlan(c, paper);
  const pages: JSX.Element[] = [];
  const total = plan.count + 1;
  // Summary page
  pages.push(
    <div className="sheet" key="summary">
      <h1>{layout.name || 'Case layout'}</h1>
      <p>
        Pelican {c.model} {c.line === 'Air' ? 'Air' : ''} · interior {fmt(c.l, units)} × {fmt(c.w, units)} · {layout.style}
      </p>
      <p>
        Template: {plan.count} page{plan.count > 1 ? 's' : ''} ({plan.cols} across × {plan.rows} down), {paper} {plan.orient}. Print at <b>100% / Actual size</b>, no “fit to page”. Trim the
        top and left margins, then align the crosshairs; pages overlap by {OVERLAP} mm.
      </p>
      <svg width="140mm" height="12mm" viewBox="0 0 140 12">
        <Calibration x={0} y={1} />
      </svg>
      {cuts.length > 0 && (
        <>
          <h2>{layout.style === 'trekpak' ? 'TrekPak cut list' : 'Dividers'}</h2>
          <table>
            <thead>
              <tr>
                <th>Cut</th>
                <th>Qty</th>
                <th>Length</th>
                <th>Height</th>
                {layout.style === 'trekpak' && <th>Pins</th>}
              </tr>
            </thead>
            <tbody>
              {cuts.map((x) => (
                <tr key={x.label}>
                  <td>{x.label}</td>
                  <td>{x.qty}</td>
                  <td>
                    {fmt(x.length, 'in')} ({fmt(x.length, 'mm')})
                  </td>
                  <td>{fmt(dividerHeight(layout, c), units)}</td>
                  {layout.style === 'trekpak' && <td>{x.pins}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Gear</h2>
      <ul>
        {layout.items.map((it) => {
          const f = footprint(it);
          return (
            <li key={it.uid}>
              {it.label}: {fmt(f.w, units)} × {fmt(f.d, units)} × {fmt(f.h, units)} ({it.orient}
              {it.rot ? ', rotated' : ''})
            </li>
          );
        })}
      </ul>
      <footer>Page 1 of {total}</footer>
    </div>,
  );
  let n = 1;
  for (let r = 0; r < plan.rows; r++) {
    for (let col = 0; col < plan.cols; col++) {
      n++;
      const x0 = col * plan.stepX;
      const y0 = r * plan.stepY;
      pages.push(
        <div className="sheet tile" key={`${r}-${col}`}>
          <div className="tile-head" style={{ height: `${HEADER}mm` }}>
            <b>
              {String.fromCharCode(65 + r)}
              {col + 1}
            </b>{' '}
            row {r + 1}/{plan.rows}, column {col + 1}/{plan.cols} · {layout.name || 'Case layout'} · page {n} of {total}
          </div>
          <svg width={`${plan.cw}mm`} height={`${plan.ch}mm`} viewBox={`${x0} ${y0} ${plan.cw} ${plan.ch}`}>
            <TemplateArt {...props} />
            {/* overlap zone + registration marks */}
            {col > 0 && <rect x={x0} y={y0} width={OVERLAP} height={plan.ch} fill="rgba(0,0,0,.05)" />}
            {r > 0 && <rect x={x0} y={y0} width={plan.cw} height={OVERLAP} fill="rgba(0,0,0,.05)" />}
            {[0, 1].flatMap((i) =>
              [0, 1].map((j) => {
                const cx = x0 + (i ? plan.cw - OVERLAP / 2 : OVERLAP / 2);
                const cy = y0 + (j ? plan.ch - OVERLAP / 2 : OVERLAP / 2);
                return (
                  <g key={`${i}${j}`} stroke="#000" strokeWidth={0.2}>
                    <line x1={cx - 4} x2={cx + 4} y1={cy} y2={cy} />
                    <line x1={cx} x2={cx} y1={cy - 4} y2={cy + 4} />
                    <circle cx={cx} cy={cy} r={2} fill="none" />
                  </g>
                );
              }),
            )}
            {r === 0 && col === 0 && <Calibration x={x0 + OVERLAP + 2} y={y0 + plan.ch - 14} />}
          </svg>
        </div>,
      );
    }
  }
  return (
    <div className="print-root">
      <style>{`@page { size: ${paper} ${plan.orient}; margin: ${MARGIN}mm; }`}</style>
      {pages}
    </div>
  );
}
