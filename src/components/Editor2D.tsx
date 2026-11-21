import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaseSpec, Divider, Layout, PlacedItem, Rect, ResolvedDivider, Units } from '../types';
import {
  footprint,
  heal,
  itemRect,
  refit,
  snapDividerPos,
  snapItem,
  uid,
  wallInset,
  type DividerSolve,
  type Issue,
  type SnapGuide,
} from '../lib/geometry';
import { fmt, MM_PER_IN } from '../lib/units';

export type Tool = 'select' | 'divider-h' | 'divider-v';
export type ViewRot = 0 | 90 | 180 | 270;
export type Selection = { kind: 'item' | 'divider'; id: string } | null;

interface Props {
  layout: Layout;
  c: CaseSpec;
  solve: DividerSolve;
  labelOf: Map<string, string>;
  issues: Issue[];
  units: Units;
  tool: Tool;
  selection: Selection;
  onSelect: (s: Selection) => void;
  set: (next: Layout | ((p: Layout) => Layout), commit?: boolean) => void;
  checkpoint: () => void;
  /** plan-view rotation; 0 = handle side at the top */
  rot: ViewRot;
}

const SHELL = 22; // drawn wall thickness, mm (visual only)
const RULER = 26;

type Drag =
  | { kind: 'item'; id: string; dx: number; dy: number; moved: boolean }
  | { kind: 'divider'; id: string; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean };

