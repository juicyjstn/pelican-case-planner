import { useEffect } from 'react';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Gear',
    rows: [
      [['Drag'], 'Move (snaps to walls, dividers and other gear)'],
      [['R'], 'Rotate 90°'],
      [['←', '→', '↑', '↓'], 'Nudge one grid step'],
      [['Shift', 'Arrow'], 'Nudge eight grid steps'],
      [['Alt', 'Arrow'], 'Nudge 0.5 mm'],
      [['Delete'], 'Delete the selection'],
    ],
  },
  {
    title: 'Selecting',
    rows: [
      [['Shift', 'Click'], 'Add or remove an item'],
      [['Shift', 'Drag'], 'Box-select on empty space'],
      [[MOD, 'A'], 'Select all gear'],
      [['Esc'], 'Deselect / leave a tool'],
    ],
  },
  {
    title: 'Tools',
    rows: [
      [['H'], 'Left–right divider'],
      [['V'], 'Top–bottom divider'],
      [['M'], 'Measure (Shift keeps it straight)'],
    ],
  },
  {
    title: 'View & history',
    rows: [
      [['Scroll'], 'Zoom (pinch on touch screens)'],
      [['Drag'], 'Pan on empty space (two fingers on touch)'],
      [['Double-click'], 'Fit the case to the view'],
      [[MOD, 'Z'], 'Undo'],
      [[MOD, 'Shift', 'Z'], 'Redo'],
      [['?'], 'This list'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Keyboard shortcuts</h2>
          <button className="btn icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, what]) => (
                  <div key={what}>
                    <dt>
                      {keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="plus">+</span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
