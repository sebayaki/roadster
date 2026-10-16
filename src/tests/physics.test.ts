import { describe, expect, it } from "vitest";
import { Euler, Quaternion } from "three";
import { CAR } from "@/core/car-spec";
import type { CarSnapshot, Controls, PhysicsEvent } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";
import { CarPhysics } from "@/physics/car-physics";
import { TUNING } from "@/physics/tuning";
import {
  autopilotDriver,
  count,
  first,
  IDLE,
  ofType,
  simulate,
  type Driver,
} from "./sim";

const GAS: Controls = { ...IDLE, throttle: 1 };

function run(p: CarPhysics, seconds: number, c: Controls): PhysicsEvent[] {
  const out: PhysicsEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    p.step(1 / 60, c);
    out.push(...p.drainEvents());
  }
  return out;
}

function expectQuaternionMatches(car: CarSnapshot) {
  const q = new Quaternion().setFromEuler(
    new Euler(car.roll, 0, car.pitch, "ZXY")
  );
  const dot =
    q.x * car.quaternion.x +
    q.y * car.quaternion.y +
    q.z * car.quaternion.z +
    q.w * car.quaternion.w;
  expect(Math.abs(dot)).toBeCloseTo(1, 9);
}

describe("spawn and driving", () => {
  it("spawns at rest on the runway with a full tank", () => {
    const p = new CarPhysics(backflipLevel);
    const at = backflipLevel.profile.sample(backflipLevel.spawnS);
    const c = p.car;
    expect(c.mode).toBe("grounded");
    expect(c.position.x).toBeCloseTo(at.x, 6);
    expect(c.position.y).toBe(CAR.comHeight);
    expect(c.position.z).toBe(0);
    expect(c.speed).toBe(0);
    expect(c.gas).toBe(1);
    expect(c.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(c.onRamp).toBe(false);
    expect(p.drainEvents()).toEqual([]);
  });

  it("accelerates like an EV and stays put without input", () => {
    const p = new CarPhysics(kickflipLevel);
    run(p, 2, IDLE);
    expect(p.car.speed).toBe(0);
    run(p, 3, GAS);
    // ~9 m/s² falling off with speed: roughly 0-100 km/h in 3.2 s.
    expect(p.car.speed).toBeGreaterThan(24);
    expect(p.car.speed).toBeLessThan(27);
    expect(p.car.wheelSpin).toBeGreaterThan(0);
    expect(p.car.throttle).toBe(1);
  });

  it("brakes to a stop, then reverses slowly while the brake is held", () => {
    const p = new CarPhysics(kickflipLevel);
    run(p, 1.5, GAS);
    const v0 = p.car.speed;
    const brake: Controls = { ...IDLE, brake: 1 };
    run(p, v0 / TUNING.brakeDecel + 0.05, brake);
    expect(Math.abs(p.car.speed)).toBeLessThan(1);
    run(p, 4, brake);
    expect(p.car.speed).toBeLessThan(0);
    expect(p.car.speed).toBeGreaterThanOrEqual(-TUNING.reverseMaxSpeed);
    expect(p.car.speed).toBeLessThan(-TUNING.reverseMaxSpeed + 0.5);
  });

  it("ignores spin input on the ground", () => {
    const p = new CarPhysics(backflipLevel);
    run(p, 2, { ...GAS, spin: -1 });
    expect(p.car.pitch).toBe(0);
    expect(p.car.roll).toBe(0);
    expect(p.car.thrusters).toEqual([0, 0, 0, 0]);
  });

  it("clamps long frames to 0.1 s", () => {
    const a = new CarPhysics(kickflipLevel);
    a.step(1, GAS);
    const b = new CarPhysics(kickflipLevel);
    b.step(0.1, GAS);
    expect(a.car.speed).toBe(b.car.speed);
    expect(a.car.position.x).toBe(b.car.position.x);
  });
});

describe("thrusters", () => {
  it("lifts off, drains gas at 1/gasCapacity per second and reports gasEmpty once", () => {
    const p = new CarPhysics(kickflipLevel);
    const events = run(p, 0.5, { ...IDLE, thrust: true });
    expect(events[0]).toMatchObject({ type: "launch", fromRamp: false });
    expect(events[1]).toEqual({ type: "thrustStart" });
    expect(p.car.mode).toBe("airborne");
    expect(p.car.velocity.y).toBeGreaterThan(5);
    expect(p.car.thrusters).toEqual([1, 1, 1, 1]);
    expect(p.car.heightAboveGround).toBeGreaterThan(1);
    const expectedGas = 1 - 0.5 / kickflipLevel.gasCapacity;
    expect(p.car.gas).toBeCloseTo(expectedGas, 1);
    const more = run(p, kickflipLevel.gasCapacity, { ...IDLE, thrust: true });
    expect(p.car.gas).toBe(0);
    expect(count(more, "gasEmpty")).toBe(1);
    expect(count(more, "thrustStop")).toBeGreaterThan(0);
    expect(p.car.thrusters).toEqual([0, 0, 0, 0]);
  });

  it("fires the pair that creates the spin torque", () => {
    const p = new CarPhysics(kickflipLevel);
    run(p, 0.6, { ...IDLE, thrust: true });
    run(p, 0.1, { ...IDLE, spin: -1 });
    // ◀ rolls counter-clockwise from behind (roll −): right pair FR, RR.
    expect(p.car.thrusters[1]).toBeCloseTo(TUNING.spinJetLevel, 5);
    expect(p.car.thrusters[3]).toBeCloseTo(TUNING.spinJetLevel, 5);
    expect(p.car.thrusters[0]).toBe(0);
    expect(p.car.roll).toBeLessThan(0);
    const b = new CarPhysics(backflipLevel);
    run(b, 0.4, { ...IDLE, thrust: true });
    run(b, 0.1, { ...IDLE, spin: -1 });
    // ◀ pitches the nose up (backflip): front pair FL, FR.
    expect(b.car.pitch).toBeGreaterThan(0);
    expect(b.car.thrusters[0]).toBeCloseTo(TUNING.spinJetLevel, 5);
    expect(b.car.thrusters[2]).toBe(0);
  });

  it("keeps the snapshot quaternion consistent with pitch and roll", () => {
    const p = new CarPhysics(kickflipLevel);
    run(p, 0.6, { ...IDLE, thrust: true });
    for (let i = 0; i < 20; i++) {
      run(p, 0.05, { ...IDLE, spin: 1 });
      expectQuaternionMatches(p.car);
    }
    expect(p.car.roll).toBeGreaterThan(1);
    expect(p.car.trickRoll).toBeCloseTo(p.car.roll, 9);
  });
});

describe("run flow", () => {
  it("ignores controls after a scored landing and settles once", () => {
    const { physics, events } = simulate(
      kickflipLevel,
      autopilotDriver(kickflipLevel, "clean"),
      { until: (e) => e.type === "land" }
    );
    expect(events.at(-1)?.type).toBe("land");
    const after = run(physics, 4, {
      throttle: 1,
      brake: 0,
      thrust: true,
      spin: 1,
    });
    expect(physics.car.mode).toBe("grounded");
    expect(physics.car.throttle).toBe(0);
    expect(Math.abs(physics.car.speed)).toBeLessThan(TUNING.landSettleSpeed);
    expect(count(after, "settled")).toBe(1);
    expect(count(after, "launch")).toBe(0);
  });

  it("reset() returns to the spawn and clears pending events", () => {
    const p = new CarPhysics(backflipLevel);
    run(p, 1, { ...IDLE, thrust: true });
    p.step(1 / 60, { ...IDLE, thrust: true });
    p.reset();
    expect(p.drainEvents()).toEqual([]);
    expect(p.car.mode).toBe("grounded");
    expect(p.car.gas).toBe(1);
    expect(p.car.position.y).toBe(CAR.comHeight);
  });

  it.each([backflipLevel, kickflipLevel])(
    "reset() leaves nothing behind after a landing or a wreck ($id)",
    (level) => {
      const landing = () => autopilotDriver(level, "clean");
      const wreck = (): Driver => () => GAS;
      // Every snapshot and event of 20 s of driving.
      const play = (p: CarPhysics, driver: Driver): string[] => {
        const frames: string[] = [];
        for (let i = 0; i < 20 * 60; i++) {
          p.step(1 / 60, driver(p.car, i / 60, 1 / 60));
          frames.push(JSON.stringify([p.car, p.drainEvents()]));
        }
        return frames;
      };
      const landed = play(new CarPhysics(level), landing());
      const wrecked = play(new CarPhysics(level), wreck());
      expect(landed.join()).toContain('"type":"land"');
      expect(wrecked.join()).toContain('"type":"crash"');
      const p = new CarPhysics(level);
      play(p, landing());
      p.reset();
      expect(play(p, wreck())).toEqual(wrecked);
      p.reset();
      expect(play(p, landing())).toEqual(landed);
    }
  );

  it("wreck tumbles in 3D and reports impacts and settled", () => {
    // Fly straight up and fall upside down onto the runway.
    const p = new CarPhysics(kickflipLevel);
    const events = run(p, 0.6, { ...IDLE, thrust: true });
    events.push(...run(p, 0.85, { ...IDLE, spin: 1 }));
    events.push(...run(p, 8, IDLE));
    expect(first(events, "crash")).toBeDefined();
    expect(p.car.mode).toBe("crashed");
    expect(count(events, "settled")).toBe(1);
    expect(p.car.position.y).toBeGreaterThan(0);
    expect(p.car.position.y).toBeLessThan(2);
    const q = p.car.quaternion;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    const impacts = ofType(events, "impact");
    expect(impacts.length).toBeGreaterThan(0);
    for (const e of impacts) {
      expect(e.intensity).toBeGreaterThan(0);
      expect(e.intensity).toBeLessThanOrEqual(1);
    }
  });
});