export function Editor2D({ layout, c, solve, labelOf, issues, units, tool, selection, onSelect, set, checkpoint, rot }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const caseRef = useRef<SVGGElement>(null);
  const turned = rot === 90 || rot === 270;
  /** case size as it appears on screen */
  const SL = turned ? c.w : c.l;
  const SW = turned ? c.l : c.w;
  const caseTransform = caseTransformFor(rot, c);
  /** keep text upright: undo the view rotation around (x, y) */
  const up = (x: number, y: number) => (rot ? `rotate(${-rot} ${x} ${y})` : undefined);
  const [view, setView] = useState<Rect>({ x: 0, y: 0, w: 100, h: 100 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const movedRef = useRef(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const t = layout.settings.dividerThickness;
  const ins = wallInset(layout);
  const usesDividers = layout.style === 'padded' || layout.style === 'trekpak';

  // Fit the case into view whenever the case changes.
  const fit = useCallback(() => {
    const pad = SHELL + RULER + 12;
    const top = pad + Math.max(30, SW * 0.12); // room for the floating toolbar
    setView({ x: -pad, y: -top, w: SL + pad + SHELL + 14, h: SW + top + SHELL + 14 });
  }, [SL, SW]);
  useEffect(fit, [fit]);

  /** pointer -> view (screen-aligned mm) coordinates, for zoom and pan */
  const toView = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);
  /** pointer -> case coordinates (through the rotation) */
  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const g = caseRef.current ?? svgRef.current!;
    const pt = svgRef.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(g.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);

  /** mm per screen pixel, for zoom-independent snap distances */
  const mmPerPx = () => {
    const svg = svgRef.current;
    if (!svg) return 1;
    const r = svg.getBoundingClientRect();
    return Math.max(view.w / r.width, view.h / r.height);
  };

  // Wheel zoom around the cursor. Native listener so we can preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toView(e);
      const k = Math.exp(e.deltaY * 0.0015);
      setView((v) => {
        const w = Math.min(Math.max(v.w * k, 40), 4000);
        const s = w / v.w;
        return { x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toView]);

  const errorTargets = useMemo(() => new Set(issues.filter((i) => i.severity === 'error').map((i) => i.target)), [issues]);
  const warnTargets = useMemo(() => new Set(issues.filter((i) => i.severity === 'warn').map((i) => i.target)), [issues]);

  /* ---------------- pointer handling ---------------- */

  const onItemDown = (e: React.PointerEvent, it: PlacedItem) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e);
    onSelect({ kind: 'item', id: it.uid });
    movedRef.current = false;
    setDrag({ kind: 'item', id: it.uid, dx: p.x - it.x, dy: p.y - it.y, moved: false });
  };

  const onDividerDown = (e: React.PointerEvent, d: ResolvedDivider) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect({ kind: 'divider', id: d.uid });
    movedRef.current = false;
    setDrag({ kind: 'divider', id: d.uid, moved: false });
  };

  const newDividerAt = (p: { x: number; y: number }): Divider => {
    // The tools are named for how the line looks on screen; map through the rotation.
    const screenH = tool === 'divider-h';
    const axis = screenH !== turned ? 'h' : 'v';
    let pos = axis === 'h' ? p.y : p.x;
    const span = axis === 'h' ? c.w : c.l;
    const probe: ResolvedDivider = {
      uid: 'probe',
      axis,
      pos,
      a: { kind: 'wall' },
      b: { kind: 'wall' },
      s0: 0,
      s1: axis === 'h' ? c.l : c.w,
      length: 0,
      rect: { x: 0, y: 0, w: 0, h: 0 },
    };
    pos = snapDividerPos(probe, pos, layout, 10 * mmPerPx()).pos;
    pos = Math.min(Math.max(pos, ins + t / 2), span - ins - t / 2);
    const d: Divider = { uid: uid('d'), axis, pos, a: { kind: 'wall' }, b: { kind: 'wall' } };
    return refit(d, layout.dividers, c, t, axis === 'h' ? p.x : p.y, ins);
  };

  const onBgDown = (e: React.PointerEvent) => {
    const p = toLocal(e);
    if (tool !== 'select') {
      if (p.x < ins || p.y < ins || p.x > c.l - ins || p.y > c.w - ins) return;
      const d = newDividerAt(p);
      set((L) => ({ ...L, dividers: heal([...L.dividers, d], c, t, ins) }));
      onSelect({ kind: 'divider', id: d.uid });
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toLocal(e);
    setHover(p);
    if (!drag) return;
    if (drag.kind === 'pan') {
      const k = mmPerPx();
      const nx = drag.vx - (e.clientX - drag.sx) * k;
      const ny = drag.vy - (e.clientY - drag.sy) * k;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) setDrag({ ...drag, moved: true });
      setView((v) => ({ ...v, x: nx, y: ny }));
      return;
    }
    if (!drag.moved && !movedRef.current) {
      // Guard with a ref: several pointermoves can arrive before React re-renders.
      movedRef.current = true;
      checkpoint();
      setDrag({ ...drag, moved: true });
    }
    const threshold = 8 * mmPerPx();
    if (drag.kind === 'item') {
      const it = layout.items.find((i) => i.uid === drag.id);
      if (!it) return;
      const s = snapItem(it, p.x - drag.dx, p.y - drag.dy, layout, c, solve.resolved, threshold);
      setGuides(s.guides);
      set((L) => ({ ...L, items: L.items.map((i) => (i.uid === it.uid ? { ...i, x: s.x, y: s.y } : i)) }), false);
    } else if (drag.kind === 'divider') {
      const d = solve.resolved.get(drag.id);
      if (!d) return;
      const raw = d.axis === 'h' ? p.y : p.x;
      const span = d.axis === 'h' ? c.w : c.l;
      let { pos, guide } = snapDividerPos(d, raw, layout, threshold);
      pos = Math.min(Math.max(pos, ins + t / 2), span - ins - t / 2);
      setGuides(guide !== null ? [{ axis: d.axis === 'h' ? 'y' : 'x', at: guide }] : []);
      set((L) => ({ ...L, dividers: L.dividers.map((x) => (x.uid === d.uid ? { ...x, pos } : x)) }), false);
    }
  };

  const onUp = () => {
    if (drag?.kind === 'pan' && !drag.moved) onSelect(null);
    if (drag?.kind === 'divider' && drag.moved) {
      set((L) => ({ ...L, dividers: heal(L.dividers, c, t, ins) }), false);
    }
    setDrag(null);
    movedRef.current = false;
    setGuides([]);
  };

  /* ---------------- rendering helpers ---------------- */

  const preview = tool !== 'select' && hover && hover.x > ins && hover.y > ins && hover.x < c.l - ins && hover.y < c.w - ins ? newDividerAt(hover) : null;
  const previewResolved = useMemo(() => {
    if (!preview) return null;
    // Resolve the preview against the existing set.
    const others = solve.resolved;
    const run = preview.axis === 'h' ? c.l : c.w;
    const end = (e: Divider['a'], side: 'a' | 'b') =>
      e.kind === 'wall' ? (side === 'a' ? ins : run - ins) : (others.get(e.id)?.pos ?? 0) + (side === 'a' ? t / 2 : -t / 2);
    const s0 = end(preview.a, 'a');
    const s1 = end(preview.b, 'b');
    return preview.axis === 'h'
      ? { x: s0, y: preview.pos - t / 2, w: s1 - s0, h: t, len: s1 - s0 }
      : { x: preview.pos - t / 2, y: s0, w: t, h: s1 - s0, len: s1 - s0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.axis, preview?.pos, preview?.a, preview?.b, solve, c, t, ins]);

  const zoomPx = 1 / mmPerPx(); // px per mm
  const fs = Math.max(3.2, 11 / Math.max(zoomPx, 0.01)); // ~11px label text

  const selectedItem = selection?.kind === 'item' ? layout.items.find((i) => i.uid === selection.id) : undefined;

  return (
    <svg
      ref={svgRef}
      className={`editor2d tool-${tool}`}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onBgDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={fit}
    >
      <defs>
        <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--shell-hi)" />
          <stop offset="1" stopColor="var(--shell-lo)" />
        </linearGradient>
        <pattern id="foamtex" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="var(--foam)" />
          <circle cx="1" cy="1" r="0.5" fill="var(--foam-dot)" />
          <circle cx="3" cy="3" r="0.4" fill="var(--foam-dot)" />
        </pattern>
        <pattern id="flutes" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="var(--tp-panel)" />
          <path d="M0 1.5h3" stroke="var(--tp-flute)" strokeWidth="0.35" />
        </pattern>
        <pattern id="flutesV" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="var(--tp-panel)" />
          <path d="M1.5 0v3" stroke="var(--tp-flute)" strokeWidth="0.35" />
        </pattern>
        <pattern id="pluck" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill="var(--pluck)" />
          <path d="M0 0v3" stroke="var(--pluck-line)" strokeWidth="1" />
        </pattern>
        <filter id="lift" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0.8" dy="1.4" stdDeviation="1.2" floodOpacity="0.45" />
        </filter>
        {layout.items
          .filter((it) => it.image)
          .map((it) => (
            <clipPath key={it.uid} id={`clip-${it.uid}`}>
              <rect width={footprint(it).w} height={footprint(it).d} rx={2} />
            </clipPath>
          ))}
      </defs>

      <Rulers l={SL} w={SW} units={units} fs={fs} />

      {/* case shell */}
      <g transform={caseTransform}>
        <rect x={-SHELL} y={-SHELL} width={c.l + 2 * SHELL} height={c.w + 2 * SHELL} rx={SHELL * 0.9} fill="url(#shell)" />
        <rect x={-SHELL + 4} y={-SHELL + 4} width={c.l + 2 * SHELL - 8} height={c.w + 2 * SHELL - 8} rx={SHELL * 0.7} fill="none" stroke="var(--shell-edge)" strokeWidth={0.8} />
        <ShellMarks c={c} fs={fs} rot={rot} />
        <rect x={0} y={0} width={c.l} height={c.w} rx={4} fill={layout.style === 'none' ? 'var(--floor)' : 'url(#foamtex)'} />
      </g>

      <GridLines l={SL} w={SW} units={units} />

      <g ref={caseRef} transform={caseTransform}>
      {layout.style === 'foam' && <PluckGrid layout={layout} c={c} />}

      {ins > 0 && (
        <g className="perimeter">
          <rect x={0} y={0} width={c.l} height={ins} fill="url(#flutes)" />
          <rect x={0} y={c.w - ins} width={c.l} height={ins} fill="url(#flutes)" />
          <rect x={0} y={ins} width={ins} height={c.w - 2 * ins} fill="url(#flutesV)" />
          <rect x={c.l - ins} y={ins} width={ins} height={c.w - 2 * ins} fill="url(#flutesV)" />
          <rect x={ins} y={ins} width={c.l - 2 * ins} height={c.w - 2 * ins} fill="none" stroke="var(--tp-edge)" strokeWidth={0.6} />
        </g>
      )}

      {/* dividers */}
      {usesDividers &&
        [...solve.resolved.values()].map((d) => {
          const sel = selection?.kind === 'divider' && selection.id === d.uid;
          const bad = warnTargets.has(d.uid);
          const horiz = d.axis === 'h';
          return (
            <g key={d.uid} className="divider" onPointerDown={(e) => onDividerDown(e, d)}>
              <rect
                x={d.rect.x}
                y={d.rect.y}
                width={d.rect.w}
                height={d.rect.h}
                fill={layout.style === 'trekpak' ? (horiz ? 'url(#flutes)' : 'url(#flutesV)') : 'var(--padded)'}
                stroke={sel ? 'var(--accent)' : bad ? 'var(--warn)' : 'var(--tp-edge)'}
                strokeWidth={sel ? 1.2 : 0.6}
                rx={layout.style === 'padded' ? t / 2 : 0.5}
              />
              {/* fat invisible hit area */}
              <rect
                x={horiz ? d.rect.x : d.rect.x - 4}
                y={horiz ? d.rect.y - 4 : d.rect.y}
                width={horiz ? d.rect.w : d.rect.w + 8}
                height={horiz ? d.rect.h + 8 : d.rect.h}
                fill="transparent"
                style={{ cursor: horiz !== turned ? 'ns-resize' : 'ew-resize' }}
              />
              {layout.style === 'trekpak' &&
                (['a', 'b'] as const).map((side) =>
                  d[side].kind === 'div' ? (
                    <circle
                      key={side}
                      cx={horiz ? (side === 'a' ? d.s0 + 1.5 : d.s1 - 1.5) : d.pos}
                      cy={horiz ? d.pos : side === 'a' ? d.s0 + 1.5 : d.s1 - 1.5}
                      r={Math.min(2.4, t / 3)}
                      fill="var(--pin)"
                    />
                  ) : null,
                )}
            </g>
          );
        })}

      {previewResolved && (
        <g pointerEvents="none">
          <rect {...previewResolved} width={previewResolved.w} height={previewResolved.h} fill="var(--accent)" opacity={0.45} />
          <text
            x={previewResolved.x + previewResolved.w / 2}
            y={previewResolved.y + previewResolved.h / 2}
            transform={up(previewResolved.x + previewResolved.w / 2, previewResolved.y + previewResolved.h / 2)}
            dy={-t}
            fontSize={fs}
            textAnchor="middle"
            className="measure"
          >
            {fmt(previewResolved.len, units)}
          </text>
        </g>
      )}

      {/* gear */}
      {layout.items.map((it) => {
        const f = footprint(it);
        const sel = selection?.kind === 'item' && selection.id === it.uid;
        const err = errorTargets.has(it.uid);
        const warn = warnTargets.has(it.uid);
        const small = Math.min(f.w, f.d);
        const screenW = turned ? f.d : f.w;
        const lfs = Math.min(Math.max(small / 6, 4), fs * 1.15, screenW / Math.max(4, it.label.length * 0.62));
        return (
          <g
            key={it.uid}
            transform={`translate(${it.x} ${it.y})`}
            className="item"
            onPointerDown={(e) => onItemDown(e, it)}
            style={{ cursor: tool === 'select' ? 'grab' : undefined }}
          >
            <rect width={f.w} height={f.d} rx={2} fill={it.color} filter="url(#lift)" />
            {it.image ? (
              <image href={it.image} width={f.w} height={f.d} preserveAspectRatio="none" clipPath={`url(#clip-${it.uid})`} />
            ) : (
              <>
                <rect x={1.5} y={1.5} width={Math.max(0, f.w - 3)} height={Math.max(0, f.d - 3)} rx={1.5} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={0.6} />
                <rect width={f.w} height={Math.min(f.d * 0.42, 14)} rx={2} fill="rgba(255,255,255,.10)" />
              </>
            )}
            <rect
              width={f.w}
              height={f.d}
              rx={2}
              fill="none"
              stroke={err ? 'var(--err)' : sel ? 'var(--accent)' : warn ? 'var(--warn)' : 'rgba(0,0,0,.5)'}
              strokeWidth={err || sel ? 1.4 : 0.6}
              strokeDasharray={err ? '3 1.5' : undefined}
            />
            <g pointerEvents="none" className="item-text" transform={up(f.w / 2, f.d / 2)}>
              <text x={f.w / 2} y={f.d / 2 - lfs * 0.15} fontSize={lfs} textAnchor="middle" className="item-label">
                {it.label}
              </text>
              {small > lfs * 3 && (
                <text x={f.w / 2} y={f.d / 2 + lfs * 1.05} fontSize={lfs * 0.72} textAnchor="middle" className="item-dims">
                  {fmt(f.w, units)} × {fmt(f.d, units)} · ↑{fmt(f.h, units)}
                </text>
              )}
            </g>
          </g>
        );
      })}

      {/* divider labels sit above the gear so they stay readable */}
      {usesDividers &&
        [...solve.resolved.values()].map((d) => {
          const label = labelOf.get(d.uid);
          return label && d.length > fs * 3 ? (
            <DividerLabel key={d.uid} d={d} rot={rot} text={`${label} · ${fmt(d.length + layout.settings.fitAllowance, units)}`} fs={fs * 0.85} />
          ) : null;
        })}

      {selectedItem && <GapReadout item={selectedItem} layout={layout} c={c} solve={solve} units={units} fs={fs} up={up} />}

      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <line key={i} x1={g.at} x2={g.at} y1={-SHELL} y2={c.w + SHELL} className="guide" strokeWidth={0.5} />
        ) : (
          <line key={i} y1={g.at} y2={g.at} x1={-SHELL} x2={c.l + SHELL} className="guide" strokeWidth={0.5} />
        ),
      )}

      </g>

      {hover && hover.x >= 0 && hover.y >= 0 && hover.x <= c.l && hover.y <= c.w && (() => {
        const sp = toScreen(hover, rot, c);
        return (
          <text x={SL + SHELL} y={SW + SHELL + fs * 1.3} fontSize={fs * 0.85} textAnchor="end" className="cursor-readout">
            {fmt(sp.x, units)}, {fmt(sp.y, units)}
          </text>
        );
      })()}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

