/**
 * Body shape of the Roadster as longitudinal "rails": every characteristic line of the
 * press-shot side profile / plan view is a curve of car-local x. A cross-section at any
 * x connects the rails in order; `buildLoft` sweeps it along the car.
 *
 * Heights are measured from the ground (`h`) and converted to car-local y (COM origin).
 * Half widths (`z`) are on the +z (right) side; the loft mirrors them.
 */
import { CAR } from "@/core/car-spec";
import { linear, pchip } from "./curve";
import type { Station } from "./loft";

const COM = CAR.comHeight;
const AXLE = CAR.wheelbase / 2;

/**
 * Front face (light bar plane) and Kamm tail plane of the shell. The splitter and
 * the tail panels stand proud of them, flush with the bumper-to-bumper length.
 */
export const X_NOSE = AXLE + CAR.frontOverhang - 0.02;
export const X_TAIL = -AXLE - CAR.rearOverhang + 0.012;
/** Windshield base. */
export const X_COWL = 1.6;
/** Where the side glass' lower edge starts rising, and its rear tip. */
const X_KINK = -0.41;
const X_TIP = -0.953;
/** Rear end of the glass canopy (a painted lip closes the deck behind it). */
const X_RGLASS_END = -2.05;
/** Inner wheel-well wall. */
const WELL_Z = 0.62;

/** Wheel arches: center x and opening radius (the wheel center is at h = wheelRadius). */
const ARCHES = [
  { x: AXLE, r: 0.37 },
  { x: -AXLE, r: 0.39 },
] as const;

/** Station tags for the duplicated stations at the arch edges. */
const ARCH_IN = 1;
const ARCH_OUT = 2;

// ---------------------------------------------------------------------------
// Rails (h = height above ground, z = half width), front = +x.

/** Underside height (flat floor, front lip rise, rear diffuser). */
export const floorH = pchip([
  [X_TAIL, 0.3],
  [-1.95, 0.25],
  [-1.72, 0.18],
  [-1.5, 0.135],
  [-1.25, 0.12],
  [1.25, 0.12],
  [1.55, 0.13],
  [1.8, 0.15],
  [2.05, 0.165],
  [X_NOSE, 0.178],
]);
const floorZ = pchip([
  [X_TAIL, 0.66],
  [-1.9, 0.7],
  [1.9, 0.7],
  [X_NOSE, 0.66],
]);
const sillZ = pchip([
  [X_TAIL, 0.8],
  [-1.9, 0.86],
  [-1.36, 0.875],
  [0, 0.868],
  [1.36, 0.875],
  [1.9, 0.85],
  [2.15, 0.79],
  [X_NOSE, 0.74],
]);

/** Lower edge of the white paint (satin black below). */
const lowH = pchip([
  [X_TAIL, 0.6],
  [-1.85, 0.585],
  [-1.5, 0.5],
  [-1.2, 0.44],
  [-0.95, 0.4],
  [-0.3, 0.33],
  [0.4, 0.27],
  [0.97, 0.235],
  [1.4, 0.235],
  [1.75, 0.225],
  [2.05, 0.2],
  [X_NOSE, 0.19],
]);
const lowZ = pchip([
  [X_TAIL, 0.83],
  [-2.0, 0.885],
  [-1.88, 0.935],
  [-1.75, 0.948],
  [-1.36, 0.955],
  [-0.6, 0.945],
  [0.4, 0.94],
  [0.97, 0.95],
  [1.36, 0.955],
  [1.62, 0.952],
  [1.8, 0.918],
  [2.05, 0.848],
  [X_NOSE, 0.775],
]);

/** Shoulder crease: the widest line of the body. */
const creaseH = pchip([
  [X_TAIL, 0.858],
  [-1.8, 0.862],
  [-1.36, 0.866],
  [-1.02, 0.858],
  [-0.82, 0.84],
  [-0.48, 0.805],
  [-0.14, 0.764],
  [0.2, 0.72],
  [0.54, 0.68],
  [0.85, 0.66],
  [1.05, 0.705],
  [1.2, 0.748],
  [1.36, 0.763],
  [1.55, 0.735],
  [1.75, 0.68],
  [1.95, 0.6],
  [2.15, 0.512],
  [X_NOSE, 0.445],
]);
const creaseZ = pchip([
  [X_TAIL, 0.875],
  [-2.01, 0.93],
  [-1.88, 0.982],
  [-1.75, 0.995],
  [-1.36, 1.0],
  [-0.9, 0.995],
  [-0.3, 0.985],
  [0.4, 0.985],
  [0.9, 0.99],
  [1.36, 1.0],
  [1.62, 1.0],
  [1.8, 0.958],
  [2.05, 0.881],
  [X_NOSE, 0.8],
]);

