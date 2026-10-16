import type { Quality } from "@/core/types";
import { linear } from "../roadster/curve";
import { lightBand } from "./car-body";
import { grid, type MeshBuilder, type P3, SLOT, stations } from "./geometry";
import type { Envelope } from "./specs";
import { addWheel } from "./wheels";

const L = 2.84;
/** Roof apex of the triangular roofline, windshield base, back of the cabin glass. */
const APEX = 0.28;
const A_PILLAR = 1.45;
const C_PILLAR = -0.75;
const NOSE_Y = 1.1;
const TAIL_Y = 1.27;
const ROOF_Y = 1.79;
/** Top of the vertical body side, bottom edge of the side glass. */
const PANEL_Y = 1.1;
const WINDOW_Y = 1.16;
/** Half-width of the vertical body side and of the roof edge at the apex. */
const SIDE_Z = 0.988;
const ROOF_EDGE_Z = 0.68;
const AXLES = [1.96, -1.85];
const TIRE = 0.44;
const TRACK_HALF = 0.855;
const TIRE_WIDTH = 0.29;
/** Trapezoid wheel arches: flat top, slanted sides. */
const ARCH_TOP = 0.97;
const ARCH_TOP_HALF = 0.34;
const ARCH_BASE_HALF = 0.64;
const BASE_Y = 0.47;
/** Length of the small plan-view corner chamfers at the nose and the tailgate (m). */
const FRONT_CHAMFER = 0.12;
const REAR_CHAMFER = 0.08;

/** Flat brushed-stainless planes, triangular roofline, light bars across both ends. */
export function buildCybertruck(
  b: MeshBuilder,
  env: Envelope,
  quality: Quality
): void {
  const high = quality === "high";
  const yTop = linear([
    [-L, TAIL_Y],
    [APEX, ROOF_Y],
    [L, NOSE_Y],
  ]);
  const yb = linear([
    [-L, 0.62],
    [-2.45, BASE_Y],
    [2.45, BASE_Y],
    [L, 0.58],
  ]);
  const arch = (x: number): number => {
    let y = -Infinity;
    for (const ax of AXLES) {
      const dx = Math.abs(x - ax);
      if (dx <= ARCH_TOP_HALF) y = Math.max(y, ARCH_TOP);
      else if (dx <= ARCH_BASE_HALF) {
        const t = (dx - ARCH_TOP_HALF) / (ARCH_BASE_HALF - ARCH_TOP_HALF);
        y = Math.max(y, ARCH_TOP + (BASE_Y - ARCH_TOP) * t);
      }
    }
    return y;
  };
  // Vertical body side up to PANEL_Y, then one inclined plane (greenhouse, sail,
  // fender tops) up to the roof edge, so every panel is a true flat facet.
  const tumble = (SIDE_Z - ROOF_EDGE_Z) / (ROOF_Y - PANEL_Y);
  const planeZ = (y: number) => SIDE_Z - Math.max(0, y - PANEL_Y) * tumble;
  const frontSlope = (ROOF_Y - NOSE_Y) / (L - APEX);

  const must = [
    -L,
    -L + REAR_CHAMFER,
    -2.45,
    C_PILLAR,
    APEX,
    A_PILLAR,
    L - (WINDOW_Y - NOSE_Y) / frontSlope,
    2.45,
    L - FRONT_CHAMFER,
    L,
  ];
  for (const ax of AXLES) {
    must.push(
      ax - ARCH_BASE_HALF,
      ax - ARCH_TOP_HALF,
      ax + ARCH_TOP_HALF,
      ax + ARCH_BASE_HALF
    );
  }
  const extra: number[] = [];
  const step = high ? 0.3 : 0.6;
  for (let x = -L + step; x < L; x += step) extra.push(x);
  const xs = stations(must, extra, 0.1);

  const pts: P3[][] = xs.map((x) => {
    const top = yTop(x);
    const base = yb(x);
    const a = arch(x);
    const under = Math.max(base, a);
    const panelY = Math.min(PANEL_Y, top);
    const sillY = Math.min(WINDOW_Y, top);
    const ys = [
      under,
      under,
      Math.max(base + 0.05, a),
      Math.max(base + 0.13, a + 0.08),
      panelY,
      sillY,
      top,
      top,
    ];
    const zs = [0, 0.93, 0.975, SIDE_Z, SIDE_Z, planeZ(sillY), planeZ(top), 0];
    const ramp = (v: number) => Math.min(1, Math.max(0, v));
    const t =
      1 -
      0.04 * ramp((x - (L - FRONT_CHAMFER)) / FRONT_CHAMFER) -
      0.025 * ramp((-L + REAR_CHAMFER - x) / REAR_CHAMFER);
    return ys.map((y, j): P3 => [x, y, Math.min(zs[j] * t, env(y))]);
  });

  grid(b, {
    pts,
    smooth: false,
    slot(i, j) {
      const x = (xs[i] + xs[i + 1]) / 2;
      const cabin = x > C_PILLAR && x < A_PILLAR;
      if (j <= 2) return SLOT.trim;
      if (j === 5) return cabin ? SLOT.glass : SLOT.paint;
      if (j === 6) {
        if (cabin) return SLOT.glass;
        // Dark tonneau cover over the bed, stainless lip at the tailgate.
        return x < C_PILLAR && x > -L + REAR_CHAMFER ? SLOT.trim : SLOT.paint;
      }
      return SLOT.paint;
    },
    capI0: SLOT.paint,
    capI1: SLOT.paint,
  });

  // Black bumpers proud of the front face and the tailgate.
  b.box(SLOT.trim, [L - 0.027, 0.645, 0], [0.062, 0.13, 1.86]);
  b.box(SLOT.trim, [-L + 0.027, 0.69, 0], [0.062, 0.12, 1.84]);
  lightBand(b, SLOT.light, pts, "front", 1.056, 1.084, 0, 1.0);
  lightBand(b, SLOT.tail, pts, "rear", 1.212, 1.244, 0, 0.98);

  const segments = high ? 28 : 14;
  for (const ax of AXLES) {
    const ceiling = ARCH_TOP - 0.02;
    const inner = TRACK_HALF - TIRE_WIDTH / 2 - 0.03;
    b.box(
      SLOT.trim,
      [ax, (BASE_Y + ceiling) / 2, 0],
      [2 * ARCH_BASE_HALF - 0.1, ceiling - BASE_Y, 2 * inner]
    );
    for (const side of [-1, 1]) {
      addWheel(
        b,
        {
          x: ax,
          y: TIRE,
          z: side * TRACK_HALF,
          radius: TIRE,
          width: TIRE_WIDTH,
          rim: 0.6,
          style: "aero",
        },
        segments
      );
    }
  }
}
