import { describe, expect, it } from "vitest";
import { SmoothParam } from "@/audio/dsp";
import {
  LAYER_LEVEL,
  LayerMixer,
  MOTOR_BASE_HZ,
  MOTOR_HZ_PER_MS,
} from "@/audio/layers";
import { createFakeCar, driveFakeCar } from "@/audio/selfcheck";
import { AttractDemo } from "@/app/attract-demo";
import { presentEvent, type Presenters } from "@/app/event-presenter";
import { readParams } from "@/app/params";
import { inRun, stepsPhysics, type RunState } from "@/app/run-state";

const DT = 1 / 60;

describe("app flow", () => {
  it("reads only known URL switches", () => {
    expect(readParams("?level=kickflip&autopilot=double")).toEqual({
      level: "kickflip",
      autopilot: "double",
      demo: true,
      debug: false,
    });
    expect(readParams("?level=loop&autopilot=yes&demo=0&debug=1")).toEqual({
      level: null,
      autopilot: null,
      demo: false,
      debug: true,
    });
    for (const on of ["1", "true", "clean"]) {
      expect(readParams(`?autopilot=${on}`).autopilot).toBe("clean");
    }
  });

  it("shows the run HUD and steps physics in the documented states", () => {
    const states: RunState[] = [
      "menu",
      "ready",
      "running",
      "landed",
      "wrecked",
      "result",
    ];
    expect(states.filter(inRun)).toEqual([
      "ready",
      "running",
      "landed",
      "wrecked",
    ]);
    expect(states.filter(stepsPhysics)).toEqual([
      "running",
      "landed",
      "wrecked",
      "result",
    ]);
  });

  it("cuts the attract demo a hold after the stunt settles, or on timeout", () => {
    const demo = new AttractDemo();
    const first = demo.entry;
    expect(demo.update(10)).toBe(false);
    demo.settled();
    demo.settled(); // A second settle does not restart the hold.
    expect(demo.update(2)).toBe(false);
    expect(demo.update(0.25)).toBe(true);

    demo.next();
    expect(demo.entry.level).not.toBe(first.level);
    expect(demo.update(39.9)).toBe(false);
    expect(demo.update(0.2)).toBe(true);
    for (let i = 0; i < 3; i++) demo.next();
    expect(demo.entry).toEqual(first);
  });

  it("keeps the attract demo silent: FX and a softer shake only", () => {
    const log: string[] = [];
    const presenters = {
      hud: { popup: (text: string) => log.push(`popup ${text}`) },
      fx: {
        sparks: () => log.push("sparks"),
        crashSmoke: () => log.push("smoke"),
      },
      audio: { play: (cue: string) => log.push(`audio ${cue}`) },
      camera: { shake: (k: number) => log.push(`shake ${k.toFixed(2)}`) },
    } as unknown as Presenters;
    const crash = {
      type: "crash",
      position: { x: 0, y: 1, z: 0 },
      impact: 12,
      reason: "obstacle",
      obstacle: "Semi",
    } as const;

    presentEvent(crash, presenters, true);
    expect(log).toEqual(["sparks", "smoke", "shake 0.34"]);
    log.length = 0;
    presentEvent(crash, presenters, false);
    expect(log).toEqual([
      "sparks",
      "smoke",
      "shake 0.85",
      "audio crash",
      "popup WRECKED",
    ]);
  });
});

describe("continuous audio layers", () => {
  it("fades the whole mix out without a car", () => {
    const mixer = new LayerMixer();
    const car = createFakeCar();
    driveFakeCar(car, "grounded", 20, 1, 0, 0, 0);
    expect(mixer.update(DT, car).bus).toBe(1);
    expect(mixer.update(DT, null).bus).toBe(0);
  });

  it("pitches the motor with the wheels and keeps road noise on the ground", () => {
    const mixer = new LayerMixer();
    const car = createFakeCar();
    driveFakeCar(car, "grounded", 20, 1, 0, 0, 0);
    const ground = { ...mixer.update(DT, car) };
    expect(ground.motorHz).toBeCloseTo(MOTOR_BASE_HZ + 20 * MOTOR_HZ_PER_MS);
    expect(ground.roadGain).toBeGreaterThan(0);

    driveFakeCar(car, "airborne", 20, 0, 0, 0, 10);
    const air = mixer.update(DT, car);
    expect(air.roadGain).toBe(0);
    expect(air.windGain).toBeGreaterThan(ground.windGain);
    // Off the throttle the free wheels spin down.
    expect(air.motorHz).toBeLessThan(ground.motorHz);

    driveFakeCar(car, "crashed", 15, 1, 0, 0, 0);
    expect(mixer.update(DT, car).motorGain).toBe(0);
  });

  it("drives the jet hiss from the thrusters and swells the roar near the ground", () => {
    const mixer = new LayerMixer();
    const car = createFakeCar();
    driveFakeCar(car, "airborne", 10, 0, 0, 1, 0.5);
    const low = { ...mixer.update(DT, car) };
    expect(low.hissGain).toBeCloseTo(LAYER_LEVEL.hiss);
    expect(low.roarGain).toBeCloseTo(LAYER_LEVEL.roar);
    driveFakeCar(car, "airborne", 10, 0, 0, 1, 10);
    expect(mixer.update(DT, car).roarGain).toBeCloseTo(LAYER_LEVEL.roar * 0.55);
    driveFakeCar(car, "airborne", 10, 0, 0, 0, 10);
    expect(mixer.update(DT, car).hissGain).toBe(0);
  });

  it("glides parameters with rise / fall constants and skips tiny moves", () => {
    const calls: number[][] = [];
    const param = {
      setTargetAtTime: (target: number, time: number, tau: number) =>
        calls.push([target, time, tau]),
    } as unknown as AudioParam;
    const p = new SmoothParam(param, 0.1, 0.3, 0.01);
    p.set(0, 0);
    p.set(0.5, 1);
    p.set(0.505, 2); // Below epsilon.
    p.set(0.2, 3);
    p.set(0.005, 4);
    p.set(0, 5); // Below epsilon, but true silence is always reached.
    p.set(0, 6);
    expect(calls).toEqual([
      [0, 0, 0.3],
      [0.5, 1, 0.1],
      [0.2, 3, 0.3],
      [0.005, 4, 0.3],
      [0, 5, 0.3],
    ]);
  });
});
