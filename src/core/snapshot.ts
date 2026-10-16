import { CAR } from "./car-spec";
import type { CarSnapshot } from "./types";

/**
 * A new snapshot of the car at rest on flat ground at the origin: upright,
 * grounded, full tank, everything else zero. Pure data, so the audio self-check
 * and the dev pages can fake a car without pulling in the physics.
 */
export function createCarSnapshot(): CarSnapshot {
  return {
    mode: "grounded",
    position: { x: 0, y: CAR.comHeight, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    brake: 0,
    gas: 1,
    thrusters: [0, 0, 0, 0],
    wheelSpin: 0,
    suspension: 0,
    onRamp: false,
    heightAboveGround: 0,
    airTime: 0,
    trickPitch: 0,
    trickRoll: 0,
  };
}
