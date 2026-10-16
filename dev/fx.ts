/**
 * FX preview (dev/fx.html): the Roadster hovering ~3 m above asphalt on its
 * four cold-gas jets, rolling, landing in a cloud, plus sparks and smoke.
 *
 *   ?demo=hover    (default) lift-off, hover, a full roll, descent + landing
 *                  burst, burnout tire smoke, sparks
 *   ?demo=fly      flying along +x on the jets while rolling (trails)
 *   ?demo=crash    impact sparks, tumble, lingering crash smoke (clear() per cycle)
 *   ?demo=burnout  burnout tire smoke, then hard braking from speed
 *   ?scenery=backflip|kickflip  use the real venue (car moved to the landing
 *                  zone / before the lineup) instead of the stand-in asphalt
 *   ?view=side|front|close|ground|wide|chase|curl|lineup
 *   ?t=<s>&freeze=1   ?quality=low
 */
import * as THREE from "three";
import { runHarness, type HarnessContext, type View } from "./harness";
import { FxSystem } from "@/render/fx";
import { RoadsterModel } from "@/render/roadster-model";
import { CAR } from "@/core/car-spec";
import { TAU, lerp, smoothstep } from "@/core/math";
import { createCarSnapshot } from "@/core/snapshot";
import type { CarMode, CarSnapshot, Quality, Vec3 } from "@/core/types";
import { getLevel } from "@/levels";
import { buildScenery, type Scenery } from "@/render/scenery";
import { GLOW, PALETTE } from "@/render/palette";

declare global {
  interface Window {
    /** The page's FxSystem, for `scripts/snap.mjs --eval` inspection. */
    __fx?: FxSystem;
  }
}

interface Pose {
  x: number;
  y: number;
  pitch: number;
  roll: number;
  mode: CarMode;
  thrusters: [number, number, number, number];
  throttle: number;
  brake: number;
  /** Signed track speed while grounded. */
  speed: number;
}

interface Demo {
  period: number;
  pose(t: number, out: Pose): void;
  /** One-shot effects at a cycle time (seconds). */
  events: Array<{ at: number; fire(fx: FxSystem, car: CarSnapshot): void }>;
  /** Called when the cycle restarts. */
  onCycle?(fx: FxSystem): void;
}

const HOVER_Y = 3.2;

function setJets(o: Pose, fl: number, fr: number, rl: number, rr: number) {
  o.thrusters[0] = fl;
  o.thrusters[1] = fr;
  o.thrusters[2] = rl;
  o.thrusters[3] = rr;
}

function resetPose(o: Pose): void {
  o.x = 0;
  o.y = CAR.comHeight;
  o.pitch = 0;
  o.roll = 0;
  o.mode = "airborne";
  o.throttle = 0;
  o.brake = 0;
  o.speed = 0;
  setJets(o, 0, 0, 0, 0);
}

/** World x of the demo's origin (moved next to the real venue's structures). */
let originX = 0;
/** A point relative to the demo origin. */
const at = (x: number, y: number, z: number): Vec3 => ({
  x: originX + x,
  y,
  z,
});
/** A point under the car's center of mass at height y. */
const under = (car: CarSnapshot, y: number): Vec3 => ({
  x: car.position.x,
  y,
  z: car.position.z,
});

