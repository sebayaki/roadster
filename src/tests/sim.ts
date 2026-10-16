import type {
  CarSnapshot,
  Controls,
  LevelDef,
  PhysicsEvent,
} from "@/core/types";
import { TAU } from "@/core/math";
import { createAutopilot, type AutopilotStyle } from "@/physics/autopilot";
import { CarPhysics } from "@/physics/car-physics";

/** Per-frame driver: returns the controls for this frame. */
export type Driver = (car: CarSnapshot, time: number, dt: number) => Controls;

export interface SimOptions {
  /** Simulated seconds before giving up (default 30). */
  seconds?: number;
  /** Frame length (default 1/60). */
  dt?: number;
  /** Stop after the frame in which this returns true. */
  until?: (event: PhysicsEvent, physics: CarPhysics) => boolean;
  /** Called after every frame. */
  onFrame?: (physics: CarPhysics, time: number) => void;
}

export interface SimResult {
  physics: CarPhysics;
  events: PhysicsEvent[];
  /** Simulated time when the run stopped. */
  time: number;
}

export const IDLE: Controls = {
  throttle: 0,
  brake: 0,
  thrust: false,
  spin: 0,
};

/** Drives a fresh CarPhysics for the level, collecting every event. */
export function simulate(
  level: LevelDef,
  driver: Driver,
  opts: SimOptions = {}
): SimResult {
  const physics = new CarPhysics(level);
  const dt = opts.dt ?? 1 / 60;
  const frames = Math.round((opts.seconds ?? 30) / dt);
  const events: PhysicsEvent[] = [];
  let time = 0;
  for (let i = 0; i < frames; i++) {
    const controls = driver(physics.car, time, dt);
    physics.step(dt, controls);
    time += dt;
    let stop = false;
    for (const e of physics.drainEvents()) {
      events.push(e);
      if (opts.until?.(e, physics)) stop = true;
    }
    opts.onFrame?.(physics, time);
    if (stop) break;
  }
  return { physics, events, time };
}

/** The run's autopilot as a Driver. */
export function autopilotDriver(
  level: LevelDef,
  style: AutopilotStyle
): Driver {
  const pilot = createAutopilot(level, style);
  return (car, _time, dt) => pilot(car, dt);
}

/**
 * Keyboard-style driver: full gas below `kmh` (and all the way up a ramp), then hands
 * over to `air` once airborne.
 */
export function cruise(kmh: number, air: Driver = () => IDLE): Driver {
  return (car, time, dt) => {
    if (car.mode !== "grounded") return air(car, time, dt);
    const below = car.speed * 3.6 < kmh;
    return {
      throttle: car.onRamp || below ? 1 : 0,
      brake: 0,
      thrust: false,
      spin: 0,
    };
  };
}

export function first<T extends PhysicsEvent["type"]>(
  events: PhysicsEvent[],
  type: T
): Extract<PhysicsEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as
    Extract<PhysicsEvent, { type: T }> | undefined;
}

export function count(events: PhysicsEvent[], type: PhysicsEvent["type"]) {
  return events.filter((e) => e.type === type).length;
}

/** Stops the simulation once the run produced `settled`. */
export const untilSettled: SimOptions["until"] = (e) => e.type === "settled";

/** A player for reactiveHuman(): what they aim for and how late they react. */
export interface HumanPlan {
  /** Approach speed (km/h): gas while slower, and all the way up a ramp. */
  kmh: number;
  /** Spin key held in the air: −1 = ◀, +1 = ▶. */
  dir: number;
  /** Where they decide to let go, relative to a full turn (rad, negative = early). */
  release: number;
  /** Reaction delay (s): every key change happens this long after the decision. */
  delay: number;
  /** Kickflip: x where they decide to fire the lift-off thrust... */
  liftX?: number;
  /** ...and the height (m) at which they decide to let go of it (default 3). */
  liftHeight?: number;
}

/**
 * Keyboard player with a reaction delay: gas to a speed, (kickflip) thrust off the
 * ground until ~3 m up, hold the spin key until the trick angle reaches a full turn
 * + `release`, then thrust while upright and falling to cushion the landing.
 */
export function reactiveHuman(level: LevelDef, plan: HumanPlan): Driver {
  const pitchAxis = level.spinAxis === "pitch";
  const decisions: Array<{ time: number; controls: Controls }> = [];
  let launched = false;
  let lifted = false;
  let released = false;
  return (car, time) => {
    const c: Controls = { ...IDLE };
    const air = car.mode === "airborne";
    launched ||= air;
    if (!launched) {
      c.throttle = car.onRamp || car.speed * 3.6 < plan.kmh ? 1 : 0;
      if (plan.liftX !== undefined && car.position.x >= plan.liftX)
        c.thrust = true;
    } else if (air) {
      const h = car.heightAboveGround;
      const angle = pitchAxis ? car.trickPitch : car.trickRoll;
      const tilt = pitchAxis ? car.pitch : car.roll;
      lifted ||= plan.liftX === undefined || h > (plan.liftHeight ?? 3);
      released ||= Math.abs(angle) >= TAU + plan.release;
      if (!released && (pitchAxis || h > 2.5)) c.spin = plan.dir;
      const upright = Math.abs(tilt - TAU * Math.round(tilt / TAU)) < 0.6;
      c.thrust =
        !lifted || (released && upright && car.velocity.y < -2.5 && h < 12);
    }
    decisions.push({ time, controls: c });
    while (
      decisions.length > 1 &&
      decisions[1].time <= time - plan.delay + 1e-9
    )
      decisions.shift();
    return decisions[0].time <= time - plan.delay + 1e-9
      ? decisions[0].controls
      : IDLE;
  };
}