function DividerLabel({ d, text, fs, rot }: { d: ResolvedDivider; text: string; fs: number; rot: ViewRot }) {
  const mid = (d.s0 + d.s1) / 2;
  const [x, y] = d.axis === 'h' ? [mid, d.pos] : [d.pos, mid];
  // Run the label along the divider as it appears on screen, never upside down.
  const screenVertical = (d.axis === 'v') !== (rot === 90 || rot === 270);
  const angle = (screenVertical ? -90 : 0) - rot;
  return (
    <g pointerEvents="none" transform={`translate(${x} ${y}) rotate(${angle})`}>
      <rect x={-text.length * fs * 0.3} y={-fs * 0.62} width={text.length * fs * 0.6} height={fs * 1.24} rx={fs * 0.3} className="divlabel-bg" />
      <text x={0} y={fs * 0.35} fontSize={fs} textAnchor="middle" className="divlabel">
        {text}
      </text>
    </g>
  );
}

/** SVG transform that turns the case (origin top-left, length along x) by `rot` and keeps it at the origin. */
export function caseTransformFor(rot: ViewRot, c: CaseSpec): string | undefined {
  if (rot === 90) return `translate(${c.w} 0) rotate(90)`;
  if (rot === 180) return `translate(${c.l} ${c.w}) rotate(180)`;
  if (rot === 270) return `translate(0 ${c.l}) rotate(270)`;
  return undefined;
}

