import { clamp, GRAVITY, offFullTurn, TAU } from "@/core/math";
import type { CarSnapshot, Controls, LevelDef } from "@/core/types";
import { AUTOPILOT, TUNING, type AutopilotPlan } from "./tuning";

export type AutopilotStyle = "clean" | "double";

type Phase = "approach" | "lift" | "air" | "done";

/**
 * Deterministic scripted driver that performs the level's stunt.
 * Used by physics tests (tuning proof), the menu attract demo and debug snapshots.
 * Call the returned function once per physics frame. It keeps per-run state, so create
 * a new one for every run, and it reuses the Controls object it returns.
 */
export function createAutopilot(
  level: LevelDef,
  style: AutopilotStyle = "clean"
): (car: CarSnapshot, dt: number) => Controls {
  const plan: AutopilotPlan = AUTOPILOT[level.id][style];
  const pitchAxis = level.spinAxis === "pitch";
  const target = TAU * plan.turns;
  const out: Controls = { throttle: 0, brake: 0, thrust: false, spin: 0 };
  let phase: Phase = "approach";
  let prevAngle = 0;
  let hasPrev = false;
  let burning = false;

  return (car, dt) => {
    out.throttle = 0;
    out.brake = 0;
    out.thrust = false;
    out.spin = 0;
    const angle = pitchAxis ? car.trickPitch : car.trickRoll;
    const rate = hasPrev && dt > 0 ? (angle - prevAngle) / dt : 0;
    prevAngle = angle;
    hasPrev = true;

    if (car.mode === "crashed" || phase === "done") return out;
    if (car.mode === "grounded") {
      if (phase === "air") {
        // Back on the ground after the stunt: the physics brakes by itself.
        phase = "done";
        return out;
      }
      if (phase === "approach") holdSpeed(car, plan.speed, out);
      if (plan.liftVy > 0 && car.position.x >= plan.liftX) phase = "lift";
      if (phase === "lift") {
        out.throttle = 0;
        out.brake = 0;
        out.thrust = true;
      }
      return out;
    }

    // Airborne.
    if (phase === "lift" && car.velocity.y < plan.liftVy && car.gas > 0) {
      out.thrust = true;
      return out;
    }
    phase = "air";
    out.spin = spinCommand(target - angle, rate, pitchAxis);
    out.thrust = landingBurn(car, pitchAxis ? car.pitch : car.roll);
    return out;
  };

  /** Fires the lift jets late and hard (a "suicide burn") once upright and falling. */
  function landingBurn(car: CarSnapshot, axisAngle: number): boolean {
    const err = offFullTurn(axisAngle);
    const fall = -car.velocity.y;
    if (err > AUTOPILOT.thrustWindow || fall <= 0 || car.gas <= 0) {
      burning = false;
      return false;
    }
    const available = TUNING.thrustAccel * Math.cos(err) - GRAVITY;
    const vt = AUTOPILOT.touchdownSpeed;
    const needed =
      (fall * fall - vt * vt) / (2 * Math.max(car.heightAboveGround, 0.05));
    burning =
      needed > available * (burning ? AUTOPILOT.burnOff : AUTOPILOT.burnOn);
    return burning;
  }
}

/** Throttle / brake toward a target speed. */
function holdSpeed(car: CarSnapshot, speed: number, out: Controls): void {
  const err = speed - car.speed;
  if (err < -1.5) {
    out.brake = clamp(-err * 0.3, 0, 1);
    return;
  }
  out.throttle = clamp(0.1 + err * AUTOPILOT.speedGain, 0, 1);
}

/**
 * Spin input that reaches `remaining` radians of extra rotation and stops there: follow a
 * braking curve, then let go and let the release stabilizer settle the last few degrees.
 */
function spinCommand(
  remaining: number,
  rate: number,
  pitchAxis: boolean
): number {
  const brake = TUNING.spinAccel * AUTOPILOT.spinBrakeShare;
  const dist = Math.abs(remaining);
  if (dist < AUTOPILOT.settleAngle && Math.abs(rate) < AUTOPILOT.settleRate)
    return 0;
  const max = TUNING.spinMaxRate[pitchAxis ? "pitch" : "roll"];
  const curve = Math.sqrt(2 * brake * dist);
  // Full input while the braking curve allows full rate: letting go mid-spin stops it.
  const cmd =
    curve >= max
      ? Math.sign(remaining)
      : clamp(
          (Math.sign(remaining) * curve - rate) * AUTOPILOT.spinGain,
          -1,
          1
        );
  // ◀ (−1) increases pitch; ▶ (+1) increases roll.
  return pitchAxis ? -cmd : cmd;
}
