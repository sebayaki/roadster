import { describe, expect, it } from "vitest";
import type { Controls, LevelDef } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";
import { createAutopilot } from "@/physics/autopilot";
import { CarPhysics } from "@/physics/car-physics";

/** Deterministic pseudo-random frame times (LCG) to mimic a jittery frame rate. */
function frameTimes(count: number, seed: number): number[] {
  let s = seed;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    out.push(1 / 75 + (s / 4294967296) * (1 / 30 - 1 / 75));
  }
  return out;
}

function record(level: LevelDef, dts: number[], scripted: boolean) {
  const physics = new CarPhysics(level);
  const pilot = createAutopilot(level, "clean");
  const frames: string[] = [];
  const events: unknown[] = [];
  let t = 0;
  for (const dt of dts) {
    const c: Controls = scripted
      ? {
          throttle: t < 6 ? 1 : 0,
          brake: 0,
          thrust: t > 4 && t < 4.6,
          spin: t > 4.8 && t < 5.4 ? -1 : 0,
        }
      : pilot(physics.car, dt);
    physics.step(dt, c);
    t += dt;
    frames.push(JSON.stringify(physics.car));
    events.push(...physics.drainEvents());
  }
  return { frames, events };
}

describe("determinism", () => {
  it.each([
    ["backflip autopilot", backflipLevel, false],
    ["kickflip autopilot", kickflipLevel, false],
    ["kickflip scripted wreck", kickflipLevel, true],
  ] as const)(
    "%s: same inputs give identical results",
    (_, level, scripted) => {
      const dts = frameTimes(900, 42);
      const a = record(level, dts, scripted);
      const b = record(level, dts, scripted);
      expect(b.events).toEqual(a.events);
      expect(b.frames).toEqual(a.frames);
      expect(a.events.length).toBeGreaterThan(3);
    }
  );
});

describe("performance", () => {
  it("simulates a 15 s run in well under 50 ms", () => {
    const runOnce = () => {
      const physics = new CarPhysics(backflipLevel);
      const pilot = createAutopilot(backflipLevel, "double");
      const start = performance.now();
      for (let i = 0; i < 15 * 60; i++) {
        physics.step(1 / 60, pilot(physics.car, 1 / 60));
        physics.drainEvents();
      }
      return performance.now() - start;
    };
    runOnce(); // warm up the JIT
    const best = Math.min(runOnce(), runOnce(), runOnce());
    expect(best).toBeLessThan(50);
  });
});
