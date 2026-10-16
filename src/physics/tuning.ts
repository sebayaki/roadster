import { DEG, GRAVITY } from "@/core/math";

/**
 * Every physics tunable in one place. SI units (m, s, rad); accelerations in m/s².
 * Changing a value here changes how the stunts play: run `npx vitest run` afterwards,
 * the physics tests prove that both stunts (single and double) are still landable.
 */
export const TUNING = {
  // ---------------------------------------------------------------- integration
  /** Fixed simulation sub-step (s). Everything is integrated at this rate. */
  substep: 1 / 240,
  /** Longest frame a single step() call simulates (s); longer frames are clamped. */
  maxFrame: 0.1,

  // ---------------------------------------------------------------- driving
  /** Motor acceleration at full throttle from standstill. */
  motorAccel: 9,
  /** Motor push falls off as 1 − (v / motorTopSpeed)² (m/s). */
  motorTopSpeed: 70,
  /** Service brake deceleration toward standstill. */
  brakeDecel: 14,
  /** Below this speed (m/s) a held brake engages reverse. */
  reverseEngageSpeed: 0.5,
  /** Reverse acceleration while the brake is held at standstill. */
  reverseAccel: 4,
  /** Top reverse speed (m/s). */
  reverseMaxSpeed: 8,
  /** Rolling resistance (constant deceleration while moving). */
  rollingResistance: 0.15,
  /** Aerodynamic drag coefficient: deceleration = drag · v · |v|. Also used in the air. */
  drag: 0.0004,
  /** After a scored landing the car brakes itself at this rate. */
  autoBrakeDecel: 12,

  // ---------------------------------------------------------------- lift-off & thrust
  /** Thrust lift-off is only possible on ground flatter than this (rad). */
  liftOffMaxAngle: 30 * DEG,
  /**
   * No new lift-off for this long after a touchdown (s), so thrusting into the ramp
   * base does not bounce on and off it every sub-step.
   */
  liftOffCooldown: 0.2,
  /** Cold-gas lift acceleration along the car's up axis. */
  thrustAccel: 2.6 * GRAVITY,

  // ---------------------------------------------------------------- air control
  /** Angular acceleration from the spin input (rad/s²). */
  spinAccel: 9,
  /**
   * Spin rate cap per player axis (rad/s). It sets how long a double takes: at 4.5 a
   * double backflip needs more than the recommended speed to finish before touchdown.
   * The kickflip rolls a full 360° on its own (no ramp rotation), so roll is faster.
   */
  spinMaxRate: { pitch: 4.5, roll: 6 },
  /**
   * Decay of the spin rate without input (1/s) when the stabilizer did not catch the
   * release: a full-rate spin coasts ~45° (roll) / ~35° (pitch) and stops there, so
   * letting go upside down still wrecks.
   */
  spinDamping: 7.5,
  /**
   * Release stabilizer ("hold to spin, let go when it's nearly upright"): when the spin
   * key is let go in the air, the stabilizing thrusters level the car onto the nearest
   * upright orientation if the release was within catchWindow of it, early or late.
   */
  catchWindow: 100 * DEG,
  /**
   * The release is judged by the angle this long (s) before the key went up: players
   * react ~0.2 s late, so a late release reaches further past upright than an early one.
   */
  catchReaction: 0.1,
  /** Critically damped PD of the stabilizer: natural frequency (rad/s)... */
  stabilizerFreq: 10,
  /** ...limited to the angular acceleration the thrusters can give (rad/s²). */
  stabilizerAccel: 40,
  /** Strong PD that keeps the non-player axis level (kickflip pitch). */
  holdStiffness: 60,
  holdDamping: 16,

  // ---------------------------------------------------------------- thruster FX levels
  /** Jet level added to the pair that creates the player's rotation torque. */
  spinJetLevel: 0.65,
  /** Most jet level the stabilizer (and the level hold) adds to a pair. */
  assistJetLevel: 0.3,

  // ---------------------------------------------------------------- tricks & landing
  /** Seconds back on flat ground before the trick rotation counter resets. */
  trickResetDelay: 0.25,
  /**
   * A flip event fires this close to a full turn (rad): the stabilizer settles onto
   * upright from either side, so a caught early release never quite crosses 360°.
   */
  flipTolerance: 5 * DEG,
  /** Landing grades: max angle error (rad) and max impact speed (m/s) for each grade. */
  grades: {
    perfect: { angle: 10 * DEG, impact: 4 },
    great: { angle: 20 * DEG, impact: 7 },
    good: { angle: 35 * DEG, impact: 11 },
  },
  /** Fraction of the along-track speed kept through a clean touchdown. */
  landingSpeedKeep: 0.92,
  /** Impact speed (m/s) that fully compresses the visual suspension. */
  landingKickSpeed: 8,
  /** Visual tilt left over from a touchdown decays at this rate (1/s). */
  landingTiltDecay: 14,
  /** settled fires when the speed drops below this (m/s) after a scored landing... */
  landSettleSpeed: 0.5,
  /** ...or after this many seconds. */
  landSettleTimeout: 2.5,
  /**
   * Hops that never get the car's underside this high (m) do not end the run, so a
   * stray tap of the thrust button is not scored as a "TOO SHORT" jump.
   */
  minScoredJumpHeight: 0.5,

  // ---------------------------------------------------------------- collision
  /** Thickness of the Curl's riding shell (m); points further behind it are free space. */
  rampShellThickness: 1.5,
  /**
   * Points that are already inside the ramp shell or the ground when the car leaves
   * them are ignored until they come out, unless they get deeper than this (m). A rigid
   * car on a concave curve sinks a few cm in, and its rotation off the lip swings the
   * tail ~0.3–0.5 m further in for the ~0.1 s until the tail passes the lip.
   */
  leaveTolerance: 1,

  // ---------------------------------------------------------------- visuals
  /** Wheel spin-down rate in the air (1/s). */
  wheelAirDecay: 0.6,
  /** Suspension spring: natural frequency (rad/s) and damping ratio. */
  suspensionFreq: 11,
  suspensionDampingRatio: 0.35,
  /** Suspension compression per g of extra ramp load. */
  suspensionLoadScale: 0.07,

  // ---------------------------------------------------------------- wreck (3D rigid body)
  wreck: {
    restitution: 0.25,
    /** Impacts slower than this (m/s) do not bounce (keeps resting contacts calm). */
    bounceThreshold: 1,
    friction: 0.6,
    linearDamping: 0.02,
    angularDamping: 0.2,
    /** Contact solver passes per sub-step. */
    iterations: 4,
    /** Fraction of the penetration removed per sub-step and the allowed slop (m). */
    correction: 0.6,
    slop: 0.004,
    /** impact events: minimum normal speed (m/s), speed for intensity 1, min interval (s). */
    impactMinSpeed: 2,
    impactFullSpeed: 15,
    impactInterval: 0.12,
    /** Extra deterministic tumble (rad/s per m/s of impact) so wrecks leave the stunt plane. */
    tumbleRoll: 0.1,
    tumbleYaw: 0.07,
    /** Sideways drift (m/s per m/s of impact). */
    drift: 0.03,
    /** At rest: |v| and |ω| below these for restTime seconds; or settled after timeout. */
    restSpeed: 0.3,
    restSpin: 0.3,
    restTime: 0.5,
    timeout: 5,
  },
} as const;

