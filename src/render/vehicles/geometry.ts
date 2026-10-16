import * as THREE from "three";

/** A point or vector [x, y, z] in vehicle space (+x forward, +y up, +z right). */
export type P3 = [number, number, number];

/** A point [x, z] of a plan-view outline. */
export type P2 = [number, number];

/** Material slots shared by every vehicle; each non-empty slot becomes one mesh (one draw call). */
export const SLOT = {
  paint: 0,
  glass: 1,
  trim: 2,
  rim: 3,
  light: 4,
  tail: 5,
  amber: 6,
} as const;
export type Slot = (typeof SLOT)[keyof typeof SLOT];
export const SLOT_NAMES = [
  "paint",
  "glass",
  "trim",
  "rim",
  "light",
  "tail",
  "amber",
] as const;
const SLOT_COUNT = SLOT_NAMES.length;

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: P3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: P3): P3 => {
  const l = norm(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
/** Reflects a point or normal across the z = 0 plane (left/right symmetry). */
export const mirrorZ = (p: P3): P3 => [p[0], p[1], -p[2]];

/**
 * Accumulates triangles per material slot (position + normal), then emits one
 * merged mesh per slot. Build-time only.
 */
export class MeshBuilder {
  private readonly pos: number[][] = [];
  private readonly nor: number[][] = [];

  constructor() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.pos.push([]);
      this.nor.push([]);
    }
  }

  /** One triangle, counter-clockwise seen from outside. Without normals it is flat shaded. */
  tri(slot: Slot, a: P3, b: P3, c: P3, na?: P3, nb?: P3, nc?: P3): void {
    const face = cross(sub(b, a), sub(c, a));
    const area = norm(face);
    if (area < 1e-10) return;
    this.pos[slot].push(...a, ...b, ...c);
    if (na && nb && nc) {
      this.nor[slot].push(...na, ...nb, ...nc);
    } else {
      const f = unit(face);
      this.nor[slot].push(...f, ...f, ...f);
    }
  }

  /** A triangle plus its mirror image across z = 0 (winding flipped to stay outward). */
  triMirrored(
    slot: Slot,
    a: P3,
    b: P3,
    c: P3,
    na?: P3,
    nb?: P3,
    nc?: P3
  ): void {
    this.tri(slot, a, b, c, na, nb, nc);
    const m = (n?: P3) => (n ? mirrorZ(n) : undefined);
    this.tri(slot, mirrorZ(a), mirrorZ(c), mirrorZ(b), m(na), m(nc), m(nb));
  }

  /** Flat quad a-b-c-d (counter-clockwise seen from outside), optionally mirrored to -z. */
  quad(slot: Slot, a: P3, b: P3, c: P3, d: P3, mirror = false): void {
    if (mirror) {
      this.triMirrored(slot, a, b, c);
      this.triMirrored(slot, a, c, d);
    } else {
      this.tri(slot, a, b, c);
      this.tri(slot, a, c, d);
    }
  }

  /**
   * Appends a three.js geometry transformed by `matrix`. Triangle winding is
   * re-derived from the normals, so mirroring matrices are safe.
   */
  geometry(
    slot: Slot,
    geo: THREE.BufferGeometry,
    matrix?: THREE.Matrix4
  ): void {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const pa = src.getAttribute("position");
    const na = src.getAttribute("normal");
    const m = matrix ?? IDENTITY;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const p: P3[] = [];
    const n: P3[] = [];
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      p.push([v.x, v.y, v.z]);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      n.push([v.x, v.y, v.z]);
      if (p.length < 3) continue;
      const face = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const avg: P3 = [
        n[0][0] + n[1][0] + n[2][0],
        n[0][1] + n[1][1] + n[2][1],
        n[0][2] + n[1][2] + n[2][2],
      ];
      if (dot(face, avg) < 0)
        this.tri(slot, p[0], p[2], p[1], n[0], n[2], n[1]);
      else this.tri(slot, p[0], p[1], p[2], n[0], n[1], n[2]);
      p.length = 0;
      n.length = 0;
    }
    if (src !== geo) src.dispose();
  }

  /** Axis-aligned box (optionally rotated about y, then z) centered at `center`. */
  box(slot: Slot, center: P3, size: P3, rotY = 0, rotZ = 0): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...center),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, rotZ)),
      new THREE.Vector3(...size)
    );
    this.geometry(slot, unitBox(), m);
  }

  /** Unit cube transformed by `matrix` (scale = box size). */
  boxMatrix(slot: Slot, matrix: THREE.Matrix4): void {
    this.geometry(slot, unitBox(), matrix);
  }

  /** Total triangle count so far. */
  get triangles(): number {
    return this.pos.reduce((sum, p) => sum + p.length / 9, 0);
  }

  /**
   * One mesh per non-empty slot, using `materials[slot]`. Geometry stays
   * non-indexed: a vehicle has ~20k vertices, and indexing would cost more
   * build time than it saves on the GPU.
   */
  build(materials: readonly THREE.Material[]): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (this.pos[s].length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(this.pos[s], 3)
      );
      geo.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(this.nor[s], 3)
      );
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[s]);
      mesh.name = SLOT_NAMES[s];
      meshes.push(mesh);
    }
    return meshes;
  }
}

