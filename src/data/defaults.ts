import type { DividerStyle, Settings } from '../types';
import { inch } from '../lib/units';

export interface StyleInfo {
  id: DividerStyle;
  name: string;
  blurb: string;
  thickness: number;
  usesDividers: boolean;
}

// Thickness values are starting points; every one is editable in Settings.
export const STYLES: StyleInfo[] = [
  { id: 'none', name: 'Empty', blurb: 'Bare shell. Plan placement and check lid clearance.', thickness: 0, usesDividers: false },
  { id: 'foam', name: 'Foam', blurb: 'Pick-n-pluck or custom-cut foam. Shows cubes to pluck.', thickness: 0, usesDividers: false },
  { id: 'padded', name: 'Padded dividers', blurb: 'Hook-and-loop padded dividers.', thickness: inch(0.5), usesDividers: true },
  { id: 'trekpak', name: 'TrekPak', blurb: 'Cut-to-fit dividers joined with pins. Generates a cut list.', thickness: 11, usesDividers: true },
];

export function defaultSettings(style: DividerStyle): Settings {
  const s = STYLES.find((x) => x.id === style) ?? STYLES[3];
  return {
    floorPad: style === 'trekpak' ? inch(1) : style === 'foam' ? inch(0.5) : style === 'none' ? 0 : inch(0.25),
    clearance: inch(1 / 16),
    grid: inch(1 / 8),
    snap: true,
    dividerThickness: s.thickness || 11,
    fitAllowance: 0,
    // Pelican sells spare TrekPak strips in 15", 23" and 30" lengths.
    stockLength: inch(23),
    cubeSize: inch(0.5),
    dividerHeight: 0,
    // Pelican: TrekPak panels are 7/16" (11 mm); kits ship with perimeter wall panels.
    perimeter: style === 'trekpak' ? 11 : 0,
    flutePitch: 0,
  };
}

export const CATEGORY_COLORS: Record<string, string> = {
  'Audio Interface': '#e8553d',
  Microphone: '#5b8def',
  Recorder: '#2bb39b',
  Mixer: '#2bb39b',
  Headphones: '#a66bd9',
  Wireless: '#d9a13b',
  Camera: '#3a3f47',
  Lens: '#6b7280',
  Drone: '#8892a0',
  Gimbal: '#8892a0',
  Lighting: '#f2c94c',
  Video: '#14a3c7',
  Computer: '#9aa3ad',
  Tablet: '#9aa3ad',
  Power: '#4caf50',
  Controller: '#ef6aa7',
  Synth: '#ff8a3d',
  'Mixer / Recorder': '#2bb39b',
  'Wireless IEM / Mic': '#d9a13b',
  'Camera / Lens': '#4a5160',
  'Lighting / Video': '#14a3c7',
  'Laptop / Tablet': '#9aa3ad',
  Misc: '#7c8796',
};

export function colorFor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Misc;
}