/** case coordinates -> on-screen coordinates measured from the case's visible top-left */
export function toScreen(p: { x: number; y: number }, rot: ViewRot, c: CaseSpec) {
  if (rot === 90) return { x: c.w - p.y, y: p.x };
  if (rot === 180) return { x: c.l - p.x, y: c.w - p.y };
  if (rot === 270) return { x: p.y, y: c.l - p.x };
  return p;
}

/** case-space delta for an on-screen nudge */
export function screenDeltaToCase(dx: number, dy: number, rot: ViewRot) {
  if (rot === 90) return { dx: dy, dy: -dx };
  if (rot === 180) return { dx: -dx, dy: -dy };
  if (rot === 270) return { dx: -dy, dy: dx };
  return { dx, dy };
}

/** Handle and latches on the front (y = 0) wall, hinges on the back wall, drawn in the shell band. */
function ShellMarks({ c, fs, rot }: { c: CaseSpec; fs: number; rot: ViewRot }) {
  // Labels run along their wall as it appears on screen, never upside down.
  const along = (x: number, y: number) => `rotate(${(rot === 90 || rot === 270 ? -90 : 0) - rot} ${x} ${y})`;
  const handleW = Math.min(c.l * 0.32, 160);
  const latchW = Math.min(30, c.l * 0.08);
  const nLatch = c.l > 600 ? 3 : 2;
  const latchXs = nLatch === 3 ? [c.l * 0.18, c.l * 0.5, c.l * 0.82] : [c.l * 0.2, c.l * 0.8];
  const hingeXs = c.l > 450 ? [c.l * 0.2, c.l * 0.5, c.l * 0.8] : [c.l * 0.25, c.l * 0.75];
  const by = c.w + SHELL / 2;
  return (
    <g pointerEvents="none" className="shell-marks">
      <rect x={c.l / 2 - handleW / 2} y={-SHELL + 4} width={handleW} height={SHELL - 9} rx={(SHELL - 9) / 2} className="handle" />
      {latchXs
        .filter((x) => Math.abs(x - c.l / 2) > handleW / 2 + latchW / 2 + 2)
        .map((x) => (
          <rect key={x} x={x - latchW / 2} y={-SHELL + 3} width={latchW} height={SHELL - 6} rx={2} className="latch" />
        ))}
      {hingeXs.map((x) => (
        <rect key={x} x={x - 9} y={c.w + 4} width={18} height={SHELL - 9} rx={1.5} className="hinge" />
      ))}
      <text x={c.l / 2} y={by} dy={fs * 0.3} fontSize={fs * 0.7} textAnchor="middle" className="shell-label" transform={along(c.l / 2, by)}>
        HINGE
      </text>
      <text x={c.l / 2} y={-SHELL / 2 + 0.5} dy={fs * 0.3} fontSize={fs * 0.7} textAnchor="middle" className="shell-label dark" transform={along(c.l / 2, -SHELL / 2 + 0.5)}>
        HANDLE
      </text>
    </g>
  );
}

