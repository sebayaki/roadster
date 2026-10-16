import type { Quality } from "@/core/types";
import { BAND, carBody, lightBand } from "./car-body";
import { curve, type MeshBuilder, SLOT } from "./geometry";
import type { Envelope } from "./specs";

const L = 2.15;
const COWL = 1.52;
const REAR_GLASS = -2.0;
const SIDE_GLASS_END = -1.5;

/** Small two-door teardrop coupe with light bars front and rear and aero wheel covers. */
export function buildCybercab(
  b: MeshBuilder,
  env: Envelope,
  quality: Quality
): void {
  const pts = carBody(
    b,
    {
      halfLength: L,
      yb: curve([
        [-L, 0.44],
        [-2.08, 0.36],
        [-1.85, 0.22],
        [-1.6, 0.15],
        [1.75, 0.15],
        [2.0, 0.22],
        [L, 0.34],
      ]),
      yTop: curve([
        [-L, 0.9],
        [-2.11, 0.94],
        [REAR_GLASS, 0.97, 1],
        [-1.5, 1.12],
        [-0.9, 1.26],
        [-0.3, 1.335],
        [0.05, 1.35],
        [0.4, 1.33],
        [0.75, 1.24],
        [1.2, 1.04],
        [COWL, 0.89, 1],
        [1.85, 0.82],
        [2.02, 0.76],
        [2.11, 0.68],
        [L, 0.56],
      ]),
      yRail: curve([
        [-L, 0.88],
        [-2.11, 0.92],
        [REAR_GLASS, 0.95, 1],
        [SIDE_GLASS_END, 1.08],
        [-0.9, 1.215],
        [-0.3, 1.3],
        [0.05, 1.315],
        [0.4, 1.295],
        [0.75, 1.205],
        [1.2, 1.015],
        [COWL, 0.875, 1],
        [1.85, 0.8],
        [L, 0.55],
      ]),
      yBelt: curve([
        [-L, 0.86],
        [-2.11, 0.89],
        [REAR_GLASS, 0.93],
        [SIDE_GLASS_END, 0.93],
        [-0.5, 0.88],
        [0.5, 0.85],
        [COWL, 0.86],
        [1.85, 0.79],
        [L, 0.55],
      ]),
      yShoulder: curve([
        [-L, 0.72],
        [-1.9, 0.74],
        [0, 0.72],
        [1.6, 0.72],
        [2.0, 0.66],
        [L, 0.5],
      ]),
      w: curve([
        [-L, 0.95],
        [-1.3, 0.975],
        [0, 0.965],
        [1.4, 0.97],
        [L, 0.94],
      ]),
      wBelt: curve([
        [-L, 0.87],
        [-1.4, 0.9],
        [1.2, 0.89],
        [L, 0.87],
      ]),
      wRail: curve([
        [-L, 0.74],
        [REAR_GLASS, 0.76],
        [SIDE_GLASS_END, 0.72],
        [-0.9, 0.66],
        [0.05, 0.63],
        [0.75, 0.66],
        [COWL, 0.76],
        [L, 0.74],
      ]),
      noseR: 0.5,
      tailR: 0.3,
      axles: [1.38, -1.3],
      tire: 0.36,
      tireWidth: 0.24,
      trackHalf: 0.83,
      rim: 0.8,
      wheelStyle: "cover",
      archRadius: 0.395,
      keyXs: [SIDE_GLASS_END, 0.75, 1.95, -2.05],
      creaseXs: [REAR_GLASS, COWL],
      band(band, x) {
        if (band === BAND.under || band === BAND.rocker) return SLOT.trim;
        if (band === BAND.lower && (x > 1.95 || x < -2.05)) return SLOT.trim;
        if (band === BAND.window) {
          return x > SIDE_GLASS_END && x < COWL ? SLOT.glass : SLOT.paint;
        }
        if (band >= BAND.roofOuter) {
          return x > REAR_GLASS && x < COWL ? SLOT.glass : SLOT.paint;
        }
        return SLOT.paint;
      },
    },
    env,
    quality
  );
  lightBand(b, SLOT.light, pts, "front", 0.735, 0.757, 0, 1.0);
  lightBand(b, SLOT.tail, pts, "rear", 0.9, 0.922, 0, 1.0);
}
