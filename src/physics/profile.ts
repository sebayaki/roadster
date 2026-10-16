import type { ProfileSample, TrackProfile } from "@/core/types";

/** A stretch of track whose curvature blends linearly from `k0` to `k1` over `length` meters. */
export interface CurvatureSegment {
  length: number;
  k0: number;
  k1: number;
}

const STEP = 0.05;

/**
 * Builds a riding-surface curve by integrating curvature along arc length,
 * starting at (startX, startY) heading +x. Sampling interpolates a dense table.
 */
export function createProfile(opts: {
  startX: number;
  startY?: number;
  segments: CurvatureSegment[];
  /** Arc length where the flat runway ends (defaults to the first segment's length). */
  rampStart?: number;
}): TrackProfile {
  const total = opts.segments.reduce((sum, seg) => sum + seg.length, 0);
  const count = Math.ceil(total / STEP) + 1;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const angles = new Float64Array(count);
  const curvatures = new Float64Array(count);

  const curvatureAt = (s: number): number => {
    let acc = 0;
    for (const seg of opts.segments) {
      if (s <= acc + seg.length) {
        const t = seg.length > 0 ? (s - acc) / seg.length : 0;
        return seg.k0 + (seg.k1 - seg.k0) * t;
      }
      acc += seg.length;
    }
    const last = opts.segments[opts.segments.length - 1];
    return last ? last.k1 : 0;
  };

  let x = opts.startX;
  let y = opts.startY ?? 0;
  let angle = 0;
  xs[0] = x;
  ys[0] = y;
  angles[0] = 0;
  curvatures[0] = curvatureAt(0);
  for (let i = 1; i < count; i++) {
    const s0 = (i - 1) * STEP;
    const ds = Math.min(STEP, total - s0);
    // Midpoint integration keeps the curve accurate at this step size.
    const midAngle = angle + curvatureAt(s0 + ds / 4) * (ds / 2);
    x += Math.cos(midAngle) * ds;
    y += Math.sin(midAngle) * ds;
    angle += curvatureAt(s0 + ds / 2) * ds;
    xs[i] = x;
    ys[i] = y;
    angles[i] = angle;
    curvatures[i] = curvatureAt(s0 + ds);
  }

  const sample = (s: number): ProfileSample => {
    const c = Math.min(Math.max(s, 0), total);
    const f = c / STEP;
    const i = Math.min(Math.floor(f), count - 2);
    const t = f - i;
    return {
      s: c,
      x: xs[i] + (xs[i + 1] - xs[i]) * t,
      y: ys[i] + (ys[i + 1] - ys[i]) * t,
      angle: angles[i] + (angles[i + 1] - angles[i]) * t,
      curvature: curvatures[i] + (curvatures[i + 1] - curvatures[i]) * t,
    };
  };

  return {
    length: total,
    rampStart: opts.rampStart ?? opts.segments[0]?.length ?? total,
    sample,
    samples(step: number, from = 0, to = total): ProfileSample[] {
      const a = Math.max(0, Math.min(from, to));
      const b = Math.min(total, Math.max(from, to));
      const n = Math.max(1, Math.ceil((b - a) / step));
      const out: ProfileSample[] = [];
      for (let i = 0; i <= n; i++) out.push(sample(a + ((b - a) * i) / n));
      return out;
    },
  };
}
