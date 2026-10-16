import type { TrackProfile } from "@/core/types";

/** Riding-surface frame at one arc length. Mutable scratch value: reuse it. */
export interface TrackFrame {
  x: number;
  y: number;
  angle: number;
  curvature: number;
  /** Unit tangent (cos angle, sin angle). The normal is (−ty, tx). */
  tx: number;
  ty: number;
}

/** Closest point on the ramp curve to a query point. Mutable scratch value. */
export interface RampHit {
  /** Arc length on the whole profile. */
  s: number;
  /** Signed distance along the surface normal (+ = free side, − = behind the surface). */
  dist: number;
  /** Tangential offset past the ramp ends (≈ 0 when the point projects onto the ramp). */
  along: number;
  /** Surface normal at s. */
  nx: number;
  ny: number;
}

export function createFrame(): TrackFrame {
  return { x: 0, y: 0, angle: 0, curvature: 0, tx: 1, ty: 0 };
}

export function createRampHit(): RampHit {
  return { s: 0, dist: 0, along: 0, nx: 0, ny: 1 };
}

/** Table resolution along the ramp (matches the profile's own table). */
const TABLE_STEP = 0.05;
/** Coarse search stride in table entries (0.5 m). */
const COARSE_EVERY = 10;
/** Projections closer than this to the ramp ends count as on the ramp (m). */
const END_TOLERANCE = 0.05;

/**
 * Allocation-free view of a level profile for the physics: the flat runway is handled
 * analytically, the ramp section through dense tables built once from the profile.
 */
export class TrackGeometry {
  readonly length: number;
  readonly rampStart: number;
  readonly hasRamp: boolean;
  /** World x of the runway start (s = 0) and of its end (the ramp base). */
  readonly runwayStartX: number;
  readonly runwayEndX: number;
  /** Height of the runway. */
  readonly groundY: number;
  /** Ramp bounding box (empty when there is no ramp). */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;

  private readonly count: number;
  private readonly step: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly angles: Float64Array;
  private readonly curvatures: Float64Array;
  private readonly txs: Float64Array;
  private readonly tys: Float64Array;
  /** Last table index of the upward-facing (angle ≤ 90°) part of the ramp. */
  private readonly risingEnd: number;
  private readonly scratch = createFrame();