function Rulers({ l, w, units, fs }: { l: number; w: number; units: Units; fs: number }) {
  const step = units === 'in' ? MM_PER_IN / 4 : 5;
  const major = units === 'in' ? 4 : 2; // every 1" or 10 mm
  const labelEvery = units === 'in' ? 4 : l > 400 ? 10 : 4; // ticks between labels
  const ticksX: JSX.Element[] = [];
  const ticksY: JSX.Element[] = [];
  const y0 = -SHELL - 4;
  const x0 = -SHELL - 4;
  for (let i = 0, v = 0; v <= l + 0.01; i++, v = i * step) {
    const len = i % major === 0 ? 7 : i % 2 === 0 ? 4.5 : 2.5;
    ticksX.push(<line key={i} x1={v} x2={v} y1={y0} y2={y0 - len} />);
    if (i % labelEvery === 0 && i > 0)
      ticksX.push(
        <text key={'t' + i} x={v} y={y0 - 9} fontSize={fs * 0.8} textAnchor="middle">
          {units === 'in' ? i / 4 : Math.round(v / 10)}
        </text>,
      );
  }
  for (let i = 0, v = 0; v <= w + 0.01; i++, v = i * step) {
    const len = i % major === 0 ? 7 : i % 2 === 0 ? 4.5 : 2.5;
    ticksY.push(<line key={i} y1={v} y2={v} x1={x0} x2={x0 - len} />);
    if (i % labelEvery === 0 && i > 0)
      ticksY.push(
        <text key={'t' + i} x={x0 - 9} y={v + fs * 0.3} fontSize={fs * 0.8} textAnchor="end">
          {units === 'in' ? i / 4 : Math.round(v / 10)}
        </text>,
      );
  }
  return (
    <g className="ruler" pointerEvents="none">
      <line x1={0} x2={l} y1={y0} y2={y0} />
      <line y1={0} y2={w} x1={x0} x2={x0} />
      {ticksX}
      {ticksY}
      <text x={x0 - 9} y={y0 - 9} fontSize={fs * 0.8} textAnchor="end" className="ruler-unit">
        {units === 'in' ? 'in' : 'cm'}
      </text>
    </g>
  );
}

