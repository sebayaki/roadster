import type { LevelDef } from "@/core/types";
import { createProfile } from "@/physics/profile";

/** Flat runway length before the ramp; the ramp base sits at world x = 0. */
const RUNWAY = 500;

/**
 * "The Curl": a 24.5 m tall ")"-shaped ramp. It turns the car through ~168°,
 * so it leaves the lip nearly upside down and flies back over the runway.
 */
export const CURL_SEGMENTS = [
  { length: 5, k0: 0, k1: 0.16 },
  { length: 5, k0: 0.16, k1: 0.1 },
  { length: 11, k0: 0.1, k1: 0.03 },
  { length: 10, k0: 0.03, k1: 0.13 },
  { length: 3.5, k0: 0.13, k1: 0.08 },
];

/** Lateral width of the ramp surface (m). */
export const CURL_WIDTH = 8;

const profile = createProfile({
  startX: -RUNWAY,
  segments: [{ length: RUNWAY, k0: 0, k1: 0 }, ...CURL_SEGMENTS],
  rampStart: RUNWAY,
});

export const backflipLevel: LevelDef = {
  id: "backflip",
  title: "BACKFLIP",
  venue: "The Curl",
  tagline:
    "Ride a 24 m curl ramp, flip backwards and land it on cold-gas thrusters.",
  howTo: [
    "Build speed down the runway and hit the Curl.",
    "Keep the rotation going backwards until the car is upright.",
    "Fire the thrusters to soften the landing on the runway.",
  ],
  spinAxis: "pitch",
  profile,
  obstacles: [],
  spawnS: RUNWAY - 170,
  gasCapacity: 2.6,
  speedHint: [85 / 3.6, 105 / 3.6],
  goal: { requireRampLaunch: true, minTouchdownX: null },
  camera: { airView: "side", focusX: -12 },
};
