/** A scalar function of one variable (e.g. a height along the car's x axis). */
export type Curve = (x: number) => number;

type Keys = ReadonlyArray<readonly [number, number]>;

function sortedKeys(keys: Keys): { xs: number[]; ys: number[] } {
  const sorted = [...keys].sort((a, b) => a[0] - b[0]);
  return { xs: sorted.map((k) => k[0]), ys: sorted.map((k) => k[1]) };
}

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
 * Monotone cubic (PCHIP / Fritsch-Carlson) interpolation through `[x, y]` keys:
 * smooth like a spline but never overshoots, so body lines stay where they are drawn.
 * Clamps outside the key range.
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
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const i = segmentIndex(xs, x);
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    );
  };
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