  constructor(profile: TrackProfile) {
    this.length = profile.length;
    this.rampStart = profile.rampStart;
    const base = profile.sample(profile.rampStart);
    this.runwayEndX = base.x;
    this.groundY = base.y;
    this.runwayStartX = base.x - profile.rampStart;
    const rampLength = profile.length - profile.rampStart;
    this.hasRamp = rampLength > 1e-6;
    this.count = this.hasRamp
      ? Math.max(2, Math.round(rampLength / TABLE_STEP) + 1)
      : 0;
    this.step = this.hasRamp ? rampLength / (this.count - 1) : 1;
    this.xs = new Float64Array(this.count);
    this.ys = new Float64Array(this.count);
    this.angles = new Float64Array(this.count);
    this.curvatures = new Float64Array(this.count);
    this.txs = new Float64Array(this.count);
    this.tys = new Float64Array(this.count);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let risingEnd = 0;
    for (let i = 0; i < this.count; i++) {
      const p = profile.sample(profile.rampStart + i * this.step);
      this.xs[i] = p.x;
      this.ys[i] = p.y;
      this.angles[i] = p.angle;
      this.curvatures[i] = p.curvature;
      this.txs[i] = Math.cos(p.angle);
      this.tys[i] = Math.sin(p.angle);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      if (p.angle <= Math.PI / 2) risingEnd = i;
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    this.risingEnd = risingEnd;
  }

  /** True when s lies on the ramp (curved) section. */
  isRamp(s: number): boolean {
    return this.hasRamp && s > this.rampStart;
  }

  /** Writes the riding-surface frame at arc length s (clamped to the profile). */
  frameAt(s: number, out: TrackFrame): TrackFrame {
    const c = s < 0 ? 0 : s > this.length ? this.length : s;
    if (!this.hasRamp || c <= this.rampStart) {
      out.x = this.runwayEndX - (this.rampStart - c);
      out.y = this.groundY;
      out.angle = 0;
      out.curvature = 0;
      out.tx = 1;
      out.ty = 0;
      return out;
    }
    return this.rampFrame(c - this.rampStart, out);
  }

  /** Frame at u meters along the ramp (u in [0, ramp length]). */
  private rampFrame(u: number, out: TrackFrame): TrackFrame {
    const f = u / this.step;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    else if (i > this.count - 2) i = this.count - 2;
    const t = f - i;
    const j = i + 1;
    out.x = this.xs[i] + (this.xs[j] - this.xs[i]) * t;
    out.y = this.ys[i] + (this.ys[j] - this.ys[i]) * t;
    out.angle = this.angles[i] + (this.angles[j] - this.angles[i]) * t;
    out.curvature =
      this.curvatures[i] + (this.curvatures[j] - this.curvatures[i]) * t;
    out.tx = this.txs[i] + (this.txs[j] - this.txs[i]) * t;
    out.ty = this.tys[i] + (this.tys[j] - this.tys[i]) * t;
    return out;
  }

  /**
   * Closest point on the ramp curve to (px, py). Returns false without touching `hit`
   * when there is no ramp or the point is further than `margin` from its bounding box.
   */
  closestOnRamp(px: number, py: number, hit: RampHit, margin = 2.5): boolean {
    if (
      !this.hasRamp ||
      px < this.minX - margin ||
      px > this.maxX + margin ||
      py < this.minY - margin ||
      py > this.maxY + margin
    )
      return false;
    const xs = this.xs;
    const ys = this.ys;
    const last = this.count - 1;
    let best = last;
    let bestD = (px - xs[last]) ** 2 + (py - ys[last]) ** 2;
    for (let i = 0; i < last; i += COARSE_EVERY) {
      const dx = px - xs[i];
      const dy = py - ys[i];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Newton refinement of (P − C(u)) · T(u) = 0.
    const rampLength = last * this.step;
    const f = this.scratch;
    let u = best * this.step;
    for (let it = 0; it < 6; it++) {
      this.rampFrame(u, f);
      const dx = px - f.x;
      const dy = py - f.y;
      const along = dx * f.tx + dy * f.ty;
      const dist = dy * f.tx - dx * f.ty;
      const slope = Math.min(-0.2, -1 + f.curvature * dist);
      let next = u - along / slope;
      if (next < 0) next = 0;
      else if (next > rampLength) next = rampLength;
      const done = Math.abs(next - u) < 1e-5;
      u = next;
      if (done) break;
    }
    this.rampFrame(u, f);
    const dx = px - f.x;
    const dy = py - f.y;
    hit.s = this.rampStart + u;
    hit.along = dx * f.tx + dy * f.ty;
    hit.dist = dy * f.tx - dx * f.ty;
    hit.nx = -f.ty;
    hit.ny = f.tx;
    return true;
  }

  /** True when the hit lies inside the ramp's solid shell of the given thickness. */
  static inShell(hit: RampHit, thickness: number): boolean {
    return (
      hit.dist < 0 &&
      hit.dist > -thickness &&
      Math.abs(hit.along) < END_TOLERANCE
    );
  }

  /**
   * Height of the highest upward-facing surface at x that is not above y: the ground
   * plane (y = 0) or the rising face of the ramp.
   */
  surfaceBelow(x: number, y: number): number {
    if (!this.hasRamp) return 0;
    const xs = this.xs;
    const end = this.risingEnd;
    if (x <= xs[0] || x >= xs[end]) return 0;
    let lo = 0;
    let hi = end;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    const rampY = this.ys[lo] + (this.ys[hi] - this.ys[lo]) * t;
    return rampY > 0 && rampY <= y + 1e-6 ? rampY : 0;
  }
}