/** Belt: top of the shoulder facet = glass base in the cabin, hood edge in front. */
const beltH = pchip([
  [X_TAIL, 0.866],
  [-1.8, 0.895],
  [-1.36, 0.93],
  [-1.0, 0.945],
  [-0.7, 0.93],
  [X_KINK, 0.902],
  [-0.14, 0.873],
  [0.2, 0.826],
  [0.54, 0.785],
  [0.88, 0.772],
  [1.1, 0.778],
  [1.285, 0.785],
  [1.36, 0.78],
  [1.45, 0.772],
  [X_COWL, 0.742],
  [1.82, 0.672],
  [2.02, 0.594],
  [2.21, 0.5],
  [X_NOSE, 0.445],
]);
const beltZ = pchip([
  [X_TAIL, 0.85],
  [-2.0, 0.9],
  [-1.85, 0.935],
  [-1.6, 0.95],
  [-1.2, 0.952],
  [-0.8, 0.945],
  [-0.4, 0.938],
  [0.3, 0.935],
  [0.9, 0.938],
  [1.15, 0.942],
  [1.285, 0.945],
  [1.45, 0.948],
  [X_COWL, 0.95],
  [1.8, 0.912],
  [2.05, 0.854],
  [X_NOSE, 0.795],
]);

/** Hood center line (front of the cowl). */
const hoodH = pchip([
  [X_COWL, 0.665],
  [1.8, 0.607],
  [2.0, 0.545],
  [2.15, 0.497],
  [X_NOSE, 0.445],
]);

/** Where the flat hood panel meets the facets rising to the fender peaks (x half width). */
const HOOD_FLAT = 0.6;

/** Hood cross-section: a flat panel in the middle, straight facets up to the fender edges. */
function hoodSectionH(x: number, z: number, edgeZ: number, edgeH: number) {
  const zj = edgeZ * HOOD_FLAT;
  const t = Math.min(1, Math.max(0, (z - zj) / (edgeZ - zj)));
  return hoodH(x) + (edgeH - hoodH(x)) * t + 0.004 * (1 - z / edgeZ);
}

const RAIL_INSET = 0.04;
/** Painted canopy frame: on the side glass' top edge and on the roof edge. */
const FRAME_SIDE = 0.02;
const FRAME_WIDTH = 0.016;

// Canopy rail and crown, anchored to the hood values at the cowl.
const cowlRailZ = beltZ(X_COWL) - RAIL_INSET;
const cowlRailH = hoodSectionH(X_COWL, cowlRailZ, beltZ(X_COWL), beltH(X_COWL));
const railH = pchip([
  [X_TAIL, 0.872],
  [-1.91, 0.89],
  [-1.72, 0.914],
  [-1.36, 0.966],
  [X_TIP, 1.022],
  [-0.68, 1.064],
  [-0.376, 1.085],
  [-0.1, 1.09],
  [0.122, 1.085],
  [0.315, 1.072],
  [0.56, 1.0],
  [0.8, 0.93],
  [1.045, 0.858],
  [1.25, 0.8],
  [1.45, 0.776],
  [X_COWL, cowlRailH],
]);
const railZ = pchip([
  [X_TAIL, 0.8],
  [-1.8, 0.8],
  [-1.36, 0.795],
  [X_TIP, 0.785],
  [-0.5, 0.775],
  [0.1, 0.77],
  [0.5, 0.78],
  [0.8, 0.8],
  [1.05, 0.84],
  [1.25, 0.88],
  [1.45, 0.903],
  [X_COWL, cowlRailZ],
]);
/** Roof center height above the rails (convex windshield, near-flat roof, V at the cowl). */
const crown = linear([
  [X_TAIL, 0.004],
  [-1.36, 0.008],
  [-0.5, 0.03],
  [0, 0.03],
  [0.4, 0.032],
  [0.8, 0.034],
  [1.05, 0.024],
  [1.25, 0.0],
  [1.45, -0.03],
  [X_COWL, hoodSectionH(X_COWL, 0, beltZ(X_COWL), beltH(X_COWL)) - cowlRailH],
]);

// ---------------------------------------------------------------------------
// Section layout.

