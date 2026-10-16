import { afterAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { NOZZLE_POSITIONS, WHEEL_CENTERS } from "@/core/car-spec";
import type { CarSnapshot, Controls, LevelDef } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";
import { createAutopilot } from "@/physics/autopilot";
import { CarPhysics } from "@/physics/car-physics";
import { CameraRig } from "@/render/camera-rig";
import { FxSystem } from "@/render/fx";
import type { RoadsterModel } from "@/render/roadster-model";

// The rig sizes the in-run HUD strip from the window and whether the touch HUD is shown.
const view = { innerWidth: 1280, innerHeight: 720 };
vi.stubGlobal("window", view);
afterAll(() => {
  vi.unstubAllGlobals();
});

const DT = 1 / 60;
const GAS: Controls = { throttle: 1, brake: 0, thrust: false, spin: 0 };

/** Camera rig and FX for one screen, plus the car's anchors (RoadsterModel needs a DOM canvas). */
function stage(width: number, height: number, touch = false) {
  view.innerWidth = width;
  view.innerHeight = height;
  const camera = new THREE.PerspectiveCamera(55, width / Math.max(1, height));
  const scene = new THREE.Scene();
  const rig = new CameraRig(camera, touch);
  const fx = new FxSystem(scene, "high");
  const root = new THREE.Group();
  const anchors = (list: ReadonlyArray<readonly [number, number, number]>) =>
    list.map(([x, y, z]) => {
      const anchor = new THREE.Object3D();
      anchor.position.set(x, y, z);
      root.add(anchor);
      return anchor;
    });
  const model = {
    root,
    nozzles: anchors(NOZZLE_POSITIONS),
    wheels: anchors(WHEEL_CENTERS),
  } as unknown as RoadsterModel;
  /** Poses the car, then runs the FX and the camera, like App.present(). */
  const step = (car: CarSnapshot, dt = DT) => {
    const { position: p, quaternion: q } = car;
    root.position.set(p.x, p.y, p.z);
    root.quaternion.set(q.x, q.y, q.z, q.w);
    root.updateMatrixWorld(true);
    fx.update(dt, car, model, camera);
    rig.update(dt, car);
  };
  return { camera, scene, rig, fx, step };
}
type Stage = ReturnType<typeof stage>;

/** Live particles, capacity and live positions of the smoke and glow pools. */
function pools(scene: THREE.Scene) {
  return ["fx-smoke", "fx-glow"].map((name) => {
    const mesh = scene.getObjectByName(name) as THREE.Mesh;
    const geometry = mesh.geometry as THREE.InstancedBufferGeometry;
    const attr = geometry.getAttribute("iPosSize");
    const live = mesh.visible ? geometry.instanceCount : 0;
    const data = (attr.array as Float32Array).slice(0, live * 4);
    return { live, capacity: attr.count, data };
  });
}

/**
 * Plays a level like the App: the menu demo, or a run that follows the car,
 * orbits a wreck and shows the result once the car settles.
 */
function play(
  s: Stage,
  level: LevelDef,
  o: { menu?: boolean; alt?: boolean; gas?: boolean },
  check: () => void
): CarPhysics {
  const physics = new CarPhysics(level);
  const pilot = createAutopilot(level, "clean");
  s.rig.setLevel(level);
  s.rig.setMode(o.menu ? "attract" : "follow");
  if (o.alt) s.rig.cycleFraming();
  s.fx.clear();
  s.rig.snap(physics.car);
  let end = 40 / DT;
  for (let frame = 0; frame < end; frame++) {
    physics.step(DT, o.gas ? GAS : pilot(physics.car, DT));
    for (const e of physics.drainEvents()) {
      if (e.type === "launch") s.rig.shake(0.25);
      if (e.type === "land") s.fx.landingBurst(e.position, 1);
      if (e.type === "impact") s.fx.sparks(e.position, e.intensity);
      if (e.type === "crash") {
        s.fx.sparks(e.position, 1);
        s.fx.crashSmoke(e.position);
        s.rig.shake(0.85);
        if (!o.menu) s.rig.setMode("wreck");
      }
      if (e.type === "settled" && !o.menu && end > frame + 180) {
        s.rig.setMode("result");
        end = frame + 180;
      }
    }
    s.step(physics.car);
    check();
  }
  return physics;
}

describe("camera rig", () => {
  const screens: Array<[number, number, boolean]> = [
    [1280, 720, false],
    [390, 844, true],
    [844, 390, true],
    [0, 0, false],
  ];
  const runs = [{ menu: true }, {}, { alt: true }, { gas: true }];

  it("keeps a finite camera above the ground in every mode and screen", () => {
    for (const level of [backflipLevel, kickflipLevel]) {
      for (const [width, height, touch] of screens) {
        for (const run of runs) {
          const s = stage(width, height, touch);
          const { position: p, quaternion: q } = s.camera;
          let finite = true;
          let lowest = Infinity;
          let fovMin = Infinity;
          let fovMax = -Infinity;
          play(s, level, run, () => {
            const pose = [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
            finite &&= pose.every(Number.isFinite);
            lowest = Math.min(lowest, p.y);
            fovMin = Math.min(fovMin, s.camera.fov);
            fovMax = Math.max(fovMax, s.camera.fov);
          });
          const label = `${level.id} ${width}x${height} ${JSON.stringify(run)}`;
          expect(finite, label).toBe(true);
          expect(lowest, label).toBeGreaterThanOrEqual(0.6);
          expect(fovMin, label).toBeGreaterThanOrEqual(55);
          expect(fovMax, label).toBeLessThanOrEqual(63);
        }
      }
    }
  });
});

describe("FX", () => {
  it("keeps the pools within capacity and clear() empties them", () => {
    const s = stage(1280, 720);
    const physics = play(s, backflipLevel, {}, () => {
      for (const pool of pools(s.scene)) {
        expect(pool.live).toBeLessThanOrEqual(pool.capacity);
      }
    });
    // Far more puffs and sparks than the pools hold: old ones are replaced.
    for (let i = 0; i < 50; i++) {
      s.fx.landingBurst(physics.car.position, 1);
      s.fx.sparks(physics.car.position, 1);
    }
    s.step(physics.car, 0);
    const [smoke, glow] = pools(s.scene);
    expect(smoke.live).toBe(smoke.capacity);
    expect(glow.live).toBeLessThanOrEqual(glow.capacity);
    expect(smoke.data.every(Number.isFinite)).toBe(true);
    expect(glow.data.every(Number.isFinite)).toBe(true);
    s.fx.clear();
    s.step(physics.car, 0);
    expect(pools(s.scene).map((pool) => pool.live)).toEqual([0, 0]);
  });

  it("is deterministic: the same run draws the same particles", () => {
    const record = () => {
      const s = stage(1280, 720);
      const shots: ReturnType<typeof pools>[] = [];
      let frame = 0;
      play(s, kickflipLevel, {}, () => {
        if (++frame % 60 === 0) shots.push(pools(s.scene));
      });
      return shots;
    };
    const a = record();
    expect(a.some(([smoke, glow]) => smoke.live > 0 && glow.live > 0)).toBe(
      true
    );
    expect(record()).toEqual(a);
  });
});
