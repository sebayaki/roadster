/**
 * Body lines of the procedural models (the Roadster and the lineup vehicles):
 * heights and half widths as interpolated curves of the car's x axis.
 */

/** A scalar function of one variable (e.g. a height along the car's x axis). */
export type Curve = (x: number) => number;

/** Interpolation key [x, y]; a third element (any value) marks a corner for `curve`. */
type Key = readonly [number, number] | readonly [number, number, number];

type Keys = ReadonlyArray<readonly [number, number]>;

function sortedKeys(keys: Keys): { xs: number[]; ys: number[] } {
  const sorted = [...keys].sort((a, b) => a[0] - b[0]);
  return { xs: sorted.map((k) => k[0]), ys: sorted.map((k) => k[1]) };
}

/** Index i of the key segment [xs[i], xs[i + 1]] holding x (xs sorted, x inside the range). */
function segmentIndex(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Cubic Hermite spline through keys sorted by x, clamped outside the key range.
 * The segment after key i leaves it with slope `mOut[i]` and enters key i + 1
 * with slope `mIn[i + 1]`.
 */
function hermite(
  xs: number[],
  ys: number[],
  mOut: number[],
  mIn: number[]
): Curve {
  const n = xs.length;
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const i = segmentIndex(xs, x);
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * mOut[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * mIn[i + 1]
    );
  };
}

/**
 * Monotone cubic (PCHIP) interpolation through `[x, y]` keys with weighted
 * harmonic-mean tangents: smooth like a spline but never overshoots, so body
 * lines stay where they are drawn. Clamps outside the key range.
 */
export function pchip(keys: Keys): Curve {
  const { xs, ys } = sortedKeys(keys);
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] > 0) {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return hermite(xs, ys, m, m);
}

/**
 * Monotone cubic (Fritsch–Carlson) interpolation through `keys` sorted by x:
 * mean-slope tangents, limited so no segment overshoots its keys. A corner key
 * keeps the slope of each adjoining segment (a tangent break). Clamps outside
 * the key range.
 */
export function curve(keys: readonly Key[]): Curve {
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
  return hermite(xs, ys, mR, mL);
}

/** Piecewise-linear interpolation through `[x, y]` keys, clamped outside the range. */
export function linear(keys: Keys): Curve {
  const { xs, ys } = sortedKeys(keys);
  const n = xs.length;
  if (n === 1) return () => ys[0];
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const i = segmentIndex(xs, x);
    const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
    return ys[i] + (ys[i + 1] - ys[i]) * t;
  };
}