const IDENTITY = new THREE.Matrix4();
let boxTemplate: THREE.BoxGeometry | null = null;
/** Shared CPU-side template; it is only ever copied, never rendered. */
function unitBox(): THREE.BoxGeometry {
  boxTemplate ??= new THREE.BoxGeometry(1, 1, 1);
  return boxTemplate;
}

/** Interpolation key [x, y]; a third element (any value) marks a corner (tangent break). */
export type Key = readonly [number, number] | readonly [number, number, number];
export type Fn = (x: number) => number;

/**
 * Monotone cubic (Fritsch–Carlson) interpolation through `keys` (sorted by x),
 * clamped at the ends. It never overshoots, so shapes stay inside their keys.
 * With `smooth = false` it is piecewise linear.
 */
export function curve(keys: readonly Key[], smooth = true): Fn {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++)
    d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  // Tangents leaving (mR) and entering (mL) each key.
  const mR = new Array<number>(n).fill(0);
  const mL = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) mR[0] = d[0] ?? 0;
    else if (i === n - 1) mL[i] = d[i - 1];
    else if (keys[i].length > 2) {
      mL[i] = d[i - 1];
      mR[i] = d[i];
    } else {
      const m = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      mL[i] = m;
      mR[i] = m;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      mR[i] = 0;
      mL[i + 1] = 0;
      continue;
    }
    const a = mR[i] / d[i];
    const b = mL[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      mR[i] = t * a * d[i];
      mL[i + 1] = t * b * d[i];
    }
  }
  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x >= xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    if (!smooth) return ys[i] + (ys[i + 1] - ys[i]) * t;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * mR[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * mL[i + 1]
    );
  };
}

/** Piecewise-linear interpolation (faceted shapes). */
export const linear = (keys: readonly Key[]): Fn => curve(keys, false);

/** Sorted, de-duplicated station list: `must` values are kept exactly, others only if not too close. */
export function stations(
  must: number[],
  extra: number[],
  minGap: number
): number[] {
  const kept = [...new Set(must)].sort((a, b) => a - b);
  for (const x of extra) {
    if (kept.every((k) => Math.abs(k - x) >= minGap)) kept.push(x);
  }
  return kept.sort((a, b) => a - b);
}

export interface GridSpec {
  /**
   * pts[i][j], +z half only: i runs along the body (rear → front, or around a
   * plan outline from the rear centerline to the front centerline), j runs
   * from bottom to top. Boundary lines lying on z = 0 are joined to the mirror half.
   */
  pts: P3[][];
  /** Slot of quad (i, j)–(i + 1, j + 1); -1 leaves a hole. */
  slot: (i: number, j: number) => Slot | -1;
  /** Smooth vertex normals (default) or flat facets. */
  smooth?: boolean;
  /** Hard edge along grid line i / j. */
  creaseI?: (i: number) => boolean;
  creaseJ?: (j: number) => boolean;
  /** Flat caps closing the ends at i = 0 / i = last (facing -x / +x) and j = 0 / j = last (facing -y / +y). */
  capI0?: Slot;
  capI1?: Slot;
  capJ0?: Slot;
  capJ1?: Slot;
}

