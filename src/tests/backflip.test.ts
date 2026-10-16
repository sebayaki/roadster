import { describe, expect, it } from "vitest";
import { CAR } from "@/core/car-spec";
import { GRAVITY, TAU } from "@/core/math";
import type { CarSnapshot, Controls } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import {
  autopilotDriver,
  count,
  cruise,
  first,
  IDLE,
  simulate,
  untilSettled,
  type Driver,
} from "./sim";

const level = backflipLevel;

/** Human-like air inputs: ◀ for `hold` s shortly after the lip, then feathered thrust. */
function humanAir(hold: number, thrustHeight = 12): Driver {
  let launchTime = -1;
  let thrusting = false;
  return (car, time) => {
    if (launchTime < 0) launchTime = time;
    const t = time - launchTime;
    const spin = t >= 0.15 && t < 0.15 + hold ? -1 : 0;
    const upright = Math.abs(car.pitch - TAU * Math.round(car.pitch / TAU));
    if (
      !thrusting &&
      upright < 0.5 &&
      car.heightAboveGround < thrustHeight &&
      car.velocity.y < -4
    )
      thrusting = true;
    if (thrusting && car.velocity.y > -1) thrusting = false;
    return { throttle: 0, brake: 0, thrust: thrusting, spin };
  };
}

function trickOf(kmh: number, hold: number): string {
  const { events } = simulate(level, cruise(kmh, humanAir(hold)), {
    until: (e) => e.type === "land" || e.type === "crash",
  });
  const land = first(events, "land");
  return land ? land.result.trick.name : "WRECK";
}

describe("backflip: the autopilot proves the tuning", () => {
  it.each([
    ["clean", "BACKFLIP", 1],
    ["double", "DOUBLE BACKFLIP", 2],
  ] as const)("%s style lands a %s", (style, name, turns) => {
    const { events } = simulate(level, autopilotDriver(level, style), {
      until: untilSettled,
    });
    expect(count(events, "crash")).toBe(0);
    expect(count(events, "rampEnter")).toBe(1);
    expect(first(events, "launch")?.fromRamp).toBe(true);
    const land = first(events, "land");
    expect(land).toBeDefined();
    const r = land!.result;
    expect(r.trick.name).toBe(name);
    expect(r.trick.pitchTurns).toBe(turns);
    expect(r.trick.rollTurns).toBe(0);
    expect(r.goalMet).toBe(true);
    if (style === "clean") expect(["perfect", "great"]).toContain(r.grade);
    // One flip event per completed turn, all before the touchdown.
    const flips = events.filter((e) => e.type === "flip");
    expect(flips).toEqual(
      Array.from({ length: turns }, (_, i) => ({
        type: "flip",
        axis: "pitch",
        turns: i + 1,
      }))
    );
    expect(events.indexOf(flips[turns - 1])).toBeLessThan(
      events.indexOf(land!)
    );
    // It flies back over the runway from the 24 m lip and lands on thrusters.
    expect(land!.position.x).toBeLessThan(-20);
    expect(r.stats.maxHeight).toBeGreaterThan(20);
    expect(r.stats.airTime).toBeGreaterThan(2.5);
    expect(r.stats.gasLeft).toBeLessThan(1);
    expect(count(events, "thrustStart")).toBeGreaterThan(0);
    expect(r.score.total).toBeGreaterThan(r.score.trick);
    expect(events.at(-1)?.type).toBe("settled");
  });
});

