// All lengths are millimetres internally. Display units are a view concern.

export type Units = 'in' | 'mm';
export type DividerStyle = 'none' | 'foam' | 'padded' | 'trekpak';
export type Orientation = 'flat' | 'side' | 'end';
export type WheelSide = 'left' | 'right' | 'none';

export interface CaseSpec {
  id: string;
  model: string;
  line: 'Protector' | 'Air' | 'Custom';
  /** interior length (left-right on screen) */
  l: number;
  /** interior width (top-bottom on screen) */
  w: number;
  /** total interior depth, base + lid */
  d: number;
  lid: number | null;
  base: number | null;
  trekpak: boolean;
  /** Pelican sells this case with TrekPak fitted */
  tpFactory?: boolean;
  /** TrekPak divider height Pelican uses for this case */
  tpHeight?: number | null;
  /**
   * Rolling case: number of wheels. They sit on one short end along the base's bottom edge,
   * at both the front (handle) and back (hinge) corners; 4 = a double wheel at each corner.
   */
  wheels?: number;
  source?: string;
  notes?: string;
}

export interface GearSpec {
  id: string;
  brand: string;
  name: string;
  category: string;
  /** width left-right as it sits on a desk */
  w: number;
  /** depth front-back */
  d: number;
  /** height */
  h: number;
  source?: string;
  notes?: string;
  custom?: boolean;
}

export interface PlacedItem {
  uid: string;
  gearId?: string;
  label: string;
  category: string;
  /** the gear's own dimensions, unrotated */
  gw: number;
  gd: number;
  gh: number;
  orient: Orientation;
  /** rotated 90 degrees in plan */
  rot: boolean;
  /** top-left of the footprint, relative to the interior origin */
  x: number;
  y: number;
  color: string;
  /** optional top-down photo, data URL (never put in share links) */
  image?: string;
}

/** End of a divider: butts against a case wall or the face of another divider. */
export type DividerEnd = { kind: 'wall' } | { kind: 'div'; id: string };

export interface Divider {
  uid: string;
  /** 'h' runs left-right (along x), 'v' runs top-bottom (along y) */
  axis: 'h' | 'v';
  /** centreline coordinate perpendicular to the run */
  pos: number;
  a: DividerEnd;
  b: DividerEnd;
}

export interface Settings {
  /** foam / padding under the gear */
  floorPad: number;
  /** gap to leave around gear when snapping */
  clearance: number;
  grid: number;
  snap: boolean;
  dividerThickness: number;
  /** extra length added to each TrekPak cut for a press fit */
  fitAllowance: number;
  /** TrekPak strip length you buy, for the "how many strips" plan */
  stockLength: number;
  /** pick-n-pluck cube pitch */
  cubeSize: number;
  /** height of dividers; 0 = case default */
  dividerHeight: number;
  /** TrekPak perimeter wall thickness lining each case wall (0 = none) */
  perimeter: number;
  /** TrekPak cuts land on a flute; round cut lengths down to this pitch (0 = off) */
  flutePitch: number;
}

export interface Layout {
  version: 1;
  name: string;
  caseId: string;
  customCase?: { l: number; w: number; d: number; lid: number | null; base: number | null };
  /** which short end the wheels are on; undefined = the case's default */
  wheels?: WheelSide;
  style: DividerStyle;
  items: PlacedItem[];
  dividers: Divider[];
  settings: Settings;
}

/** Resolved divider geometry, centreline from s0 to s1 along its axis. */
export interface ResolvedDivider extends Divider {
  s0: number;
  s1: number;
  /** face-to-face length (what you cut, before allowance) */
  length: number;
  /** rectangle in plan */
  rect: Rect;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
