import { BODY_BOX, CAR, WHEEL_CENTERS } from "@/core/car-spec";
import type { Obstacle } from "@/core/types";

/**
 * Car-local collision points: the 8 corners of BODY_BOX, then the 4 tire contact
 * points (wheel centers − wheel radius in local y). Stored flat as x, y, z triples.
 */
export const COLLISION_POINTS: Float64Array = (() => {
  const pts: number[] = [];
  for (const x of [BODY_BOX.minX, BODY_BOX.maxX])
    for (const y of [BODY_BOX.minY, BODY_BOX.maxY])
      for (const z of [BODY_BOX.minZ, BODY_BOX.maxZ]) pts.push(x, y, z);
  for (const [x, y, z] of WHEEL_CENTERS) pts.push(x, y - CAR.wheelRadius, z);
  return new Float64Array(pts);
})();
export const POINT_COUNT = COLLISION_POINTS.length / 3;
/** The first 8 collision points are the box corners. */
export const CORNER_COUNT = 8;

const BOX_CX = (BODY_BOX.minX + BODY_BOX.maxX) / 2;
const BOX_CY = (BODY_BOX.minY + BODY_BOX.maxY) / 2;
const BOX_CZ = (BODY_BOX.minZ + BODY_BOX.maxZ) / 2;
const BOX_HX = (BODY_BOX.maxX - BODY_BOX.minX) / 2;
const BOX_HY = (BODY_BOX.maxY - BODY_BOX.minY) / 2;
const BOX_HZ = (BODY_BOX.maxZ - BODY_BOX.minZ) / 2;

/**
 * Row-major rotation matrix of the stunt-plane pose q = qZ(pitch) · qX(roll).
 * Column 1 (m[1], m[4], m[7]) is the car's up axis.
 */
export function poseMatrix(pitch: number, roll: number, m: Float64Array): void {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  m[0] = cp;
  m[1] = -sp * cr;
  m[2] = sp * sr;
  m[3] = sp;
  m[4] = cp * cr;
  m[5] = -cp * sr;
  m[6] = 0;
  m[7] = sr;
  m[8] = cr;
}

/** Row-major rotation matrix of a unit quaternion. */
export function quatMatrix(
  x: number,
  y: number,
  z: number,
  w: number,
  m: Float64Array
): void {
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y - z * w);
  m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w);
  m[4] = 1 - 2 * (x * x + z * z);
  m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w);
  m[7] = 2 * (y * z + x * w);
  m[8] = 1 - 2 * (x * x + y * y);
}

/**
 * The car's body box projected onto the x-y plane: a zonotope (center plus three
 * generators, one per box axis). Exact for any 3D orientation.
 */
export class CarHull {
  cx = 0;
  cy = 0;
  readonly gx = new Float64Array(3);
  readonly gy = new Float64Array(3);
  /** Half extents of the axis-aligned bounds. */
  ex = 0;
  ey = 0;

  /** From the COM position (x-y) and a row-major rotation matrix. */
  set(px: number, py: number, m: Float64Array): void {
    this.cx = px + m[0] * BOX_CX + m[1] * BOX_CY + m[2] * BOX_CZ;
    this.cy = py + m[3] * BOX_CX + m[4] * BOX_CY + m[5] * BOX_CZ;
    this.gx[0] = m[0] * BOX_HX;
    this.gy[0] = m[3] * BOX_HX;
    this.gx[1] = m[1] * BOX_HY;
    this.gy[1] = m[4] * BOX_HY;
    this.gx[2] = m[2] * BOX_HZ;
    this.gy[2] = m[5] * BOX_HZ;
    this.ex =
      Math.abs(this.gx[0]) + Math.abs(this.gx[1]) + Math.abs(this.gx[2]);
    this.ey =
      Math.abs(this.gy[0]) + Math.abs(this.gy[1]) + Math.abs(this.gy[2]);
  }

  /** Half width of the hull's projection onto the unit axis (nx, ny). */
  radius(nx: number, ny: number): number {
    const g = this.gx;
    const h = this.gy;
    return (
      Math.abs(g[0] * nx + h[0] * ny) +
      Math.abs(g[1] * nx + h[1] * ny) +
      Math.abs(g[2] * nx + h[2] * ny)
    );
  }
}

/** An obstacle prepared for collision queries (convex polygon prism along z). */
export interface ObstacleShape {
  label: string;
  count: number;
  vx: Float64Array;
  vy: Float64Array;
  /** Outward unit normal of edge k (from vertex k to k + 1). */
  nx: Float64Array;
  ny: Float64Array;
  /** Projection range of the polygon onto each edge normal. */
  lo: Float64Array;
  hi: Float64Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  z: number;
  halfZ: number;
}

export function prepareObstacles(list: Obstacle[]): ObstacleShape[] {
  return list.map((o) => {
    const count = o.polygon.length;
    const vx = new Float64Array(count);
    const vy = new Float64Array(count);
    o.polygon.forEach(([x, y], i) => {
      vx[i] = x;
      vy[i] = y;
    });
    const nx = new Float64Array(count);
    const ny = new Float64Array(count);
    const lo = new Float64Array(count);
    const hi = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const j = (k + 1) % count;
      const ex = vx[j] - vx[k];
      const ey = vy[j] - vy[k];
      const len = Math.hypot(ex, ey) || 1;
      nx[k] = ey / len;
      ny[k] = -ex / len;
      let a = Infinity;
      let b = -Infinity;
      for (let i = 0; i < count; i++) {
        const p = vx[i] * nx[k] + vy[i] * ny[k];
        a = Math.min(a, p);
        b = Math.max(b, p);
      }
      lo[k] = a;
      hi[k] = b;
    }
    return {
      label: o.label,
      count,
      vx,
      vy,
      nx,
      ny,
      lo,
      hi,
      minX: Math.min(...vx),
      maxX: Math.max(...vx),
      minY: Math.min(...vy),
      maxY: Math.max(...vy),
      z: o.z,
      halfZ: o.sizeZ / 2,
    };
  });
}

