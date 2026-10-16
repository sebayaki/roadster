/**
 * Shared contracts between modules.
 *
 * Units: meters, seconds, radians. World is Y-up (Three.js convention).
 * The stunt happens in the x-y plane at z = 0: the car drives along +x,
 * +y is up and +z is the car's right-hand side.
 */

export type LevelId = "backflip" | "kickflip";

/** Axis controlled by the player's spin input while airborne. */
export type SpinAxis = "pitch" | "roll";

export type Quality = "high" | "low";

export type Units = "metric" | "imperial";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Player intent for the current frame. Produced by Input, consumed by physics. */
export interface Controls {
  /** Accelerator, 0..1. */
  throttle: number;
  /** Brake, 0..1. When stopped on the ground it reverses slowly. */
  brake: number;
  /** Cold-gas lift thrusters held down. */
  thrust: boolean;
  /**
   * -1..1. -1 rotates the car counter-clockwise on screen (left / ◀),
   * +1 rotates it clockwise (right / ▶). Physics maps it onto the level's spin axis.
   */
  spin: number;
}

/** Edge-triggered meta actions from keyboard / touch / gamepad. */
export type InputAction =
  | "confirm" // Enter / Space on menus / A button
  | "back" // Escape on menus / B button
  | "restart" // R / Y button
  | "pause" // Escape or P while running / Start button
  | "camera" // C: cycle camera framing
  | "mute" // M
  | "units"; // U: metric <-> imperial

export type CarMode = "grounded" | "airborne" | "crashed";

/** Nozzle order everywhere: front-left, front-right, rear-left, rear-right. */
export type ThrusterLevels = [number, number, number, number];

/** Read-only view of the car for rendering, camera, audio and HUD. */
export interface CarSnapshot {
  mode: CarMode;
  /** Center of mass, world space. z stays 0 unless the car is crashed. */
  position: Vec3;
  velocity: Vec3;
  /** World orientation of the car body (car-local axes: +x forward, +y up, +z right). */
  quaternion: Quat;
  /** Unwrapped pitch (rad). + = nose up = counter-clockwise when seen from +z. */
  pitch: number;
  /** Unwrapped roll (rad). + = right side down = clockwise when seen from behind. */
  roll: number;
  /** Signed speed along the track while grounded (+ = forward); |velocity| otherwise. m/s. */
  speed: number;
  /** Effective accelerator 0..1 (for audio). */
  throttle: number;
  /** Effective brake 0..1 (brake lights, audio). */
  brake: number;
  /** Cold gas remaining, 0..1. */
  gas: number;
  /** Per-nozzle jet intensity 0..1 (lift + rotation jets) for FX and audio. */
  thrusters: ThrusterLevels;
  /** Accumulated wheel rotation angle (rad) for rendering. */
  wheelSpin: number;
  /** Visual body heave, -1..1 (+ = suspension compressed). */
  suspension: number;
  /** Grounded on a curved / non-flat section of the track. */
  onRamp: boolean;
  /**
   * Distance from the lowest point of the car to the surface below (0 when grounded;
   * while crashed, the lowest body corner's height above y = 0).
   */
  heightAboveGround: number;
  /** Seconds since leaving the ground (0 unless airborne). */
  airTime: number;
  /**
   * Rotation accumulated during the current trick (rad), signed like pitch/roll.
   * Starts counting when the car leaves flat ground (enters the ramp or lifts off)
   * and resets after a moment back on flat ground; held while crashed. Drives the
   * live HUD rotation dial.
   */
  trickPitch: number;
  trickRoll: number;
}

export type VehicleKind =
  "model3" | "modelY" | "semi" | "cybertruck" | "cybercab";

/** One sample of the 2D riding-surface curve (x-y plane). */
export interface ProfileSample {
  /** Arc length from the start of the profile (m). */
  s: number;
  x: number;
  y: number;
  /** Tangent direction (rad), measured counter-clockwise from +x. 0 = flat, PI/2 = vertical going up. */
  angle: number;
  /** Signed curvature d(angle)/ds (1/m). + = curving counter-clockwise (concave, like the ramp). */
  curvature: number;
}

/** The riding surface of a level as a parametric curve in the x-y plane. */
export interface TrackProfile {
  /** Total arc length (m). */
  readonly length: number;
  /** Arc length where the flat runway ends and the ramp starts (equals `length` when there is no ramp). */
  readonly rampStart: number;
  /** Sample at arc length s (clamped to [0, length]). */
  sample(s: number): ProfileSample;
  /** Evenly spaced samples between `from` and `to` (defaults: whole profile), always including both ends. */
  samples(step: number, from?: number, to?: number): ProfileSample[];
}

