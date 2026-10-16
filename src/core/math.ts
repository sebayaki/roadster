import type { Units } from "./types";

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const GRAVITY = 9.81;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential smoothing toward a target.
 * `rate` is how fast it converges (1/s): after 1/rate seconds ~63% of the gap is closed.
 */
export function damp(
  current: number,
  target: number,
  rate: number,
  dt: number
): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w === -Math.PI ? Math.PI : w;
}

/** Distance from `a` to the nearest multiple of a full turn (rad, >= 0). */
export function offFullTurn(a: number): number {
  return Math.abs(wrapAngle(a));
}

/** Meters per second to km/h or mph. */
export function speedIn(ms: number, units: Units): number {
  return units === "metric" ? ms * 3.6 : ms * 2.236936;
}

/** Meters to meters or feet. */
export function lengthIn(m: number, units: Units): number {
  return units === "metric" ? m : m * 3.28084;
}

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
