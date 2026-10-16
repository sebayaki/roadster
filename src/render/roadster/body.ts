import * as THREE from "three";
import { CAR, NOZZLE_POSITIONS } from "@/core/car-spec";
import { clamp } from "@/core/math";
import { GLOW, PALETTE } from "@/render/palette";
import { box, flipWinding, merge, mirrorZ, prep, prismXY, tint } from "./geo";
import { buildLoft, capRing, type Station } from "./loft";
import {
  MAT_BLACK,
  MAT_GLASS,
  MAT_PAINT,
  P,
  X_COWL,
  X_NOSE,
  X_TAIL,
  bodyCrease,
  bodyMaterial,
  bodySection,
  bodyStations,
  floorH,
  halfCount,
} from "./shape";

const COM = CAR.comHeight;
/** Ground height (m) to car-local y. */
const Y = (h: number) => h - COM;

/** Geometries of the static body, grouped by material. */
export interface BodyGeometries {
  paint: THREE.BufferGeometry;
  /** Satin black lower body, wells, splitter, diffuser. */
  black: THREE.BufferGeometry;
  /** Glossy black front fascia and tail panel. */
  gloss: THREE.BufferGeometry;
  /** Dark titanium nozzle rings. */
  rings: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  /** HDR vertex-colored lamps: front light bar, side markers. */
  lamps: THREE.BufferGeometry;
  /** Full-width tail light bar (its own material: brightness follows the brake). */
  tailBar: THREE.BufferGeometry;
  /** Interior seen through the glass (vertex colors). */
  interior: THREE.BufferGeometry;
  /** Down-facing nozzle disc (instanced at the four nozzles). */
  nozzleDisc: THREE.BufferGeometry;
  /** Car-local y of each nozzle disc, order FL, FR, RL, RR. */
  nozzleDiscY: number[];
  /** Rear plate quad with UVs. */
  plate: THREE.BufferGeometry;
}

const sectionZ = new Float64Array(halfCount(1));
const sectionY = new Float64Array(halfCount(1));

/** Body section at x (half widths / car-local y, see `P`); shared scratch arrays. */
function sectionAt(x: number): { z: Float64Array; y: Float64Array } {
  bodySection({ x }, 1, sectionZ, sectionY);
  return { z: sectionZ, y: sectionY };
}

/** Half width of the outer side surface (paint edge up to the glass) at x, height h. */
function surfaceZ(x: number, h: number): number {
  const { z, y } = sectionAt(x);
  const yy = Y(h);
  for (let j = P.L; j < P.W; j++) {
    if (yy <= y[j + 1] || j === P.W - 1) {
      const span = y[j + 1] - y[j];
      const t = span > 1e-6 ? clamp((yy - y[j]) / span, 0, 1) : 0;
      return z[j] + (z[j + 1] - z[j]) * t;
    }
  }
  return z[P.C];
}

/** A thin plate hugging the right side surface plus its mirror on the left. */
function sidePatch(
  x0: number,
  x1: number,
  h0: number,
  h1: number,
  lift: number
): THREE.BufferGeometry[] {
  const steps = 6;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i++) {
    const a = x0 + ((x1 - x0) * i) / steps;
    const b = x0 + ((x1 - x0) * (i + 1)) / steps;
    const z = Math.max(
      surfaceZ(a, h0),
      surfaceZ(a, h1),
      surfaceZ(b, h0),
      surfaceZ(b, h1)
    );
    parts.push(box(a, b, Y(h0), Y(h1), z - 0.012, z + lift));
  }
  const right = merge(parts);
  return [right, mirrorZ(right)];
}

/**
 * Thin dark strip through right-side surface points (x, y, z), widened along x,
 * plus its mirror: panel gaps and glass frame lines.
 */