/** Half-section point indices. */
export const P = {
  K: 0,
  F: 1,
  S: 2,
  L: 3,
  M: 4,
  C: 5,
  B: 6,
  W: 7,
  /** Lower edge of the painted frame along the side glass' top. */
  Rf: 8,
  R: 9,
  Ri: 10,
  /** First roof / hood interior point; `roofPoints` of them, then the top center. */
  T: 11,
} as const;

export const MAT_PAINT = 0;
export const MAT_BLACK = 1;
export const MAT_GLASS = 2;

export function halfCount(roofPoints: number): number {
  return P.T + roofPoints + 1;
}

/** Arch opening top (h) at x, or -Infinity outside the arches. */
function archAt(x: number, tag: number | undefined): number {
  for (const a of ARCHES) {
    const dx = x - a.x;
    if (Math.abs(dx) > a.r + 1e-6) continue;
    const edge = Math.abs(Math.abs(dx) - a.r) < 1e-6;
    if (edge && tag !== ARCH_IN) continue;
    return CAR.wheelRadius + Math.sqrt(Math.max(0, a.r * a.r - dx * dx));
  }
  return -Infinity;
}

/**
 * Writes the half section at a station: z (half width) and y (car-local).
 * `roofPoints` interior points between the rail and the top center.
 */
export function bodySection(
  st: Station,
  roofPoints: number,
  z: Float64Array,
  y: Float64Array
): void {
  const x = st.x;
  const set = (i: number, zz: number, hh: number) => {
    z[i] = zz;
    y[i] = hh - COM;
  };

  // Lower body + wheel wells.
  const fl = floorH(x);
  const ch = creaseH(x);
  const cz = creaseZ(x);
  const lz0 = lowZ(x);
  const lh0 = lowH(x);
  let lz = lz0;
  let lh = lh0;
  let fz = floorZ(x);
  let sz = sillZ(x);
  let sh = Math.min(fl + 0.03, lh - 0.012);
  // Side surface (paint edge to crease) as a function of height; the mid point
  // is taken from the un-arched edge so it stays put at the arch edges.
  const sideAt = (h: number) => lz0 + (cz - lz0) * ((h - lh0) / (ch - lh0));
  let mh = (lh + ch) / 2;
  const arch = archAt(x, st.tag);
  if (arch > -Infinity) {
    const top = Math.min(arch, ch - 0.012);
    if (top > lh) {
      // Slide the paint edge up the side surface to the arch.
      mh = Math.max(mh, top + (ch - top) * 0.4);
      lz = sideAt(top);
      lh = top;
    }
    sz = WELL_Z;
    sh = lh;
    fz = WELL_Z;
  }
  set(P.K, 0, fl);
  set(P.F, fz, fl);
  set(P.S, sz, sh);
  set(P.L, lz, lh);
  // Slight convexity of the side, fading out where the mid point nears the crease
  // (over the arches) so the body never exceeds CAR.width.
  const bulge = 0.01 * Math.min(1, (2 * (ch - mh)) / (ch - lh0));
  set(P.M, sideAt(mh) + bulge, mh);
  set(P.C, cz, ch);

  // Shoulder, glass and roof / hood.
  const bz = beltZ(x);
  const bh = beltH(x);
  set(P.B, bz, bh);
  const top = P.T + roofPoints;

  if (x >= X_COWL - 1e-9) {
    const rz = bz - RAIL_INSET;
    const riz = rz - FRAME_WIDTH;
    const rfz = bz - RAIL_INSET / 2;
    set(P.W, bz, bh);
    set(P.Rf, rfz, hoodSectionH(x, rfz, bz, bh));
    set(P.R, rz, hoodSectionH(x, rz, bz, bh));
    set(P.Ri, riz, hoodSectionH(x, riz, bz, bh));
    // T1 sits on the flat-panel / facet junction, the rest spread over the panel.
    const zj = bz * HOOD_FLAT;
    for (let k = 1; k <= roofPoints; k++) {
      const tz = zj * (1 - (k - 1) / roofPoints);
      set(P.T + k - 1, tz, hoodSectionH(x, tz, bz, bh));
    }
    set(top, 0, hoodSectionH(x, 0, bz, bh));
    return;
  }

  const rz = railZ(x);
  const rh = railH(x);
  const tch = rh + crown(x);
  // Side-glass lower edge: on the belt in front, rising to the rail at the tip.
  let wt = 0;
  if (x <= X_TIP) wt = 1;
  else if (x < X_KINK) {
    const u = (X_KINK - x) / (X_KINK - X_TIP);
    const wh = beltH(X_KINK) + (railH(X_TIP) - beltH(X_KINK)) * u;
    wt = Math.min(1, Math.max(0, (wh - bh) / (rh - bh)));
  }
  const wz = bz + (rz - bz) * wt;
  const wh = bh + (rh - bh) * wt;
  set(P.W, wz, wh);
  // Painted frame strip on the side glass' top edge (all frame where the glass tapers out).
  const side = Math.hypot(wz - rz, wh - rh);
  const f = side > 1e-6 ? Math.min(1, FRAME_SIDE / side) : 0;
  set(P.Rf, rz + (wz - rz) * f, rh + (wh - rh) * f);
  set(P.R, rz, rh);
  // Thin painted frame along the rail, then the glass roof (parabolic crown).
  const dz = -rz;
  const dh = tch - rh;
  const len = Math.hypot(dz, dh);
  const riz = rz + (dz / len) * FRAME_WIDTH;
  const rih = rh + (dh / len) * FRAME_WIDTH;
  set(P.Ri, riz, rih);
  for (let k = 1; k <= roofPoints; k++) {
    const tz = riz * (1 - k / (roofPoints + 1));
    const u = tz / riz;
    set(P.T + k - 1, tz, tch - (tch - rih) * u * u);
  }
  set(top, 0, tch);
}

