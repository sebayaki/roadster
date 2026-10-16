import type { Quality } from "@/core/types";
import { curve } from "../roadster/curve";
import { BAND, carBody, lightBand } from "./car-body";
import { type MeshBuilder, SLOT } from "./geometry";
import type { Envelope } from "./specs";

const L = 2.395;
const COWL = 1.25;
const REAR_GLASS = -2.2;
const SIDE_GLASS_END = -1.9;

/** Taller crossover: high hood with a full-width light bar, sloping roof, hatchback. */
export function buildModelY(
  b: MeshBuilder,
  env: Envelope,
  quality: Quality
): void {
  const pts = carBody(
    b,
    {
      halfLength: L,
      yb: curve([
        [-L, 0.48],
        [-2.32, 0.4],
        [-2.1, 0.3],
        [-1.85, 0.18],
        [1.95, 0.18],
        [2.2, 0.24],
        [L, 0.36],
      ]),
      yTop: curve([
        [-L, 1.04],
        [-2.36, 1.1],
        [-2.32, 1.12],
        [REAR_GLASS, 1.18, 1],
        [-1.4, 1.5],
        [-0.7, 1.605],
        [-0.15, 1.62],
        [0.35, 1.6],
        [0.55, 1.565],
        [COWL, 1.1, 1],
        [1.75, 1.03],
        [2.1, 0.96],
        [2.28, 0.89],
        [2.36, 0.8],
        [L, 0.68],
      ]),
      yRail: curve([
        [-L, 1.02],
        [-2.32, 1.1],
        [REAR_GLASS, 1.16, 1],
        [SIDE_GLASS_END, 1.29],
        [-1.4, 1.47],
        [-0.7, 1.575],
        [-0.15, 1.595],
        [0.35, 1.575],
        [0.55, 1.54],
        [COWL, 1.085, 1],
        [1.75, 1.01],
        [2.1, 0.94],
        [L, 0.68],
      ]),
      yBelt: curve([
        [-L, 1.0],
        [-2.32, 1.06],
        [REAR_GLASS, 1.1],
        [SIDE_GLASS_END, 1.12],
        [-1.0, 1.115],
        [0, 1.1],
        [COWL, 1.075],
        [1.75, 1.0],
        [2.1, 0.93],
        [L, 0.68],
      ]),
      yShoulder: curve([
        [-L, 0.85],
        [-2.25, 0.88],
        [-1.5, 0.87],
        [1.5, 0.86],
        [2.2, 0.8],
        [L, 0.55],
      ]),
      w: curve([
        [-L, 0.95],
        [-1.4, 0.96],
        [1.5, 0.955],
        [L, 0.93],
      ]),
      wBelt: curve([
        [-L, 0.87],
        [-1.6, 0.885],
        [1.2, 0.885],
        [1.7, 0.9],
        [L, 0.88],
      ]),
      wRail: curve([
        [-L, 0.72],
        [REAR_GLASS, 0.74],
        [SIDE_GLASS_END, 0.7],
        [-1.4, 0.66],
        [-0.15, 0.64],
        [0.55, 0.65],
        [COWL, 0.76],
        [2.0, 0.78],
        [L, 0.74],
      ]),
      noseR: 0.5,
      tailR: 0.38,
      axles: [1.515, -1.375],
      tire: 0.356,
      tireWidth: 0.255,
      trackHalf: 0.82,
      rim: 0.68,
      wheelStyle: "spokes",
      archRadius: 0.41,
      keyXs: [SIDE_GLASS_END, 0.55, 2.2, -2.15],
      creaseXs: [REAR_GLASS, COWL],
      band(band, x) {
        if (band === BAND.under || band === BAND.rocker) return SLOT.trim;
        if (band === BAND.lower && (x > 2.2 || x < -2.15)) return SLOT.trim;
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
  // Full-width light bar at the hood's leading edge, headlamps low in the bumper.
  lightBand(b, SLOT.light, pts, "front", 0.872, 0.89, 0, 1.0);
  lightBand(b, SLOT.light, pts, "front", 0.7, 0.735, 0.55, 0.86);
  // Thin full-width rear light bar over the corner tail lamps.
  lightBand(b, SLOT.tail, pts, "rear", 1.0, 1.016, 0, 1.0);
  lightBand(b, SLOT.tail, pts, "rear", 0.93, 0.99, 0.55, 1.02);
}
