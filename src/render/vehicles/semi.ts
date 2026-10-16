import { clamp } from "@/core/math";
import type { Quality } from "@/core/types";
import {
  grid,
  type MeshBuilder,
  type P2,
  type P3,
  SLOT,
  type Slot,
  strip,
} from "./geometry";
import type { Envelope } from "./specs";
import { addWheel } from "./wheels";

/**
 * Horizontal slice of the cab: a plan-view rounded rectangle from the back wall
 * (x = BACK) to the front `xf`, half-width `w`, front corner radius `rf`.
 */
interface Slice {
  y: number;
  xf: number;
  w: number;
  rf: number;
}

const BACK = -0.75;
const BACK_R = 0.1;
/** Rear edge of the door window; glass wraps from here around the front. */
const WINDOW_X = 1.55;
const GLASS_BOTTOM = 1.9;
const GLASS_TOP = 3.05;
/** A-pillar position on the front corner arc (rad from straight ahead) and width (m). */
const PILLAR_ANGLE = 1.15;
const PILLAR_WIDTH = 0.08;

/** Cab skin, bottom to roof: tall nose, 45° wraparound windshield, roof rising to the back. */
const CAB: Slice[] = [
  { y: 1.08, xf: 3.7, w: 1.19, rf: 0.42 },
  { y: 1.2, xf: 3.72, w: 1.2, rf: 0.45 },
  { y: 1.45, xf: 3.68, w: 1.2, rf: 0.5 },
  { y: 1.7, xf: 3.58, w: 1.2, rf: 0.56 },
  { y: GLASS_BOTTOM, xf: 3.44, w: 1.19, rf: 0.62 },
  { y: 2.2, xf: 3.15, w: 1.18, rf: 0.69 },
  { y: 2.5, xf: 2.84, w: 1.18, rf: 0.76 },
  { y: 2.8, xf: 2.53, w: 1.19, rf: 0.83 },
  { y: GLASS_TOP, xf: 2.25, w: 1.2, rf: 0.89 },
  { y: 3.22, xf: 2.0, w: 1.21, rf: 0.94 },
  { y: 3.4, xf: 1.72, w: 1.215, rf: 0.98 },
  { y: 3.57, xf: 1.36, w: 1.215, rf: 1.0 },
  { y: 3.7, xf: 1.02, w: 1.2, rf: 1.0 },
  { y: 3.82, xf: 0.62, w: 1.17, rf: 0.95 },
  { y: 3.92, xf: 0.25, w: 1.14, rf: 0.6 },
  { y: 4.0, xf: -0.05, w: 1.1, rf: 0.3 },
];

/** Front bumper / lower fascia ahead of the front wheels (from x = BUMPER_BACK forward). */
const BUMPER_BACK = 3.0;
const BUMPER: Slice[] = [
  { y: 0.42, xf: 3.6, w: 1.16, rf: 0.36 },
  { y: 0.5, xf: 3.68, w: 1.19, rf: 0.4 },
  { y: 0.62, xf: 3.73, w: 1.2, rf: 0.42 },
  { y: 0.85, xf: 3.75, w: 1.2, rf: 0.42 },
  { y: 1.08, xf: 3.7, w: 1.19, rf: 0.42 },
];

const FRONT_AXLE = 2.4;
const DRIVE_AXLES = [-2.0, -3.15];
const TIRE = 0.52;

/** Points per outline part: back wall, back corner, side (two parts), front corner, front. */
interface Counts {
  back: number;
  backArc: number;
  sideA: number;
  sideB: number;
  frontArc: number;
  front: number;
}

const sliceAt = (keys: Slice[], y: number): Slice => {
  let i = 0;
  while (i < keys.length - 2 && y > keys[i + 1].y) i++;
  const a = keys[i];
  const c = keys[i + 1];
  const t = clamp((y - a.y) / (c.y - a.y), 0, 1);
  const mix = (p: number, q: number) => p + (q - p) * t;
  return { y, xf: mix(a.xf, c.xf), w: mix(a.w, c.w), rf: mix(a.rf, c.rf) };
};

/** Front corner radius limited so the outline stays a valid rounded rectangle. */
const frontRadius = (s: Slice, back: number) =>
  Math.min(s.rf, s.w - 0.01, s.xf - back - BACK_R - 0.01);