/** Emits a mirrored grid surface (a loft), with optional flat caps. */
export function grid(b: MeshBuilder, g: GridSpec): void {
  const P = g.pts;
  const I = P.length - 1;
  const J = P[0].length - 1;
  const onAxis = (p: P3) => Math.abs(p[2]) < 1e-5;
  const axisI0 = P[0].every(onAxis);
  const axisI1 = P[I].every(onAxis);
  const axisJ0 = P.every((col) => onAxis(col[0]));
  const axisJ1 = P.every((col) => onAxis(col[J]));
  const smooth = g.smooth ?? true;

  // Area-weighted quad normals; vertex normals average the quads around a vertex
  // that lie on the same side of any crease (robust at collapsed nose/tail tips).
  const quadNormal: P3[][] = [];
  for (let i = 0; i < I; i++) {
    const col: P3[] = [];
    for (let j = 0; j < J; j++) {
      col.push(
        cross(sub(P[i + 1][j + 1], P[i][j]), sub(P[i][j + 1], P[i + 1][j]))
      );
    }
    quadNormal.push(col);
  }
  /** Normal of quad (i, j), reaching across a centerline boundary into the mirror half. */
  const around = (i: number, j: number): P3 | null => {
    let mirror = false;
    if (i < 0 || i >= I) {
      if (!((i < 0 && axisI0) || (i >= I && axisI1))) return null;
      i = i < 0 ? 0 : I - 1;
      mirror = true;
    }
    if (j < 0 || j >= J) {
      if (mirror || !((j < 0 && axisJ0) || (j >= J && axisJ1))) return null;
      j = j < 0 ? 0 : J - 1;
      mirror = true;
    }
    const n = quadNormal[i][j];
    return mirror ? mirrorZ(n) : n;
  };
  const vertexNormal = (vi: number, vj: number, qi: number, qj: number): P3 => {
    const sum: P3 = [0, 0, 0];
    const hardI = g.creaseI?.(vi) ?? false;
    const hardJ = g.creaseJ?.(vj) ?? false;
    for (const i of [vi - 1, vi]) {
      if (hardI && i !== qi) continue;
      for (const j of [vj - 1, vj]) {
        if (hardJ && j !== qj) continue;
        const n = around(i, j);
        if (!n) continue;
        sum[0] += n[0];
        sum[1] += n[1];
        sum[2] += n[2];
      }
    }
    return norm(sum) > 1e-12 ? unit(sum) : unit(quadNormal[qi][qj]);
  };

  for (let i = 0; i < I; i++) {
    for (let j = 0; j < J; j++) {
      const slot = g.slot(i, j);
      if (slot === -1) continue;
      const a = P[i][j];
      const bq = P[i + 1][j];
      const c = P[i + 1][j + 1];
      const d = P[i][j + 1];
      if (!smooth) {
        b.triMirrored(slot, a, bq, c);
        b.triMirrored(slot, a, c, d);
        continue;
      }
      const na = vertexNormal(i, j, i, j);
      const nb = vertexNormal(i + 1, j, i, j);
      const nc = vertexNormal(i + 1, j + 1, i, j);
      const nd = vertexNormal(i, j + 1, i, j);
      b.triMirrored(slot, a, bq, c, na, nb, nc);
      b.triMirrored(slot, a, c, d, na, nc, nd);
    }
  }

  if (g.capI0 !== undefined) cap(b, g.capI0, P[0], [-1, 0, 0]);
  if (g.capI1 !== undefined) cap(b, g.capI1, P[I], [1, 0, 0]);
  if (g.capJ0 !== undefined)
    cap(
      b,
      g.capJ0,
      P.map((col) => col[0]),
      [0, -1, 0]
    );
  if (g.capJ1 !== undefined)
    cap(
      b,
      g.capJ1,
      P.map((col) => col[J]),
      [0, 1, 0]
    );
}

/** Closes a boundary line (+z half) and its mirror image with a flat polygon facing `outward`. */
function cap(b: MeshBuilder, slot: Slot, half: P3[], outward: P3): void {
  const onAxis = (p: P3) => Math.abs(p[2]) < 1e-5;
  const ring: P3[] = [...half];
  const last = half.length - 1;
  for (
    let k = onAxis(half[last]) ? last - 1 : last;
    k >= (onAxis(half[0]) ? 1 : 0);
    k--
  ) {
    ring.push(mirrorZ(half[k]));
  }
  const clean: P3[] = [];
  for (const p of ring) {
    const prev = clean[clean.length - 1];
    if (!prev || norm(sub(p, prev)) > 1e-6) clean.push(p);
  }
  if (clean.length > 3 && norm(sub(clean[0], clean[clean.length - 1])) <= 1e-6)
    clean.pop();
  if (clean.length < 3) return;
  // Project onto the plane perpendicular to the outward axis.
  const ax = Math.abs(outward[0]) > 0.5;
  const contour = clean.map((p) =>
    ax ? new THREE.Vector2(p[2], p[1]) : new THREE.Vector2(p[0], p[2])
  );
  for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const p0 = clean[i0];
    const p1 = clean[i1];
    const p2 = clean[i2];
    if (dot(cross(sub(p1, p0), sub(p2, p0)), outward) >= 0) {
      b.tri(slot, p0, p1, p2, outward, outward, outward);
    } else {
      b.tri(slot, p0, p2, p1, outward, outward, outward);
    }
  }
}