/** Minimum translation that separates the car from an obstacle, plus a contact point. */
export interface Contact2D {
  /** Unit direction to push the car out. */
  nx: number;
  ny: number;
  depth: number;
  /** Contact point in the x-y plane. */
  px: number;
  py: number;
}

export function createContact(): Contact2D {
  return { nx: 0, ny: 1, depth: 0, px: 0, py: 0 };
}

/** Overlaps shallower than this (m) do not count, so touching faces are not a hit. */
const SAT_EPSILON = 1e-4;

/**
 * Separating-axis test between the car hull and a convex obstacle polygon. When `out`
 * is given and they overlap, it receives the minimum translation and a contact point.
 */
export function hullOverlaps(
  h: CarHull,
  o: ObstacleShape,
  out: Contact2D | null
): boolean {
  if (
    h.cx + h.ex <= o.minX ||
    h.cx - h.ex >= o.maxX ||
    h.cy + h.ey <= o.minY ||
    h.cy - h.ey >= o.maxY
  )
    return false;
  let bestDepth = Infinity;
  let bestNx = 0;
  let bestNy = 0;
  for (let k = 0; k < o.count; k++) {
    const nx = o.nx[k];
    const ny = o.ny[k];
    const c = h.cx * nx + h.cy * ny;
    const r = h.radius(nx, ny);
    const up = o.hi[k] - (c - r);
    const down = c + r - o.lo[k];
    if (up <= SAT_EPSILON || down <= SAT_EPSILON) return false;
    if (out && Math.min(up, down) < bestDepth) {
      bestDepth = Math.min(up, down);
      const sign = up <= down ? 1 : -1;
      bestNx = nx * sign;
      bestNy = ny * sign;
    }
  }
  for (let g = 0; g < 3; g++) {
    const len = Math.hypot(h.gx[g], h.gy[g]);
    if (len < 1e-6) continue;
    const nx = -h.gy[g] / len;
    const ny = h.gx[g] / len;
    const c = h.cx * nx + h.cy * ny;
    const r = h.radius(nx, ny);
    let a = Infinity;
    let b = -Infinity;
    for (let i = 0; i < o.count; i++) {
      const p = o.vx[i] * nx + o.vy[i] * ny;
      if (p < a) a = p;
      if (p > b) b = p;
    }
    const up = b - (c - r);
    const down = c + r - a;
    if (up <= SAT_EPSILON || down <= SAT_EPSILON) return false;
    if (out && Math.min(up, down) < bestDepth) {
      bestDepth = Math.min(up, down);
      const sign = up <= down ? 1 : -1;
      bestNx = nx * sign;
      bestNy = ny * sign;
    }
  }
  if (!out) return true;
  out.nx = bestNx;
  out.ny = bestNy;
  out.depth = bestDepth;
  contactPoint(h, o, bestNx, bestNy, out);
  return true;
}

/**
 * Contact point for push direction n: the middle of the overlap of the car's deepest
 * feature (a corner, or a face square to n) and the obstacle's outermost feature,
 * measured along the tangent. A car tripping on the low stage gets its contact at the
 * stage edge height, not mid-bumper.
 */
function contactPoint(
  h: CarHull,
  o: ObstacleShape,
  nx: number,
  ny: number,
  out: Contact2D
): void {
  const tx = -ny;
  const ty = nx;
  let px = h.cx;
  let py = h.cy;
  let half = 0;
  for (let g = 0; g < 3; g++) {
    const d = h.gx[g] * nx + h.gy[g] * ny;
    const len = Math.hypot(h.gx[g], h.gy[g]);
    if (Math.abs(d) > 0.02 * len) {
      const s = d > 0 ? -1 : 1;
      px += s * h.gx[g];
      py += s * h.gy[g];
    } else {
      half += Math.abs(h.gx[g] * tx + h.gy[g] * ty);
    }
  }
  const carT = px * tx + py * ty;
  const carN = px * nx + py * ny;
  let top = -Infinity;
  for (let i = 0; i < o.count; i++)
    top = Math.max(top, o.vx[i] * nx + o.vy[i] * ny);
  let oa = Infinity;
  let ob = -Infinity;
  for (let i = 0; i < o.count; i++) {
    if (o.vx[i] * nx + o.vy[i] * ny < top - 1e-3) continue;
    const t = o.vx[i] * tx + o.vy[i] * ty;
    oa = Math.min(oa, t);
    ob = Math.max(ob, t);
  }
  const lo = Math.max(carT - half, oa);
  const hi = Math.min(carT + half, ob);
  const mid = lo <= hi ? (lo + hi) / 2 : (carT + (oa + ob) / 2) / 2;
  const depth = (carN + top) / 2;
  out.px = tx * mid + nx * depth;
  out.py = ty * mid + ny * depth;
}
