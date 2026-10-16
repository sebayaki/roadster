import type { Quality } from "@/core/types";
import { BAND, carBody, lightBand } from "./car-body";
import { curve, type MeshBuilder, SLOT } from "./geometry";
import type { Envelope } from "./specs";

const L = 2.36;
/** Cowl (windshield base), rear window base and rear end of the side glass. */
const COWL = 1.28;
const REAR_GLASS = -1.78;
const SIDE_GLASS_END = -1.45;

/** Low fastback sedan: long glass roof, short deck, slim corner headlights. */
export function buildModel3(
  b: MeshBuilder,
  env: Envelope,
  quality: Quality
): void {
  const pts = carBody(
    b,
    {
      halfLength: L,
      yb: curve([
        [-L, 0.45],
        [-2.3, 0.38],
        [-2.1, 0.26],
        [-1.9, 0.15],
        [1.95, 0.15],
        [2.15, 0.19],
        [2.3, 0.26],
        [L, 0.34],
      ]),
      yTop: curve([
        [-L, 0.95],
        [-2.33, 1.0],
        [-2.27, 1.025],
        [-2.0, 1.05],
        [REAR_GLASS, 1.07, 1],
        [-1.2, 1.27],
        [-0.6, 1.4],
        [-0.15, 1.44],
        [0.3, 1.425],
        [0.55, 1.39],
        [COWL, 0.985, 1],
        [1.7, 0.93],
        [2.05, 0.86],
        [2.22, 0.79],
        [2.32, 0.7],
        [L, 0.58],
      ]),
      yRail: curve([
        [-L, 0.93],
        [-2.27, 1.0],
        [-2.0, 1.02],
        [REAR_GLASS, 1.035, 1],
        [SIDE_GLASS_END, 1.13],
        [-0.6, 1.355],
        [-0.15, 1.395],
        [0.3, 1.385],
        [0.55, 1.35],
        [COWL, 0.965, 1],
        [1.7, 0.91],
        [2.05, 0.845],
        [L, 0.57],
      ]),
      yBelt: curve([
        [-L, 0.91],
        [-2.26, 0.97],
        [REAR_GLASS, 1.01],
        [-1.0, 1.01],
        [0, 0.995],
        [COWL, 0.962],
        [1.7, 0.895],
        [2.05, 0.825],
        [L, 0.56],
      ]),
      yShoulder: curve([
        [-L, 0.78],
        [-2.2, 0.8],
        [-1.5, 0.8],
        [1.5, 0.79],
        [2.2, 0.72],
        [L, 0.5],
      ]),
      w: curve([
        [-L, 0.91],
        [-1.4, 0.925],
        [1.5, 0.92],
        [L, 0.88],
      ]),
      wBelt: curve([
        [-L, 0.84],
        [-1.6, 0.85],
        [1.2, 0.85],
        [1.6, 0.86],
        [L, 0.84],
      ]),
      wRail: curve([
        [-L, 0.7],
        [REAR_GLASS, 0.74],
        [SIDE_GLASS_END, 0.68],
        [-0.6, 0.62],
        [-0.15, 0.61],
        [0.55, 0.62],
        [COWL, 0.72],
        [2.0, 0.74],
        [L, 0.7],
      ]),
      noseR: 0.48,
      tailR: 0.36,
      axles: [1.52, -1.355],
      tire: 0.335,
      tireWidth: 0.235,
      trackHalf: 0.79,
      rim: 0.68,
      wheelStyle: "spokes",
      archRadius: 0.385,
      keyXs: [SIDE_GLASS_END, 0.55, 2.15, -2.1],
      creaseXs: [REAR_GLASS, COWL],
      band(band, x) {
        if (band === BAND.under || band === BAND.rocker) return SLOT.trim;
        if (band === BAND.lower && (x > 2.15 || x < -2.1)) return SLOT.trim;
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
  lightBand(b, SLOT.light, pts, "front", 0.705, 0.735, 0.4, 0.86);
  lightBand(b, SLOT.tail, pts, "rear", 0.86, 0.93, 0.42, 0.98);
}