const DEMOS: Record<string, Demo> = {
  hover: {
    period: 14,
    pose(t, o) {
      resetPose(o);
      const bob = (s: number) => 0.12 * Math.sin((s - 1.2) * 1.6);
      const sway = (s: number) => 0.2 * Math.sin((s - 1.2) * 0.7);
      if (t < 1.2) {
        o.y = lerp(CAR.comHeight, HOVER_Y, smoothstep(0, 1.2, t));
        setJets(o, 1, 1, 1, 1);
      } else if (t < 9.4) {
        o.y = HOVER_Y + bob(t);
        o.x = sway(t);
        setJets(o, 1, 1, 1, 1);
        if (t >= 6 && t < 7.6) {
          // A full kickflip-style roll; the left pair adds the roll torque.
          const u = (t - 6) / 1.6;
          o.roll = TAU * smoothstep(0, 1, u);
          o.y += 1.0 * Math.sin(Math.PI * u);
          setJets(o, 1, 0.45, 1, 0.45);
        }
      } else if (t < 11) {
        const u = smoothstep(9.4, 11, t);
        o.x = sway(9.4);
        o.y = lerp(HOVER_Y + bob(9.4), CAR.comHeight, u);
        setJets(o, 1, 1, 1, 1);
      } else {
        o.x = sway(9.4);
        o.mode = "grounded";
        if (t > 11.6 && t < 13) o.throttle = 1;
      }
    },
    events: [
      { at: 3.2, fire: (fx) => fx.sparks(at(7, 0.3, -3), 0.6) },
      {
        at: 11,
        fire: (fx, car) => fx.landingBurst(under(car, car.position.y), 0.8),
      },
      { at: 13.2, fire: (fx) => fx.sparks(at(6, 0.3, 2.5), 1) },
    ],
  },
  fly: {
    period: 60 / 18,
    pose(t, o) {
      resetPose(o);
      o.x = -30 + 18 * t;
      o.y = 3.6;
      o.roll = (TAU * t) / 2.4;
      setJets(o, 1, 0.55, 1, 0.55);
    },
    events: [],
  },
  crash: {
    period: 8,
    pose(t, o) {
      resetPose(o);
      if (t < 0.7) {
        o.x = -6 + 8.5 * t;
        o.y = 3 - 0.5 * 9.81 * t * t;
        o.pitch = -0.6 * t;
        o.roll = 2.2 * t;
        return;
      }
      o.mode = "crashed";
      const u = Math.min(t - 0.7, 1.9);
      const decay = 1 - Math.exp(-1.5 * u);
      o.x = -0.05 + 4 * decay;
      o.y = 0.6 + 0.9 * Math.abs(Math.sin(5 * u)) * Math.exp(-1.8 * u);
      o.pitch = -0.42 - 0.6 * decay;
      o.roll = 1.54 + 1.6 * decay;
    },
    events: [
      {
        at: 0.7,
        fire: (fx, car) => {
          fx.sparks(under(car, 0.2), 1);
          fx.crashSmoke(car.position);
        },
      },
      {
        at: 1.33,
        fire: (fx, car) => fx.sparks(under(car, 0.2), 0.6),
      },
      {
        at: 1.96,
        fire: (fx, car) => fx.sparks(under(car, 0.2), 0.35),
      },
    ],
    onCycle: (fx) => fx.clear(),
  },
  burnout: {
    period: 7,
    pose(t, o) {
      resetPose(o);
      o.mode = "grounded";
      if (t < 2.6) {
        o.throttle = 1;
        o.speed = 0.4;
      } else if (t >= 3 && t < 5) {
        const u = t - 3;
        o.x = -20 + 20 * u - 5 * u * u;
        o.speed = 20 - 10 * u;
        o.brake = 1;
      }
    },
    events: [],
  },
};

const VIEWS: Record<string, View> = {
  side: { position: [0, 2.6, 24], target: [0, 2.0, 0], fov: 40 },
  front: { position: [24, 2.2, 0], target: [0, 2.1, 0], fov: 36 },
  close: { position: [5.5, 1.3, 6.5], target: [0, 1.6, 0], fov: 45 },
  ground: { position: [13, 0.45, 10], target: [0, 1.1, 0], fov: 45 },
  wide: { position: [-4, 6, 52], target: [-4, 3.5, 0], fov: 55 },
  chase: { position: [-16, 4, 3], target: [2, 2, 0], fov: 50 },
  // With ?scenery=backflip: the car left of the Curl (backflip refs).
  curl: { position: [-22, 4, 62], target: [-5, 8, 0], fov: 45 },
  // With ?scenery=kickflip: lift-off before the lineup.
  lineup: { position: [-12, 3, 42], target: [-14, 4, 0], fov: 50 },
};

function makePose(): Pose {
  const pose: Pose = {
    x: 0,
    y: 0,
    pitch: 0,
    roll: 0,
    mode: "airborne",
    thrusters: [0, 0, 0, 0],
    throttle: 0,
    brake: 0,
    speed: 0,
  };
  resetPose(pose);
  return pose;
}

