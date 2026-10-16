import type { Quality } from "@/core/types";
import {
  type Fn,
  grid,
  type MeshBuilder,
  outlineAtHeight,
  type P3,
  SLOT,
  type Slot,
  stations,
  strip,
} from "./geometry";
import type { Envelope } from "./specs";
import { addWheel, type WheelStyle } from "./wheels";

/** Surface bands of a car body, bottom to top (between consecutive section rows). */
export const BAND = {
  under: 0,
  rocker: 1,
  lower: 2,
  side: 3,
  shoulder: 4,
  /** Side glass in the cabin, fender top over the hood, deck shoulder at the rear. */
  window: 5,
  roofOuter: 6,
  roofInner: 7,
} as const;

/**
 * A smooth passenger-car body as curves along x (rear -halfLength → nose +halfLength).
 * Heights are above the ground, widths are half-widths before the plan-view rounding.
 */
export interface CarBodyDef {
  halfLength: number;
  /** Underside, top centerline (deck / roof / hood), roof rail / hood edge, belt line, widest line. */
  yb: Fn;
  yTop: Fn;
  yRail: Fn;
  yBelt: Fn;
  yShoulder: Fn;
  /** Max half-width, belt half-width, roof-rail half-width. */
  w: Fn;
  wBelt: Fn;
  wRail: Fn;
  /** Length of the plan-view rounding of the nose and tail (superelliptic, m). */
  noseR: number;
  tailR: number;
  /** Axle x positions; wheels are centered at y = tire radius. */
  axles: number[];
  tire: number;
  tireWidth: number;
  /** Wheel center |z|. */
  trackHalf: number;
  /** Rim radius / tire radius. */
  rim: number;
  wheelStyle: WheelStyle;
  archRadius: number;
  /** Extra exact stations (material boundaries) and hard-edged stations. */
  keyXs: number[];
  creaseXs: number[];
  /** Material of a band at x. */
  band(band: number, x: number): Slot;
}

/** Superellipse exponents of the plan-view nose / tail rounding (2 = ellipse). */
const NOSE_POWER = 2.6;
const TAIL_POWER = 2.4;

/** Width of the near-vertical drop at both ends of each wheel arch (m). */
const ARCH_EDGE = 0.004;

/** Row ordering margins below the top centerline (keeps rows stacked at the nose and tail). */
const TOP_MARGIN = [0, 0, 0.12, 0.09, 0.06, 0.035, 0.015, 0.004, 0];

/**
 * Lofts the body (mirrored), its wheels and dark wheel wells. Returns the
 * section grid so callers can wrap light bars around it.
 */
export function carBody(
  b: MeshBuilder,
  d: CarBodyDef,
  env: Envelope,
  quality: Quality
): P3[][] {
  const high = quality === "high";
  const L = d.halfLength;
  const R = d.archRadius;

  // Exact stations where each arch drops to the sill; hard-edged so the side panels stay clean.
  const archEdges = d.axles.flatMap((ax) => [
    ax - R - ARCH_EDGE,
    ax - R,
    ax + R,
    ax + R + ARCH_EDGE,
  ]);
  const must = [-L, L, ...d.keyXs, ...d.creaseXs, ...archEdges];
  const extra: number[] = [];
  const step = high ? 0.07 : 0.16;
  for (let x = -L + step; x < L; x += step) extra.push(x);
  const ends = high ? 10 : 5;
  for (let k = 1; k < ends; k++) {
    const s = Math.sin((k / ends) * (Math.PI / 2));
    extra.push(L - d.noseR + d.noseR * s, -L + d.tailR - d.tailR * s);
  }
  const archSteps = high ? 12 : 6;
  for (const ax of d.axles) {
    for (let k = 1; k < archSteps; k++) {
      extra.push(ax + R * Math.cos((k / archSteps) * Math.PI));
    }
  }
  const xs = stations(must, extra, high ? 0.02 : 0.05);

  const archTop = (x: number): number => {
    let y = -Infinity;
    for (const ax of d.axles) {
      const dx = x - ax;
      if (Math.abs(dx) <= R + 1e-9) {
        y = Math.max(y, d.tire + Math.sqrt(Math.max(0, R * R - dx * dx)));
      }
    }
    return y;
  };
  // Superelliptic plan-view ends: flatter fronts with rounded corners.
  const end = (u: number, p: number) =>
    Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, u), p)), 1 / p);
  const taper = (x: number): number => {
    let t = 1;
    const nose = x - (L - d.noseR);
    if (nose > 0) t = end(nose / d.noseR, NOSE_POWER);
    const tail = -L + d.tailR - x;
    if (tail > 0) t = Math.min(t, end(tail / d.tailR, TAIL_POWER));
    return t;
  };

  const pts: P3[][] = xs.map((x) => {
    const yb = d.yb(x);
    const top = d.yTop(x);
    const arch = archTop(x);
    const rail = d.yRail(x);
    const under = Math.max(yb, arch);
    const ys = [
      under,
      under,
      Math.max(yb + 0.1, arch),
      Math.max(yb + 0.22, arch + 0.035),
      Math.max(d.yShoulder(x), arch + 0.06),
      d.yBelt(x),
      rail,
      rail + 0.72 * (top - rail),
      top,
    ];
    for (let j = 2; j < 8; j++) {
      ys[j] = Math.max(Math.min(ys[j], top - TOP_MARGIN[j]), ys[j - 1] + 0.002);
    }
    const w = d.w(x);
    const wr = d.wRail(x);
    const ws = [
      0,
      0.82 * w,
      0.955 * w,
      0.985 * w,
      w,
      d.wBelt(x),
      wr,
      0.55 * wr,
      0,
    ];
    const t = taper(x);
    return ys.map((y, j): P3 => [x, y, Math.min(ws[j] * t, env(y))]);
  });

  const creases = new Set([...d.creaseXs, ...archEdges]);
  grid(b, {
    pts,
    slot: (i, j) => d.band(j, (xs[i] + xs[i + 1]) / 2),
    creaseI: (i) => creases.has(xs[i]),
    creaseJ: (j) => j === 1 || j === 5 || j === 6,
  });

  // Dark wheel wells hide the view through the arches; then the wheels.
  const segments = high ? 28 : 14;
  for (const ax of d.axles) {
    const floor = d.yb(ax);
    const ceiling = d.tire + R - 0.015;
    const inner = d.trackHalf - d.tireWidth / 2 - 0.03;
    b.box(
      SLOT.trim,
      [ax, (floor + ceiling) / 2, 0],
      [2 * R * 0.92, ceiling - floor, 2 * inner]
    );
    for (const side of [-1, 1]) {
      addWheel(
        b,
        {
          x: ax,
          y: d.tire,
          z: side * d.trackHalf,
          radius: d.tire,
          width: d.tireWidth,
          rim: d.rim,
          style: d.wheelStyle,
        },
        segments
      );
    }
  }
  return pts;
}

/** A light band wrapped around the nose or tail of a lofted body between heights y0..y1. */
export function lightBand(
  b: MeshBuilder,
  slot: Slot,
  pts: P3[][],
  end: "front" | "rear",
  y0: number,
  y1: number,
  s0: number,
  s1: number
): void {
  strip(b, slot, {
    lower: outlineAtHeight(pts, y0, end),
    upper: outlineAtHeight(pts, y1, end),
    y0,
    y1,
    s0,
    s1,
    end,
  });
}