/** One scripted stunt for the autopilot. */
export interface AutopilotPlan {
  /** Signed full turns on the level's spin axis (pitch + = backflip, roll − = kickflip). */
  turns: number;
  /** Approach speed held on the runway (m/s). */
  speed: number;
  /** Kickflip only: COM x where the lift-off burst starts. */
  liftX: number;
  /** Kickflip only: vertical speed (m/s) at which the lift-off burst ends. */
  liftVy: number;
}

/** Autopilot scripts per level and style, proven by the physics tests. */
export const AUTOPILOT = {
  backflip: {
    /** Middle of the HUD speed band. */
    clean: { turns: 1, speed: 95 / 3.6, liftX: 0, liftVy: 0 },
    /** A double needs more speed than the band (it works from ~105 km/h). */
    double: { turns: 2, speed: 140 / 3.6, liftX: 0, liftVy: 0 },
  },
  kickflip: {
    /** Upside down right above the Semi, like the unveil photos. */
    clean: { turns: -1, speed: 70 / 3.6, liftX: -28, liftVy: 9 },
    /** A higher hop (~13 m) leaves time for two rolls. */
    double: { turns: -2, speed: 70 / 3.6, liftX: -32, liftVy: 13 },
  },
  /** Speed controller gain (throttle per m/s of error). */
  speedGain: 0.6,
  /** Spin controller gain (input per rad/s of rate error). */
  spinGain: 4,
  /** Braking curve uses this share of the spin acceleration. */
  spinBrakeShare: 0.8,
  /** Let go (the release stabilizer takes over) this close to the target (rad)... */
  settleAngle: 17.5 * DEG,
  /** ...once the spin is slower than this (rad/s). */
  settleRate: 2.4,
  /** Thrust only within this angle of upright (rad). */
  thrustWindow: 25 * DEG,
  /** Aimed speed into the ground at touchdown (m/s). */
  touchdownSpeed: 2.2,
  /**
   * The landing burn starts / stops when the deceleration needed to touch down at
   * touchdownSpeed exceeds these shares of the thrust available.
   */
  burnOn: 0.8,
  burnOff: 0.35,
} as const;

/** Score table (see the design spec §2.5). All values are points. */
export const SCORING = {
  /** Per completed turn on the pitch axis (backflip / frontflip). */
  pitchTurn: 1000,
  /** Per completed turn on the roll axis (kickflip / heelflip). */
  rollTurn: 800,
  /** Multiples are worth more: × (1 + multipleBonus · (|turns| − 1)). */
  multipleBonus: 0.5,
  /** A clean jump without a full rotation ("NO FLIP" / "OLLIE"). */
  noFlip: 150,
  perAirSecond: 150,
  perMeterHeight: 25,
  /** Points for a full tank left at touchdown (scaled by the fraction left). */
  fullGas: 500,
  /** Landing-grade multiplier applied to the sum. */
  multiplier: { perfect: 2, great: 1.5, good: 1 },
} as const;
