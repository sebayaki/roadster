/**
 * Physical layout of the Roadster shared by physics and rendering.
 *
 * Car-local frame: origin at the center of mass, +x forward, +y up, +z right.
 * At rest on flat ground the tire contact patches are at y = -CAR.comHeight.
 */
export const CAR = {
  /** Bumper to bumper (m). */
  length: 4.45,
  /** Body width; the car has no mirrors (m). */
  width: 2.0,
  /** Ground to roof at rest (m). */
  height: 1.12,
  wheelbase: 2.72,
  /** Wheel center to wheel center across the car (m). */
  track: 1.72,
  wheelRadius: 0.36,
  wheelWidth: 0.3,
  /** Ground to the underside of the body at rest (m). */
  groundClearance: 0.12,
  /** Ground to the center of mass at rest (m). */
  comHeight: 0.5,
  /** Front axle to front bumper (m). */
  frontOverhang: 0.95,
  /** Rear axle to rear bumper (m). */
  rearOverhang: 0.78,
} as const;

const axle = CAR.wheelbase / 2;
const wheelY = CAR.wheelRadius - CAR.comHeight;
const half = CAR.track / 2;

/** Wheel centers in car-local coordinates, order FL, FR, RL, RR. */
export const WHEEL_CENTERS: ReadonlyArray<readonly [number, number, number]> = [
  [axle, wheelY, -half],
  [axle, wheelY, half],
  [-axle, wheelY, -half],
  [-axle, wheelY, half],
];

/**
 * Cold-gas nozzle positions on the underside (on the underbody surface, where
 * the model draws the nozzle rings), order FL, FR, RL, RR. Jets fire along local -y.
 */
export const NOZZLE_POSITIONS: ReadonlyArray<
  readonly [number, number, number]
> = [
  [axle + 0.55, -0.355, -0.72],
  [axle + 0.55, -0.355, 0.72],
  [-axle - 0.42, -0.317, -0.72],
  [-axle - 0.42, -0.317, 0.72],
];

/** Collision box in car-local coordinates. The bottom face is the tire contact plane. */
export const BODY_BOX = {
  minX: -axle - CAR.rearOverhang,
  maxX: axle + CAR.frontOverhang,
  minY: -CAR.comHeight,
  maxY: CAR.height - CAR.comHeight,
  minZ: -CAR.width / 2,
  maxZ: CAR.width / 2,
} as const;
