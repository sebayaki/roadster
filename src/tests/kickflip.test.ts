import { describe, expect, it } from "vitest";
import { offFullTurn } from "@/core/math";
import type { Controls } from "@/core/types";
import { kickflipLevel, LINEUP_START_X } from "@/levels/kickflip";
import {
  autopilotDriver,
  count,
  cruise,
  first,
  gasBelow,
  IDLE,
  ofType,
  simulate,
  untilRunEnds,
  untilSettled,
  type Driver,
} from "./sim";

const level = kickflipLevel;

/**
 * Human-like run at 70 km/h: thrust for `burst` s once the car passes `liftX`, then
 * hold a roll direction for `hold` s, then feathered thrust to land.
 */
function human(liftX: number, burst: number, hold = 0, dir = -1): Driver {
  let liftTime = -1;
  let thrusting = false;
  return (car, time) => {
    const c: Controls = { ...IDLE };
    if (liftTime < 0) {
      c.throttle = gasBelow(car, 70);
      if (car.position.x < liftX) return c;
      liftTime = time;
    }
    const t = time - liftTime;
    if (t < burst) return { ...c, throttle: 0, thrust: true };
    const r = t - burst - 0.1;
    if (r >= 0 && r < hold) c.spin = dir;
    if (
      !thrusting &&
      r > hold &&
      offFullTurn(car.roll) < 0.5 &&
      car.heightAboveGround < 6 &&
      car.velocity.y < -3
    )
      thrusting = true;
    if (thrusting && car.velocity.y > -1) thrusting = false;
    c.thrust = thrusting;
    return c;
  };
}

describe("kickflip: the autopilot proves the tuning", () => {
  it.each([
    ["clean", "KICKFLIP", -1],
    ["double", "DOUBLE KICKFLIP", -2],
  ] as const)("%s style lands a %s past the lineup", (style, name, turns) => {
    const { events } = simulate(level, autopilotDriver(level, style), {
      until: untilSettled,
    });
    expect(count(events, "crash")).toBe(0);
    const launch = first(events, "launch");
    expect(launch?.fromRamp).toBe(false);
    // The lift-off happens shortly before the lineup.
    expect(launch!.position.x).toBeLessThan(LINEUP_START_X - 10);
    expect(launch!.position.x).toBeGreaterThan(LINEUP_START_X - 45);
    const land = first(events, "land");
    expect(land).toBeDefined();
    const r = land!.result;
    expect(r.trick.name).toBe(name);
    expect(r.trick.rollTurns).toBe(turns);
    expect(r.trick.pitchTurns).toBe(0);
    expect(r.goalMet).toBe(true);
    expect(land!.position.x).toBeGreaterThanOrEqual(level.goal.minTouchdownX!);
    if (style === "clean") expect(["perfect", "great"]).toContain(r.grade);
    expect(ofType(events, "flip").map((f) => f.axis)).toEqual(
      Array(-turns).fill("roll")
    );
    expect(events.at(-1)?.type).toBe("settled");
  });
});

describe("kickflip: human-like inputs", () => {
  it("lands a kickflip (◀) and a heelflip (▶)", () => {
    for (const [dir, name] of [
      [-1, "KICKFLIP"],
      [1, "HEELFLIP"],
    ] as const) {
      const { events } = simulate(level, human(-26, 0.75, 1.35, dir), {
        until: untilRunEnds,
      });
      const land = first(events, "land");
      expect(land?.result.trick.name).toBe(name);
      expect(land?.result.goalMet).toBe(true);
    }
  });

  it("crashes into the stage or the Model 3 without lift-off", () => {
    const { events, physics } = simulate(level, cruise(70), {
      until: untilSettled,
    });
    const crash = first(events, "crash");
    expect(crash?.reason).toBe("obstacle");
    expect(["stage", "Model 3"]).toContain(crash?.obstacle);
    expect(crash!.position.x).toBeLessThan(LINEUP_START_X);
    expect(physics.car.mode).toBe("crashed");
    // The wreck bounces off and comes to rest: settled is emitted once.
    expect(count(events, "settled")).toBe(1);
    expect(count(events, "impact")).toBeGreaterThan(0);
  });

  it("hits the Semi when the lift-off is too low", () => {
    const { events } = simulate(level, human(-22, 0.35), {
      until: untilRunEnds,
    });
    const crash = first(events, "crash");
    expect(crash?.reason).toBe("obstacle");
    expect(crash?.obstacle).toBe("Semi");
  });

  it("an early hop lands clean but TOO SHORT, then stops before the stage", () => {
    const { events, physics } = simulate(level, human(-50, 0.25), {
      until: untilSettled,
    });
    const land = first(events, "land");
    expect(land?.result.goalMet).toBe(false);
    expect(land?.result.trick.name).toBe("OLLIE");
    expect(land?.result.score.trick).toBe(0);
    expect(land?.result.score.multiplier).toBe(1);
    expect(count(events, "crash")).toBe(0);
    expect(events.at(-1)?.type).toBe("settled");
    expect(physics.car.mode).toBe("grounded");
    expect(physics.car.position.x).toBeLessThan(LINEUP_START_X);
  });
});