/** A solid obstacle (parked vehicle or the stage they stand on). */
export interface Obstacle {
  id: string;
  kind: VehicleKind | "stage";
  /** Display name for crash messages, e.g. "Semi". */
  label: string;
  /** Center of the footprint on the ground (world x, z). The model stands on y = baseY. */
  x: number;
  z: number;
  baseY: number;
  /** Axis-aligned bounding box size: sizeX along the path, sizeY up, sizeZ lateral. */
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** Rotation of the vehicle model about +y (rad). 0 = model's +x forward points along world +x. */
  yaw: number;
  /** Convex collision outline in the world x-y plane, counter-clockwise, used by physics. */
  polygon: Array<[number, number]>;
  /** Paint color hint for the renderer (hex). */
  color: number;
}

export interface LevelGoal {
  /** Only landings after launching off the ramp lip end the run (backflip). */
  requireRampLaunch: boolean;
  /** Touchdown must happen beyond this world x to count as cleared (kickflip). */
  minTouchdownX: number | null;
}

export interface LevelDef {
  id: LevelId;
  /** Big title, e.g. "BACKFLIP". */
  title: string;
  /** Venue name, e.g. "The Curl". */
  venue: string;
  /** One-line pitch for the menu card. */
  tagline: string;
  /** Short how-to lines for the menu / first run (keyboard-agnostic wording). */
  howTo: string[];
  spinAxis: SpinAxis;
  profile: TrackProfile;
  obstacles: Obstacle[];
  /** Spawn arc length on the profile; the car starts at rest facing +x. */
  spawnS: number;
  /** Seconds of full lift thrust in a full cold-gas tank. */
  gasCapacity: number;
  /** Recommended speed window (m/s) shown on the speedometer. */
  speedHint: [number, number];
  goal: LevelGoal;
  /** Framing hints for the camera rig. */
  camera: {
    /** "side": watch the air phase from +z (backflip). "chase": stay behind the car (kickflip). */
    airView: "side" | "chase";
    /** World x the side camera frames around while airborne. */
    focusX: number;
  };
}

export type CrashReason = "angle" | "impact" | "obstacle";

export interface TrickResult {
  /** Display name, e.g. "BACKFLIP", "DOUBLE KICKFLIP", "OLLIE", "NO FLIP". */
  name: string;
  /** Signed completed rotations. + pitch = backflip direction, + roll = clockwise from behind. */
  pitchTurns: number;
  rollTurns: number;
}

export type LandingGrade = "perfect" | "great" | "good";

export interface RunStats {
  /** Seconds airborne for the scored jump. */
  airTime: number;
  /** Greatest height of the car's lowest point above the surface below (m). */
  maxHeight: number;
  /** Horizontal distance between launch and touchdown (m). */
  distance: number;
  /** Cold gas left at touchdown, 0..1. */
  gasLeft: number;
  /** Highest speed reached during the run (m/s). */
  topSpeed: number;
}

export interface ScoreBreakdown {
  /** Trick points; 0 when the level goal was missed. */
  trick: number;
  air: number;
  height: number;
  gas: number;
  /**
   * Landing-grade multiplier applied to the sum (perfect 2, great 1.5, good 1);
   * 1 when the level goal was missed.
   */
  multiplier: number;
  /** (trick + air + height + gas) × multiplier, rounded. */
  total: number;
}

export interface LandingResult {
  grade: LandingGrade;
  /** Angle between the car's up axis and the surface normal at touchdown (rad). */
  angleError: number;
  /** Speed into the surface at touchdown (m/s). */
  impactSpeed: number;
  trick: TrickResult;
  stats: RunStats;
  /** False when the landing is clean but the level goal was missed (e.g. landed short of the lineup). */
  goalMet: boolean;
  score: ScoreBreakdown;
}

export type PhysicsEvent =
  /** Grounded car left flat ground onto the ramp (camera cue). */
  | { type: "rampEnter" }
  /** Car left the ground (ramp lip or thrust lift-off). */
  | { type: "launch"; position: Vec3; speed: number; fromRamp: boolean }
  | { type: "thrustStart" }
  | { type: "thrustStop" }
  | { type: "gasEmpty" }
  /** Another full rotation completed in the air; turns is the signed running total on that axis. */
  | { type: "flip"; axis: SpinAxis; turns: number }
  /** A scored touchdown that ends the run (see LevelGoal). */
  | { type: "land"; position: Vec3; result: LandingResult }
  /** Touchdown or impact that wrecks the car; the car switches to mode "crashed". */
  | {
      type: "crash";
      position: Vec3;
      /**
       * Impact speed (m/s): its speed into the ground or ramp surface it hit in the air
       * (the back of the Curl included), or its full speed when it hit an obstacle or
       * drove into the back of the Curl.
       */
      impact: number;
      reason: CrashReason;
      /** Label of what it ran into (reason "obstacle" only), e.g. "Semi" or "Curl". */
      obstacle?: string;
    }
  /** The wreck hit something while tumbling. intensity 0..1. */
  | { type: "impact"; position: Vec3; intensity: number }
  /** After a land or crash the car has come (nearly) to rest: show results. */
  | { type: "settled" };
