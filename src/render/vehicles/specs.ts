import type { Obstacle, VehicleKind } from "@/core/types";
import { LINEUP_DIMS, OUTLINE_BASE, vehicleOutline } from "@/levels/kickflip";

/**
 * Sizes the models are built at (length along model x, width along z): the
 * lineup's. `buildLineup` scales each model to its obstacle box.
 */
export const VEHICLE_DIMS = LINEUP_DIMS;

/**
 * Largest allowed half-width (|z|) of the body at model height y (m above the
 * ground the vehicle stands on). Physics collides with the obstacle polygon,
 * so the visible body must stay inside it.
 */
export type Envelope = (y: number) => number;

/** Envelope following the lineup's collision outline rule (see vehicleOutline). */
export function ruleEnvelope(kind: VehicleKind): Envelope {
  const { half, belt, roofHalf, top } = vehicleOutline(kind);
  return (y) =>
    y <= belt
      ? half
      : half + (roofHalf - half) * Math.min(1, (y - belt) / (top - belt));
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
    // The collision polygon does not reach below its base.
    if (y < OUTLINE_BASE) return Infinity;
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
