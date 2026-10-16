import type { Obstacle, VehicleKind } from "@/core/types";

/** Bumper-to-bumper length (model x), body width without mirrors (model z) and height (m). */
export interface VehicleDims {
  length: number;
  width: number;
  height: number;
}

/**
 * Sizes the models are designed at. They match the lineup data in
 * `levels/kickflip.ts`; `buildLineup` rescales to the obstacle box if that data changes.
 */
export const VEHICLE_DIMS: Readonly<Record<VehicleKind, VehicleDims>> = {
  model3: { length: 4.72, width: 1.85, height: 1.44 },
  modelY: { length: 4.79, width: 1.92, height: 1.62 },
  semi: { length: 7.5, width: 2.6, height: 4.0 },
  cybertruck: { length: 5.68, width: 2.03, height: 1.79 },
  cybercab: { length: 4.3, width: 1.95, height: 1.35 },
};

/**
 * Largest allowed half-width (|z|) of the body at model height y (m above the
 * ground the vehicle stands on). Physics collides with the obstacle polygon,
 * so the visible body must stay inside it.
 */
export type Envelope = (y: number) => number;

/** Height above the stand plane below which the collision polygon does not reach. */
const POLY_BASE = 0.12;

/**
 * Envelope following the same rule as the lineup collision outline: vertical
 * flanks up to the belt line, then the greenhouse tapers to the roof.
 */
export function ruleEnvelope(kind: VehicleKind): Envelope {
  const d = VEHICLE_DIMS[kind];
  const half = d.width / 2;
  const belt = d.height * (kind === "semi" ? 0.9 : 0.58);
  const roofHalf = half * (kind === "semi" ? 0.86 : 0.68);
  return (y) =>
    y <= belt
      ? half
      : half + (roofHalf - half) * Math.min(1, (y - belt) / (d.height - belt));
}

/**
 * Envelope taken from an obstacle's own collision polygon (world x-y), mapped
 * into nominal model space. `scaleY` / `scaleLat` are obstacle size / nominal
 * size. Only valid when the vehicle stands across the path (|sin yaw| ≈ 1),
 * otherwise null.
 */
export function polygonEnvelope(
  o: Obstacle,
  scaleY: number,
  scaleLat: number
): Envelope | null {
  if (Math.abs(Math.sin(o.yaw)) < 0.99 || o.polygon.length < 3) return null;
  const poly = o.polygon;
  return (y) => {
    const wy = o.baseY + y * scaleY;
    if (y < POLY_BASE) return Infinity;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      if ((ay - wy) * (by - wy) > 0 || ay === by) continue;
      const x = ax + ((bx - ax) * (wy - ay)) / (by - ay);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (lo > hi) return 0;
    return Math.max(0, Math.min(o.x - lo, hi - o.x)) / scaleLat;
  };
}