/**
 * Plan-view outline (x, z) of an x-section grid at height `h`, starting on the
 * centerline at the chosen end and running outward along +z, then along the side.
 */
export function outlineAtHeight(
  pts: P3[][],
  h: number,
  end: "front" | "rear"
): P2[] {
  const I = pts.length - 1;
  const out: P2[] = [];
  for (let n = 0; n <= I; n++) {
    const col = pts[end === "front" ? I - n : n];
    let hit: P2 | null = null;
    for (let j = col.length - 1; j > 0; j--) {
      const a = col[j];
      const c = col[j - 1];
      if ((a[1] - h) * (c[1] - h) <= 0 && a[1] !== c[1]) {
        const t = (h - c[1]) / (a[1] - c[1]);
        hit = [c[0] + (a[0] - c[0]) * t, c[2] + (a[2] - c[2]) * t];
        break;
      }
    }
    if (!hit) {
      if (out.length) break;
      continue;
    }
    if (!out.length && hit[1] > 1e-4) out.push([hit[0], 0]);
    out.push(hit);
  }
  return out;
}

export interface StripSpec {
  /** Outlines (x, z) at the strip's lower and upper edges, both starting on the centerline. */
  lower: P2[];
  upper: P2[];
  y0: number;
  y1: number;
  /** Arc-length range along the outline, measured from the centerline (m). */
  s0: number;
  s1: number;
  /** Which end the outline wraps: decides the outward side. */
  end: "front" | "rear";
  /** Outward offset off the surface (m). */
  offset?: number;
}

/** A thin band following a body outline (light bars, tail lights), mirrored to both sides. */
export function strip(b: MeshBuilder, slot: Slot, s: StripSpec): void {
  const off = s.offset ?? 0.006;
  const lo = measure(s.lower);
  const hi = measure(s.upper);
  const sEnd = Math.min(s.s1, lo.total, hi.total);
  if (sEnd <= s.s0) return;
  const samples = [s.s0];
  for (const v of lo.acc) if (v > s.s0 && v < sEnd) samples.push(v);
  samples.push(sEnd);
  const fine: number[] = [];
  for (let k = 0; k < samples.length - 1; k++) {
    const parts = Math.max(1, Math.ceil((samples[k + 1] - samples[k]) / 0.05));
    for (let p = 0; p < parts; p++) {
      fine.push(samples[k] + ((samples[k + 1] - samples[k]) * p) / parts);
    }
  }
  fine.push(sEnd);
  const sign = s.end === "front" ? 1 : -1;
  const edge = (m: Measured, at: number, y: number): [P3, P3] => {
    const [p, t] = pointAt(m, at);
    const n: P3 = [sign * t[1], 0, -sign * t[0]];
    return [[p[0] + n[0] * off, y, p[1] + n[2] * off], n];
  };
  let prev: [P3, P3, P3, P3] | null = null;
  for (const at of fine) {
    const [pl, nl] = edge(lo, at, s.y0);
    const [pu, nu] = edge(hi, at, s.y1);
    if (prev) {
      const [ql, qnl, qu, qnu] = prev;
      if (dot(cross(sub(pl, ql), sub(pu, ql)), nl) >= 0) {
        b.triMirrored(slot, ql, pl, pu, qnl, nl, nu);
        b.triMirrored(slot, ql, pu, qu, qnl, nu, qnu);
      } else {
        b.triMirrored(slot, ql, pu, pl, qnl, nu, nl);
        b.triMirrored(slot, ql, qu, pu, qnl, qnu, nu);
      }
    }
    prev = [pl, nl, pu, nu];
  }
}

interface Measured {
  pts: P2[];
  acc: number[];
  total: number;
}

function measure(pts: P2[]): Measured {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(
      acc[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    );
  }
  return { pts, acc, total: acc[acc.length - 1] ?? 0 };
}

/** Point and unit tangent (x, z) at arc length `s`. */
function pointAt(m: Measured, s: number): [P2, P2] {
  let i = 0;
  while (i < m.pts.length - 2 && s > m.acc[i + 1]) i++;
  const a = m.pts[i];
  const c = m.pts[i + 1] ?? a;
  const seg = m.acc[i + 1] - m.acc[i] || 1;
  const t = Math.min(1, Math.max(0, (s - m.acc[i]) / seg));
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [
    [a[0] + dx * t, a[1] + dz * t],
    [dx / l, dz / l],
  ];
}