/** Half outline (x, z) from the back centerline around to the front centerline. */
function halfOutline(s: Slice, n: Counts, back = BACK, withBack = true): P2[] {
  const rf = frontRadius(s, back);
  const pts: P2[] = [];
  const line = (a: P2, c: P2, k: number) => {
    if (!pts.length) pts.push(a);
    for (let i = 1; i <= k; i++) {
      pts.push([
        a[0] + ((c[0] - a[0]) * i) / k,
        a[1] + ((c[1] - a[1]) * i) / k,
      ]);
    }
  };
  const arc = (
    cx: number,
    cz: number,
    r: number,
    a0: number,
    a1: number,
    k: number
  ) => {
    for (let i = 1; i <= k; i++) {
      const a = a0 + ((a1 - a0) * i) / k;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  };
  const side = s.xf - rf;
  if (withBack) {
    line([back, 0], [back, s.w - BACK_R], n.back);
    arc(back + BACK_R, s.w - BACK_R, BACK_R, Math.PI, Math.PI / 2, n.backArc);
    const win = Math.min(Math.max(WINDOW_X, back + BACK_R), side);
    line([back + BACK_R, s.w], [win, s.w], n.sideA);
    line([win, s.w], [side, s.w], n.sideB);
  } else {
    line([back, s.w], [side, s.w], n.sideB);
  }
  arc(side, s.w - rf, rf, Math.PI / 2, 0, n.frontArc);
  line([s.xf, s.w - rf], [s.xf, 0], n.front);
  return pts;
}

/** The same outline reversed: from the front centerline outward and back along the side. */
const frontFirst = (s: Slice, n: Counts): P2[] => halfOutline(s, n).reverse();

/** Front surface x at lateral offset |z| for a slice. */
function frontX(s: Slice, z: number): number {
  const rf = frontRadius(s, BACK);
  const dz = Math.abs(z) - (s.w - rf);
  return dz <= 0 ? s.xf : s.xf - rf + Math.sqrt(Math.max(0, rf * rf - dz * dz));
}

/** Tall white tractor cab (no trailer): wraparound windshield, aero fairings, tandem drive axles. */
export function buildSemi(
  b: MeshBuilder,
  env: Envelope,
  quality: Quality
): void {
  const high = quality === "high";
  const n: Counts = high
    ? { back: 3, backArc: 3, sideA: 12, sideB: 6, frontArc: 12, front: 4 }
    : { back: 2, backArc: 2, sideA: 5, sideB: 3, frontArc: 6, front: 2 };
  const clampW = (s: Slice): Slice => ({ ...s, w: Math.min(s.w, env(s.y)) });

  // Cab skin.
  const cab = CAB.map(clampW);
  const cols = cab.map((s) => halfOutline(s, n));
  const winIndex = n.back + n.backArc + n.sideA;
  const pts: P3[][] = cols[0].map((_, i) =>
    cab.map((s, j): P3 => [cols[j][i][0], s.y, cols[j][i][1]])
  );
  grid(b, {
    pts,
    slot(i, j) {
      const glass =
        cab[j].y >= GLASS_BOTTOM - 1e-6 && cab[j + 1].y <= GLASS_TOP + 1e-6;
      return glass && i >= winIndex ? SLOT.glass : SLOT.paint;
    },
    capJ0: SLOT.trim,
    capJ1: SLOT.paint,
  });

  // Dark A-pillars where the windshield wraps into the side windows.
  const nx = Math.cos(PILLAR_ANGLE);
  const nz = Math.sin(PILLAR_ANGLE);
  const pillar = cab
    .filter((s) => s.y >= GLASS_BOTTOM - 1e-6 && s.y <= GLASS_TOP + 1e-6)
    .map((s): [P3, P3] => {
      const rf = frontRadius(s, BACK);
      const cx = s.xf - rf + (rf + 0.006) * nx;
      const cz = s.w - rf + (rf + 0.006) * nz;
      const h = PILLAR_WIDTH / 2;
      return [
        [cx + nz * h, s.y, cz - nx * h],
        [cx - nz * h, s.y, cz + nx * h],
      ];
    });
  for (let k = 0; k + 1 < pillar.length; k++) {
    const [a, c] = pillar[k];
    const [a1, c1] = pillar[k + 1];
    b.quad(SLOT.trim, a, a1, c1, c, true);
  }

  // Bumper / lower fascia: black bottom band, white above.
  const nb: Counts = { ...n, sideB: 2 };
  const bumper = BUMPER.map(clampW);
  const bcols = bumper.map((s) => halfOutline(s, nb, BUMPER_BACK, false));
  const bpts: P3[][] = bcols[0].map((_, i) =>
    bumper.map((s, j): P3 => [bcols[j][i][0], s.y, bcols[j][i][1]])
  );
  grid(b, {
    pts: bpts,
    slot: (_, j) => (j === 0 ? SLOT.trim : SLOT.paint),
    capJ0: SLOT.trim,
  });
  b.quad(
    SLOT.trim,
    [BUMPER_BACK, 0.42, -1.16],
    [BUMPER_BACK, 0.42, 1.16],
    [BUMPER_BACK, 1.08, 1.19],
    [BUMPER_BACK, 1.08, -1.19]
  );

  // Thin headlight line wrapping the lower fascia, amber markers over the windshield.
  const lo = sliceAt(CAB, 1.1);
  const hi = sliceAt(CAB, 1.135);
  strip(b, SLOT.light, {
    lower: frontFirst(lo, n),
    upper: frontFirst(hi, n),
    y0: lo.y,
    y1: hi.y,
    s0: 0,
    s1: 1.62,
    end: "front",
  });
  const marker = sliceAt(CAB, GLASS_TOP + 0.06);
  for (const z of [0, 0.14, -0.14, 0.95, -0.95]) {
    b.box(
      SLOT.amber,
      [frontX(marker, z) - 0.004, marker.y, z],
      [0.04, 0.035, 0.075]
    );
  }

  // Lower side fairings between the front wheels and the drive axles.
  const mirrored = (slot: Slot, c: P3, size: P3, rotY = 0) => {
    b.box(slot, c, size, rotY);
    b.box(slot, [c[0], c[1], -c[2]], size, -rotY);
  };
  mirrored(SLOT.paint, [0.2, 0.8, 1.085], [3.2, 0.56, 0.21]);
  mirrored(SLOT.trim, [0.2, 0.48, 1.08], [3.2, 0.08, 0.19]);

  // Camera-style mirrors on arms at the windshield corners.
  const arm = (y: number) => {
    const root: P3 = [2.0, y, 1.1];
    const tip: P3 = [2.56, y, 1.25];
    const dx = tip[0] - root[0];
    const dz = tip[2] - root[2];
    mirrored(
      SLOT.trim,
      [(root[0] + tip[0]) / 2, y, (root[2] + tip[2]) / 2],
      [Math.hypot(dx, dz), 0.045, 0.05],
      -Math.atan2(dz, dx)
    );
  };
  arm(2.72);
  arm(2.22);
  mirrored(SLOT.trim, [2.6, 2.45, 1.255], [0.12, 0.62, 0.09]);

  // Chassis behind the cab: rails, deck plate, fifth wheel, axle housings, bumper, flaps.
  mirrored(SLOT.trim, [-1.05, 0.76, 0.45], [5.3, 0.28, 0.12]);
  b.box(SLOT.trim, [-1.07, 0.94, 0], [0.65, 0.08, 1.9]);
  b.box(SLOT.trim, [-2.58, 1.06, 0], [0.75, 0.2, 1.24]);
  for (const ax of DRIVE_AXLES)
    b.box(SLOT.trim, [ax, TIRE, 0], [0.18, 0.18, 1.2]);
  b.box(SLOT.trim, [-3.675, 0.7, 0], [0.15, 0.3, 2.0]);
  mirrored(SLOT.trim, [-3.71, 0.58, 0.93], [0.03, 0.76, 0.62]);
  mirrored(SLOT.tail, [-3.753, 0.76, 0.82], [0.012, 0.07, 0.22]);

  // Front wheel well, then wheels (drive axles carry duals, drawn as one wide tire).
  b.box(SLOT.trim, [FRONT_AXLE, 0.79, 0], [1.16, 0.56, 1.8]);
  const wheel = (x: number, z: number, width: number) =>
    addWheel(
      b,
      { x, y: TIRE, z, radius: TIRE, width, rim: 0.56, style: "truck" },
      quality
    );
  for (const side of [-1, 1]) {
    wheel(FRONT_AXLE, side * 1.075, 0.31);
    for (const ax of DRIVE_AXLES) wheel(ax, side * 0.93, 0.6);
  }
}
