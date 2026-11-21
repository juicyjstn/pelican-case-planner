import type { CaseSpec, ResolvedDivider, Units } from '../types';
import type { BuildStep } from '../lib/cutlist';
import { fmt } from '../lib/units';

/** One sentence per step, in shop-floor language. */
export function stepText(s: BuildStep, units: Units, perimeter: boolean): string {
  const run = s.axis === 'h' ? 'left-to-right' : 'hinge-to-handle';
  const from = s.offsetFrom === 'hinge' ? 'hinge-side' : 'left-end';
  const wall = perimeter ? `${from} perimeter panel` : `${from} wall`;
  const joins = [s.ends.a, s.ends.b].filter(Boolean) as string[];
  const ends =
    joins.length === 0
      ? 'Both ends press against the walls.'
      : joins.length === 2
        ? `Pin both ends into ${joins[0] === joins[1] ? joins[0] : `${joins[0]} and ${joins[1]}`}.`
        : `Pin one end into ${joins[0]}; the other presses against the wall.`;
  return `Cut ${s.label} to ${fmt(s.length, units)}. Stand it ${run}, ${fmt(s.offset, units)} from the ${wall}. ${ends}`;
}

/** Small plan of the case: already-placed dividers grey, this step's divider highlighted. */
export function StepDiagram({ c, dividers, steps, upto, inset, print = false }: { c: CaseSpec; dividers: Map<string, ResolvedDivider>; steps: BuildStep[]; upto: number; inset: number; print?: boolean }) {
  const pad = 6;
  return (
    <svg viewBox={`${-pad} ${-pad} ${c.l + pad * 2} ${c.w + pad * 2}`} className="step-diagram" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x={0} y={0} width={c.l} height={c.w} rx={4} className="sd-case" fill={print ? '#fff' : undefined} stroke={print ? '#000' : undefined} />
      {inset > 0 && <rect x={inset} y={inset} width={c.l - 2 * inset} height={c.w - 2 * inset} className="sd-perim" fill="none" stroke={print ? '#999' : undefined} />}
      {steps.slice(0, upto).map((s, i) => {
        const d = dividers.get(s.id);
        if (!d) return null;
        const current = i === upto - 1;
        return (
          <rect
            key={s.id}
            x={d.rect.x}
            y={d.rect.y}
            width={d.rect.w}
            height={d.rect.h}
            className={current ? 'sd-current' : 'sd-placed'}
            fill={print ? (current ? '#000' : '#bbb') : undefined}
          />
        );
      })}
      <text x={c.l / 2} y={inset + Math.max(10, c.l / 28)} fontSize={Math.max(10, c.l / 28)} textAnchor="middle" className="sd-label" fill={print ? '#555' : undefined}>
        hinge
      </text>
    </svg>
  );
}