/** Material of half-section segment j over [x0, x1] (x0 < x1). */
export function bodyMaterial(j: number, x0: number, x1: number): number {
  if (j <= P.S) return MAT_BLACK;
  if (j < P.B) return MAT_PAINT;
  if (j === P.B) return x0 >= X_KINK - 1e-9 ? -1 : MAT_PAINT;
  if (j === P.W) {
    if (x1 <= X_TIP + 1e-9) return -1;
    return x0 >= X_COWL - 1e-9 ? MAT_PAINT : MAT_GLASS;
  }
  if (j === P.Rf) return x1 <= X_TIP + 1e-9 ? -1 : MAT_PAINT;
  if (j === P.R) return MAT_PAINT;
  const glass = x1 <= X_COWL + 1e-9 && x0 >= X_RGLASS_END - 1e-9;
  return glass ? MAT_GLASS : MAT_PAINT;
}

/** Hard edges of the section at x (the hood panel's side edges only exist in front of the cowl). */
export function bodyCrease(j: number, x: number): boolean {
  if (j === P.T) return x >= X_COWL - 1e-9;
  return (
    j === P.F ||
    j === P.S ||
    j === P.L ||
    j === P.C ||
    j === P.W ||
    j === P.Rf ||
    j === P.R ||
    j === P.Ri
  );
}

/** Stations from tail to nose: `step` spacing, denser in the arches, exact at every feature line. */
export function bodyStations(step: number, archStep: number): Station[] {
  const out: Station[] = [];
  const fixed: Station[] = [
    { x: X_TAIL },
    { x: X_RGLASS_END },
    { x: X_TIP },
    { x: X_KINK },
    // The windshield base: a hard edge from the belt up.
    { x: X_COWL, crease: [P.B, Infinity] },
    { x: X_NOSE },
  ];
  for (const a of ARCHES) {
    // The arch only changes the lower body: split normals up to the paint edge.
    const crease = [P.K, P.L] as const;
    fixed.push({ x: a.x - a.r, crease, tag: ARCH_OUT });
    fixed.push({ x: a.x - a.r, crease, tag: ARCH_IN });
    fixed.push({ x: a.x + a.r, crease, tag: ARCH_IN });
    fixed.push({ x: a.x + a.r, crease, tag: ARCH_OUT });
    // Dense, cosine-spaced stations across the arch so the opening is round.
    const n = Math.max(6, Math.ceil((Math.PI * a.r) / archStep));
    for (let i = 1; i < n; i++) {
      fixed.push({ x: a.x - a.r * Math.cos((Math.PI * i) / n) });
    }
  }
  // Stable sort: arch-edge pairs keep their OUT, IN order going into an arch and
  // IN, OUT coming out of it, so the zero-length faces between them close the arch.
  fixed.sort((a, b) => a.x - b.x);
  // Fill the gaps with evenly spaced stations.
  for (let i = 0; i < fixed.length; i++) {
    const st = fixed[i];
    const prev = out[out.length - 1];
    if (prev && st.x - prev.x > step * 1.2) {
      const n = Math.ceil((st.x - prev.x) / step);
      const x0 = prev.x;
      for (let k = 1; k < n; k++) out.push({ x: x0 + ((st.x - x0) * k) / n });
    }
    out.push(st);
  }
  return out;
}
