import { useState, type ReactNode } from 'react';

const KEY = 'pcp.sections';

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function save(id: string, open: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: open }));
  } catch {
    /* storage blocked: the section still works, it just won't be remembered */
  }
}

/**
 * A sidebar panel whose header collapses it. Open/closed is remembered per `id`.
 * `summary` is shown in the header while collapsed, so you can still see the gist.
 */
export function Section({
  id,
  title,
  summary,
  className = '',
  defaultOpen = true,
  children,
}: {
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => load()[id] ?? defaultOpen);
  const toggle = () => {
    setOpen((v) => {
      save(id, !v);
      return !v;
    });
  };
  return (
    <section className={`panel ${className} ${open ? '' : 'collapsed'}`}>
      <h2>
        <button className="section-toggle" onClick={toggle} aria-expanded={open}>
          <span className="sec-title">{title}</span>
          {!open && summary != null && <span className="sec-summary">{summary}</span>}
          <svg viewBox="0 0 24 24" className={`sec-chevron ${open ? 'up' : ''}`} aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h2>
      {open && children}
    </section>
  );
}