function GridLines({ l, w, units }: { l: number; w: number; units: Units }) {
  const step = units === 'in' ? MM_PER_IN : 10;
  const lines: JSX.Element[] = [];
  for (let v = step; v < l; v += step) lines.push(<line key={'x' + v} x1={v} x2={v} y1={0} y2={w} />);
  for (let v = step; v < w; v += step) lines.push(<line key={'y' + v} y1={v} y2={v} x1={0} x2={l} />);
  return (
    <g className="gridlines" pointerEvents="none">
      {lines}
    </g>
  );
}

/** Pick-n-pluck cubes: highlight the cubes to remove under each piece of gear. */
export function pluckCells(layout: Layout, c: CaseSpec) {
  const s = layout.settings.cubeSize;
  const cl = layout.settings.clearance;
  const cols = Math.floor(c.l / s);
  const rows = Math.floor(c.w / s);
  const ox = (c.l - cols * s) / 2;
  const oy = (c.w - rows * s) / 2;
  const plucked = new Set<string>();
  for (const it of layout.items) {
    const r = itemRect(it);
    const c0 = Math.max(0, Math.floor((r.x - cl - ox) / s));
    const c1 = Math.min(cols - 1, Math.floor((r.x + r.w + cl - ox - 0.01) / s));
    const r0 = Math.max(0, Math.floor((r.y - cl - oy) / s));
    const r1 = Math.min(rows - 1, Math.floor((r.y + r.h + cl - oy - 0.01) / s));
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) plucked.add(`${i},${j}`);
  }
  return { s, cols, rows, ox, oy, plucked };
}