/** Night venue stand-in: asphalt, a center line, red LED edge strips, floodlights, fog. */
function buildVenue(scene: THREE.Scene, quality: Quality): void {
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.004);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({
      color: PALETTE.asphalt,
      roughness: 0.78,
      metalness: 0,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 0.22),
    new THREE.MeshStandardMaterial({ color: PALETTE.linePaint, roughness: 0.7 })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.004;
  scene.add(line);

  const led = new THREE.MeshBasicMaterial({ color: GLOW.ledRed });
  for (const z of [-9, 9]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(400, 0.03, 0.04), led);
    strip.position.set(0, 0.02, z);
    scene.add(strip);
  }

  scene.add(new THREE.HemisphereLight(0x8a96a8, 0x0c0d10, 0.15));
  const flood = new THREE.SpotLight(0xf2f4ff, 2400, 200, 0.42, 0.65, 2);
  flood.position.set(30, 34, 36);
  flood.target.position.set(0, 1, 0);
  flood.castShadow = quality === "high";
  flood.shadow.mapSize.set(1024, 1024);
  scene.add(flood, flood.target);
  const back = new THREE.SpotLight(0xdfe6ff, 1600, 200, 0.4, 0.7, 2);
  back.position.set(-32, 28, -30);
  back.target.position.set(0, 1, 0);
  scene.add(back, back.target);
}

let fx: FxSystem;
let roadster: RoadsterModel;
let scenery: Scenery | null = null;
let demo: Demo;
let lastCycleTime = 0;
const car = createCarSnapshot();
const pose = makePose();
const poseA = makePose();
const poseB = makePose();
const euler = new THREE.Euler(0, 0, 0, "ZXY");

function applyPose(t: number): void {
  demo.pose(t, pose);
  // Central difference for the velocity (jets inherit it).
  const h = 1 / 240;
  demo.pose(Math.max(0, t - h), poseA);
  demo.pose(t + h, poseB);
  let vx = (poseB.x - poseA.x) / (2 * h);
  let vy = (poseB.y - poseA.y) / (2 * h);
  if (Math.abs(vx) > 60 || Math.abs(vy) > 60) vx = vy = 0;

  car.mode = pose.mode;
  car.position.x = originX + pose.x;
  car.position.y = pose.y;
  car.velocity.x = vx;
  car.velocity.y = vy;
  car.pitch = pose.pitch;
  car.roll = pose.roll;
  car.speed = pose.mode === "grounded" ? pose.speed : Math.hypot(vx, vy);
  car.throttle = pose.throttle;
  car.brake = pose.brake;
  for (let i = 0; i < 4; i++) car.thrusters[i] = pose.thrusters[i];
  car.heightAboveGround = Math.max(0, pose.y - CAR.comHeight);

  euler.set(pose.roll, 0, pose.pitch, "ZXY");
  roadster.root.position.set(originX + pose.x, pose.y, 0);
  roadster.root.quaternion.setFromEuler(euler);
  const q = roadster.root.quaternion;
  car.quaternion.x = q.x;
  car.quaternion.y = q.y;
  car.quaternion.z = q.z;
  car.quaternion.w = q.w;
  roadster.root.updateMatrixWorld(true);
}

function fireEvents(from: number, to: number): void {
  for (const e of demo.events) {
    if (e.at > from && e.at <= to) e.fire(fx, car);
  }
}

void runHarness({
  views: VIEWS,
  setup(ctx: HarnessContext) {
    const venue = ctx.params.get("scenery");
    if (venue === "backflip" || venue === "kickflip") {
      scenery = buildScenery(getLevel(venue), ctx.quality);
      // Backflip: hover over the runway left of the Curl; kickflip: before the lineup.
      originX = venue === "backflip" ? -14 : -24;
      ctx.scene.add(scenery.root);
      ctx.scene.fog = scenery.fog;
    } else {
      buildVenue(ctx.scene, ctx.quality);
    }
    roadster = new RoadsterModel(ctx.quality);
    ctx.scene.add(roadster.root);
    fx = new FxSystem(ctx.scene, ctx.quality);
    window.__fx = fx;
    demo = DEMOS[ctx.params.get("demo") ?? "hover"] ?? DEMOS.hover;
    applyPose(0);
  },
  update(dt, time, ctx) {
    const t = time % demo.period;
    if (t < lastCycleTime) {
      fireEvents(lastCycleTime, demo.period);
      demo.onCycle?.(fx);
      lastCycleTime = -1e-9;
    }
    applyPose(t);
    fireEvents(lastCycleTime, t);
    lastCycleTime = t;
    const burnout = car.mode === "grounded" && car.throttle > 0.5;
    car.wheelSpin += (burnout ? 40 : car.speed / CAR.wheelRadius) * dt;
    roadster.update(dt, car);
    fx.update(dt, car, roadster, ctx.camera);
    scenery?.update(dt, time, car.position);
  },
});