describe("backflip: human-like inputs", () => {
  it("lands a single across the HUD speed band with a forgiving release", () => {
    const [lo, hi] = level.speedHint.map((v) => v * 3.6);
    for (const kmh of [lo, (lo + hi) / 2, hi]) {
      // Any ◀ hold between 0.7 s and 1.3 s works at every speed in the band.
      for (const hold of [0.7, 0.85, 1, 1.15, 1.3])
        expect(trickOf(kmh, hold), `${kmh} km/h, ${hold} s`).toBe("BACKFLIP");
    }
  });

  it("needs more speed than the band for a double", () => {
    const holds = Array.from({ length: 40 }, (_, i) => 0.6 + i * 0.05);
    const landed = (kmh: number, name: string) =>
      holds.filter((h) => trickOf(kmh, h) === name).length;
    expect(landed(level.speedHint[1] * 3.6 - 10, "DOUBLE BACKFLIP")).toBe(0);
    // Possible at high speed, but in a narrower band of release times than a single.
    const fast = landed(140, "DOUBLE BACKFLIP");
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeLessThan(landed(140, "BACKFLIP"));
  });

  it("wrecks without input after the lip", () => {
    const { events, physics } = simulate(level, cruise(95), {
      until: untilSettled,
    });
    expect(first(events, "launch")?.fromRamp).toBe(true);
    expect(first(events, "land")).toBeUndefined();
    const crash = first(events, "crash");
    expect(crash?.reason).toBe("angle");
    expect(physics.car.mode).toBe("crashed");
    expect(events.at(-1)?.type).toBe("settled");
  });

  it("wrecks when landing without thrust", () => {
    const { events } = simulate(level, cruise(95, humanAir(0.9, -1)), {
      until: (e) => e.type === "crash" || e.type === "land",
    });
    const crash = first(events, "crash");
    expect(crash?.reason).toBe("impact");
    expect(crash!.impact).toBeGreaterThan(15);
  });

  it("does not reach the lip when too slow and rolls back down", () => {
    let rolledBack = false;
    const { events, physics } = simulate(level, cruise(62), {
      seconds: 25,
      onFrame: (p) => {
        if (p.car.speed < -5 && p.car.position.x < -5) rolledBack = true;
      },
    });
    // Gas stays on, so after rolling back it tries (and fails) again.
    expect(count(events, "rampEnter")).toBeGreaterThanOrEqual(1);
    expect(count(events, "launch")).toBe(0);
    expect(count(events, "crash")).toBe(0);
    expect(rolledBack).toBe(true);
    expect(physics.car.mode).toBe("grounded");
  });
});

describe("backflip: ramp physics", () => {
  it("conserves energy on the ramp apart from rolling resistance and drag", () => {
    // Coast up the Curl without throttle: ½v² + g·y of the COM may only decrease.
    let prev = Infinity;
    let entry = NaN;
    let atLip = NaN;
    let rises = 0;
    const energy = (c: CarSnapshot) =>
      0.5 * c.speed * c.speed + GRAVITY * c.position.y;
    const driver: Driver = (car) => ({
      ...IDLE,
      throttle: !car.onRamp && car.speed < 26 && Number.isNaN(entry) ? 1 : 0,
    });
    simulate(level, driver, {
      until: (e) => e.type === "launch",
      onFrame: (p) => {
        const c = p.car;
        if (c.onRamp) {
          const e = energy(c);
          if (Number.isNaN(entry)) entry = e;
          if (e > prev + 1e-6) rises++;
          prev = e;
          atLip = e;
        }
      },
    });
    expect(rises).toBe(0);
    const lost = entry - atLip;
    // Rolling resistance over ~33 m of COM path plus drag: a few J/kg.
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(15);
  });

  it("keeps the car on the surface past vertical (fan suction) and follows the track angle", () => {
    let maxPitch = 0;
    let offSurface = 0;
    simulate(level, cruise(95), {
      until: (e) => e.type === "launch",
      onFrame: (p) => {
        const c = p.car;
        if (!c.onRamp) return;
        maxPitch = Math.max(maxPitch, c.pitch);
        // COM stays comHeight from the curve: compare with the profile near it.
        const pts = level.profile.samples(0.05, level.profile.rampStart);
        let best = Infinity;
        for (const s of pts)
          best = Math.min(
            best,
            Math.hypot(s.x - c.position.x, s.y - c.position.y)
          );
        offSurface = Math.max(offSurface, Math.abs(best - CAR.comHeight));
      },
    });
    expect(maxPitch).toBeGreaterThan((160 * Math.PI) / 180);
    expect(offSurface).toBeLessThan(0.02);
  });

  it("a thrust hop on the runway does not end the run", () => {
    let hopDone = false;
    const driver: Driver = (car, time) => {
      const c: Controls = { ...IDLE, throttle: 1 };
      if (time > 2 && time < 2.3) c.thrust = true;
      if (car.mode === "airborne" && car.velocity.y < -4) c.thrust = true;
      if (time > 6) hopDone = true;
      return hopDone ? { ...IDLE, throttle: 1 } : c;
    };
    const { events, physics } = simulate(level, driver, { seconds: 7 });
    expect(first(events, "launch")?.fromRamp).toBe(false);
    expect(count(events, "land")).toBe(0);
    expect(count(events, "crash")).toBe(0);
    expect(physics.car.mode).toBe("grounded");
    // Still driving: controls work after the hop.
    expect(physics.car.throttle).toBe(1);
    expect(physics.car.speed).toBeGreaterThan(20);
  });
});