function PluckGrid({ layout, c }: { layout: Layout; c: CaseSpec }) {
  const { s, cols, rows, ox, oy, plucked } = pluckCells(layout, c);
  const cells: JSX.Element[] = [];
  for (const key of plucked) {
    const [i, j] = key.split(',').map(Number);
    cells.push(<rect key={key} x={ox + i * s} y={oy + j * s} width={s} height={s} fill="url(#pluck)" />);
  }
  const lines: JSX.Element[] = [];
  for (let i = 0; i <= cols; i++) lines.push(<line key={'c' + i} x1={ox + i * s} x2={ox + i * s} y1={oy} y2={oy + rows * s} />);
  for (let j = 0; j <= rows; j++) lines.push(<line key={'r' + j} y1={oy + j * s} y2={oy + j * s} x1={ox} x2={ox + cols * s} />);
  return (
    <g pointerEvents="none">
      {cells}
      <g className="pluck-lines">{lines}</g>
    </g>
  );
}

/** Live gap measurements from the selected item to the nearest obstacle on each side. */
function GapReadout({ item, layout, c, solve, units, fs, up }: { item: PlacedItem; layout: Layout; c: CaseSpec; solve: DividerSolve; units: Units; fs: number; up: (x: number, y: number) => string | undefined }) {
  const r = itemRect(item);
  const ins = wallInset(layout);
  const blockers: Rect[] = [...layout.items.filter((i) => i.uid !== item.uid).map(itemRect)];
  if (layout.style === 'padded' || layout.style === 'trekpak') blockers.push(...[...solve.resolved.values()].map((d) => d.rect));
  const ovY = (b: Rect) => b.y < r.y + r.h && b.y + b.h > r.y;
  const ovX = (b: Rect) => b.x < r.x + r.w && b.x + b.w > r.x;
  let left = r.x - ins,
    right = c.l - ins - (r.x + r.w),
    top = r.y - ins,
    bottom = c.w - ins - (r.y + r.h);
  for (const b of blockers) {
    if (ovY(b)) {
      if (b.x + b.w <= r.x + 0.01) left = Math.min(left, r.x - (b.x + b.w));
      if (b.x >= r.x + r.w - 0.01) right = Math.min(right, b.x - (r.x + r.w));
    }
    if (ovX(b)) {
      if (b.y + b.h <= r.y + 0.01) top = Math.min(top, r.y - (b.y + b.h));
      if (b.y >= r.y + r.h - 0.01) bottom = Math.min(bottom, b.y - (r.y + r.h));
    }
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const seg = (x1: number, y1: number, x2: number, y2: number, v: number, key: string) =>
    v > 0.4 ? (
      <g key={key}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="gap-line" strokeWidth={0.5} />
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} dy={fs * 0.3} fontSize={fs * 0.8} textAnchor="middle" className="gap-text" transform={up((x1 + x2) / 2, (y1 + y2) / 2)}>
          {fmt(v, units)}
        </text>
      </g>
    ) : null;
  return (
    <g pointerEvents="none">
      {seg(r.x - left, cy, r.x, cy, left, 'l')}
      {seg(r.x + r.w, cy, r.x + r.w + right, cy, right, 'r')}
      {seg(cx, r.y - top, cx, r.y, top, 't')}
      {seg(cx, r.y + r.h, cx, r.y + r.h + bottom, bottom, 'b')}
    </g>
  );
}