function surfaceLine(
  points: Array<[number, number, number]>,
  halfWidth: number
): THREE.BufferGeometry[] {
  const pos: number[] = [];
  const index: number[] = [];
  points.forEach(([x, y, z], i) => {
    pos.push(x - halfWidth, y, z, x + halfWidth, y, z);
    if (i > 0) {
      const a = (i - 1) * 2;
      // Points run upward and +x is to the right seen from +z: counter-clockwise.
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return [g, mirrorZ(g)];
}

/** Door cut from (x0, h0) on the paint edge up to (x1, h1) at the glass, on the paint. */
function doorLine(x0: number, h0: number, x1: number, h1: number) {
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const x = x0 + (x1 - x0) * u;
    const h = h0 + (h1 - h0) * u;
    points.push([x, Y(h), surfaceZ(x, h) + 0.0025]);
  }
  return surfaceLine(points, 0.0035);
}

/** Frame line across the side glass from its lower edge at x0 to its top at x1. */
function glassLine(x0: number, x1: number) {
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const x = x0 + (x1 - x0) * u;
    const { z, y } = sectionAt(x);
    const dz = z[P.Rf] - z[P.W];
    const dy = y[P.Rf] - y[P.W];
    const len = Math.hypot(dz, dy) || 1;
    // Slightly proud of the glass along its outward normal (dy, -dz).
    points.push([
      x,
      y[P.W] + dy * u - (dz / len) * 0.003,
      z[P.W] + dz * u + (dy / len) * 0.003,
    ]);
  }
  return surfaceLine(points, 0.005);
}

function buildLiner(step: number): THREE.BufferGeometry {
  // Interior tub under the glass: rim on the glass' lower edge, floor at seat level
  // in the cabin, a dark tray under the rear glass. Two "materials": dark / light.
  const floor = (x: number) => {
    if (x > 1.0) return 0.64;
    if (x > 0.85) return 0.6 + (x - 0.85) * 0.27;
    if (x > 0.72) return 0.3 + ((x - 0.72) / 0.13) * 0.3;
    if (x > -0.45) return 0.3;
    if (x > -0.75) return 0.3 + ((-0.45 - x) / 0.3) * 0.5;
    if (x > -1.95) return 0.8;
    return 0.8 + ((-1.95 - x) / 0.13) * 0.06;
  };
  const stations: Station[] = [];
  const x0 = X_TAIL + 0.06;
  const x1 = X_COWL + 0.015;
  const n = Math.ceil((x1 - x0) / step);
  for (let i = 0; i <= n; i++) stations.push({ x: x0 + ((x1 - x0) * i) / n });

  const loft = buildLoft({
    stations,
    halfCount: 5,
    materialCount: 2,
    section(st, z, y) {
      // The glass' lower edge (W) is the rim.
      const body = sectionAt(st.x);
      const wz = body.z[P.W];
      const wy = body.y[P.W];
      const fy = Y(floor(st.x));
      z[0] = 0;
      y[0] = fy;
      z[1] = 0.4;
      y[1] = fy;
      z[2] = wz - 0.05;
      y[2] = Math.max(fy, wy - 0.1);
      z[3] = wz - 0.004;
      y[3] = wy - 0.004;
      z[4] = 0;
      y[4] = wy;
    },
    material(j, a, b) {
      if (j === 3) return -1;
      const cabin = a > -0.55 && b < 0.95;
      return cabin && j >= 1 ? 1 : 0;
    },
    crease: (j) => j === 1 || j === 2,
  });
  const [dark, light] = loft.geometries;
  // The loft faces outward (down); the tub is seen from above.
  for (const g of loft.geometries) {
    flipWinding(g);
    g.computeVertexNormals();
  }
  tint(prep(dark, true), new THREE.Color(0x111214));
  tint(prep(light, true), new THREE.Color(0x5e5d5a));
  return merge([dark, light]);
}

function buildInterior(high: boolean): THREE.BufferGeometry {
  const seat = new THREE.Color(0x8a8a86);
  const dark = new THREE.Color(PALETTE.satinBlack);
  const parts: THREE.BufferGeometry[] = [buildLiner(high ? 0.06 : 0.12)];
  const add = (g: THREE.BufferGeometry, c: THREE.Color) =>
    parts.push(tint(g, c));
  for (const side of [-1, 1]) {
    const zc = side * 0.37;
    add(box(-0.42, 0.08, Y(0.3), Y(0.4), zc - 0.23, zc + 0.23), seat);
    // Backrest leaning back from the rear of the cushion.
    const back = box(-0.06, 0.06, 0, 0.56, zc - 0.24, zc + 0.24);
    back.rotateZ(0.32);
    back.translate(-0.4, Y(0.36), 0);
    add(back, seat);
  }
  add(box(-0.3, 0.72, Y(0.3), Y(0.47), -0.1, 0.1), seat);
  add(box(0.72, 1.02, Y(0.5), Y(0.63), -0.8, 0.8), dark);
  add(box(0.68, 0.71, Y(0.64), Y(0.8), -0.12, 0.24), dark);
  // Yoke (left-hand drive): a thin rectangular rim tilted toward the driver.
  const yoke = merge([
    box(0, 0.03, -0.08, -0.06, -0.13, 0.13),
    box(0, 0.03, 0.06, 0.08, -0.13, 0.13),
    box(0, 0.03, -0.08, 0.08, -0.13, -0.1),
    box(0, 0.03, -0.08, 0.08, 0.1, 0.13),
  ]);
  yoke.rotateZ(0.35);
  yoke.translate(0.6, Y(0.68), -0.37);
  add(yoke, seat);
  return merge(parts);
}

export function buildBody(high: boolean): BodyGeometries {
  const roofPoints = high ? 4 : 2;
  const loft = buildLoft({
    stations: bodyStations(high ? 0.035 : 0.075, high ? 0.016 : 0.04),
    halfCount: halfCount(roofPoints),
    materialCount: 3,
    section: (st, z, y) => bodySection(st, roofPoints, z, y),
    material: bodyMaterial,
    crease: bodyCrease,
  });
  const paint = [loft.geometries[MAT_PAINT]];
  const black = [loft.geometries[MAT_BLACK]];
  const gloss: THREE.BufferGeometry[] = [];
  const glass = loft.geometries[MAT_GLASS];

  // End caps: recessed fascia under the light bar, flat Kamm tail.
  const centroid = (ring: Float32Array) => {
    let y = 0;
    for (let i = 1; i < ring.length; i += 3) y += ring[i];
    return y / (ring.length / 3);
  };
  const front = loft.rings[loft.rings.length - 1];
  const rear = loft.rings[0];
  gloss.push(
    capRing(front, new THREE.Vector3(X_NOSE - 0.04, centroid(front), 0), true)
  );
  black.push(
    capRing(rear, new THREE.Vector3(X_TAIL + 0.012, centroid(rear), 0), false)
  );

  // Front splitter: a thin blade under the nose that sweeps back to the wheels.
  const splitter = prismXY(
    [
      [X_NOSE + 0.02, -0.8],
      [X_NOSE + 0.02, 0.8],
      [2.2, 0.885],
      [1.92, 0.93],
      [1.8, 0.905],
      [1.8, -0.905],
      [1.92, -0.93],
      [2.2, -0.885],
    ],
    0,
    0.024
  );
  splitter.rotateX(-Math.PI / 2);
  splitter.translate(0, Y(0.152), 0);
  black.push(splitter);

  // Side sill blades between the wheels (slightly proud of the lower body).
  for (const side of [-1, 1]) {
    const blade = prismXY(
      [
        [-0.93, Y(0.13)],
        [0.95, Y(0.13)],
        [0.95, Y(0.165)],
        [-0.93, Y(0.195)],
      ],
      0,
      0.05
    );
    blade.translate(0, 0, side > 0 ? 0.855 : -0.905);
    black.push(blade);
  }

  // Rear diffuser strakes: fins under the rising diffuser roof, bottoms near floor level.
  const xs = [-1.55, -1.75, -1.95, X_TAIL + 0.005];
  const strake: Array<[number, number]> = [
    [xs[0], Y(floorH(xs[0]) + 0.005)],
    [xs[0], Y(floorH(xs[0]) - 0.005)],
    [xs[3], Y(0.185)],
    [xs[3], Y(floorH(xs[3]) + 0.01)],
    [xs[2], Y(floorH(xs[2]) + 0.005)],
    [xs[1], Y(floorH(xs[1]) + 0.005)],
  ];
  for (const zc of [-0.52, -0.27, 0, 0.27, 0.52]) {
    black.push(prismXY(strake, zc - 0.007, zc + 0.007));
  }

  // Kamm tail: glossy black panel with the light bar, a painted lip below it.
  gloss.push(
    box(X_TAIL - 0.007, X_TAIL + 0.02, Y(0.745), Y(0.856), -0.87, 0.87)
  );
  paint.push(
    box(X_TAIL - 0.009, X_TAIL + 0.02, Y(0.728), Y(0.745), -0.87, 0.87)
  );
  black.push(
    box(X_TAIL - 0.004, X_TAIL + 0.02, Y(0.555), Y(0.725), -0.19, 0.19)
  );
  const tailBar = box(X_TAIL - 0.012, X_TAIL, Y(0.795), Y(0.811), -0.85, 0.85);

  // Lamps (HDR vertex colors): front light bar, amber front markers, red rear markers.
  const lampParts: THREE.BufferGeometry[] = [];
  lampParts.push(
    tint(
      box(X_NOSE - 0.012, X_NOSE + 0.004, Y(0.427), Y(0.437), -0.785, 0.785),
      GLOW.white.clone().multiplyScalar(0.4)
    )
  );
  const amber = new THREE.Color(2.4, 0.75, 0.08);
  const red = new THREE.Color(3.2, 0.12, 0.1);
  for (const g of sidePatch(0.99, 1.07, 0.586, 0.602, 0.004)) {
    lampParts.push(tint(g, amber));
  }
  for (const g of sidePatch(-1.88, -1.78, 0.612, 0.624, 0.004)) {
    lampParts.push(tint(g, red));
  }
  // Black vent slot behind the front wheel.
  black.push(...sidePatch(0.84, 0.99, 0.585, 0.603, 0.002));
  // Door cuts and the door glass frame lines (as in the press shots).
  gloss.push(...doorLine(0.78, 0.26, 0.88, 0.76));
  gloss.push(...doorLine(-0.165, 0.3, -0.33, 0.865));
  gloss.push(...glassLine(1.04, 0.66));
  gloss.push(...glassLine(0.97, 0.58));
  gloss.push(...glassLine(-0.19, -0.36));

  // Dark titanium nozzle rings and the down-facing glow disc template.
  const rings: THREE.BufferGeometry[] = [];
  for (const [x, , z] of NOZZLE_POSITIONS) {
    const ring = new THREE.TorusGeometry(0.06, 0.014, 8, high ? 24 : 12);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, Y(floorH(x) - 0.012), z);
    rings.push(prep(ring));
  }
  const nozzleDisc = new THREE.CircleGeometry(0.052, high ? 20 : 12);
  nozzleDisc.rotateX(Math.PI / 2);
  prep(nozzleDisc);
  const nozzleDiscY = NOZZLE_POSITIONS.map(([x]) => Y(floorH(x) - 0.018));

  // Rear plate (keeps UVs for its texture).
  const plate = new THREE.PlaneGeometry(0.3, 0.15);
  plate.rotateY(-Math.PI / 2);
  plate.translate(X_TAIL - 0.008, Y(0.64), 0);

  return {
    paint: merge(paint),
    black: merge(black),
    gloss: merge(gloss),
    rings: merge(rings),
    glass,
    lamps: merge(lampParts),
    tailBar,
    interior: buildInterior(high),
    nozzleDisc,
    nozzleDiscY,
    plate,
  };
}
