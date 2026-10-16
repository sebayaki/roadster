import * as THREE from "three";
import type { CarSnapshot, Quality, Vec3 } from "@/core/types";
import { CAR } from "@/core/car-spec";
import { clamp, damp, TAU } from "@/core/math";
import { GLOW } from "./palette";
import type { RoadsterModel } from "./roadster-model";
import { createPuffAtlas, PUFF_VARIANTS } from "./fx/puff-texture";
import {
  createSpawn,
  GROUND_BOUNCE,
  GROUND_NONE,
  GROUND_SPREAD,
  ParticleSystem,
  type ParticleSpawn,
} from "./fx/particle-system";
import { Rng } from "./fx/rng";

interface Tier {
  /** Pool sizes; smoke + glow = 2500 (high) / 800 (low). */
  smoke: number;
  glow: number;
  /** Emission-rate multiplier. */
  density: number;
  /** Size multiplier (fewer, bigger puffs on low). */
  size: number;
}

const TIERS: Record<Quality, Tier> = {
  high: { smoke: 2000, glow: 500, density: 1, size: 1 },
  low: { smoke: 620, glow: 180, density: 0.36, size: 1.3 },
};

/** Cold-gas jet tunables (rates are per nozzle at full intensity, high quality). */
const JET = {
  /** car.thrusters[i] below this = nozzle off. */
  threshold: 0.02,
  puffRate: 200,
  speedMin: 25,
  speedMax: 35,
  /** Share of the car's velocity the gas keeps (the rest makes trails). */
  inherit: 0.6,
  /** Jets hitting the ground closer than this raise a ground cloud (m). */
  groundRange: 6.5,
  groundRate: 55,
  coreLength: 0.65,
  coreWidth: 0.2,
  /** Max seconds a puff stays opaque on its way to the ground. */
  visible: 0.2,
  /** Plume diameter gained per meter travelled (~7° half-angle cone). */
  spread: 0.24,
} as const;

const TIRE_SMOKE_RATE = 22;
const CRASH_SMOKE_SECONDS = 6;
const CRASH_SMOKE_RATE = 16;

/** Smoke tint of the cold-gas condensate (slightly cool white). */
const GAS_R = 0.92;
const GAS_G = 0.95;
const GAS_B = 1.0;

interface JetState {
  /** Smoothed intensity 0..1. */
  level: number;
  puffAcc: number;
  groundAcc: number;
  /** Nozzle world position this frame. */
  x: number;
  y: number;
  z: number;
  /** Nozzle position last frame: emission is spread along from -> x/y/z. */
  fromX: number;
  fromY: number;
  fromZ: number;
  /** Jet direction (unit, world space). */
  dx: number;
  dy: number;
  dz: number;
  hasPrev: boolean;
}

interface SmokeSource {
  active: boolean;
  x: number;
  y: number;
  z: number;
  time: number;
  acc: number;
}

/**
 * Particles and transient effects: cold-gas thruster plumes, ground clouds when
 * jets hit the ground, tire smoke, landing bursts, crash sparks and smoke.
 *
 * Two pooled GPU particle systems (one draw call each): normal-blended smoke
 * (sorted back to front) and additive glow (jet cores, sparks, flashes).
 * Deterministic (seeded RNG) so dev snapshots are reproducible.
 */
export class FxSystem {
  private readonly tier: Tier;
  private readonly rng = new Rng(0x5eed1e55);
  private readonly atlas: THREE.DataTexture;
  private readonly smoke: ParticleSystem;
  private readonly glow: ParticleSystem;
  private readonly p: ParticleSpawn = createSpawn();
  private readonly jets: JetState[] = [];
  private readonly sources: SmokeSource[] = [];
  private readonly tireAcc = new Float32Array(2);
  /** Car velocity seen by the last update (bursts are dragged along with the car). */
  private readonly carVel = new THREE.Vector3();

  constructor(scene: THREE.Scene, quality: Quality) {
    this.tier = TIERS[quality];
    this.atlas = createPuffAtlas();
    this.smoke = new ParticleSystem({
      kind: "smoke",
      capacity: this.tier.smoke,
      rng: this.rng,
      sprite: this.atlas,
      sorted: true,
      renderOrder: 10,
    });
    this.glow = new ParticleSystem({
      kind: "glow",
      capacity: this.tier.glow,
      rng: this.rng,
      sorted: false,
      renderOrder: 11,
    });
    scene.add(this.smoke.mesh, this.glow.mesh);
    for (let i = 0; i < 4; i++) {
      this.jets.push({
        level: 0,
        puffAcc: 0,
        groundAcc: 0,
        x: 0,
        y: 0,
        z: 0,
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        dx: 0,
        dy: -1,
        dz: 0,
        hasPrev: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.sources.push({ active: false, x: 0, y: 0, z: 0, time: 0, acc: 0 });
    }
  }

  /** Per frame. Reads jet anchors from `roadster.nozzles` (world transforms) and intensities from `car.thrusters`. */
  update(
    dt: number,
    car: CarSnapshot,
    roadster: RoadsterModel,
    camera: THREE.Camera
  ): void {
    const step = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.carVel.copy(car.velocity);
    this.smoke.simulate(step);
    this.glow.simulate(step);
    this.updateJets(step, car, roadster);
    this.updateTireSmoke(step, car, roadster);
    this.updateSources(step, car);
    camera.updateMatrixWorld();
    this.smoke.upload(camera);
    this.glow.upload(camera);
  }

  /** Big white cold-gas / dust cloud at touchdown. intensity 0..1. */
  landingBurst(position: Vec3, intensity: number): void {
    const k = clamp(intensity, 0, 1);
    const rng = this.rng;
    const sizeK = this.tier.size;
    const groundY = Math.max(0, position.y - CAR.comHeight);
    const n = Math.round((40 + 70 * k) * this.tier.density);
    for (let i = 0; i < n; i++) {
      const p = this.smokeSpawn();
      const a = (i / n) * TAU + rng.signed() * 0.4;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // A third billows up around the body, the rest rolls out low and wide.
      const billow = i % 3 === 0;
      // Start around the car's footprint (4.45 × 2 m) so the car stays visible.
      const r0 = billow ? rng.range(0.8, 1.6) : rng.range(1.0, 2.0);
      p.x = position.x + ca * r0 * 1.6;
      p.y = groundY + (billow ? rng.range(0.4, 0.9) : rng.range(0.3, 0.55));
      p.z = position.z + sa * r0;
      const out = billow
        ? rng.range(0.5, 2)
        : rng.range(3, 9) * (0.6 + 0.5 * k);
      // The cloud is dragged along with a sliding car for a moment.
      const follow = rng.range(0.25, 0.45);
      p.vx = ca * out + this.carVel.x * follow;
      p.vy = billow
        ? rng.range(1.4, 3.0) * (0.6 + 0.5 * k)
        : rng.range(0.2, 1.0);
      p.vz = sa * out + this.carVel.z * follow;
      p.life = billow ? rng.range(1.8, 2.8) : rng.range(1.4, 2.6);
      p.size0 = rng.range(0.7, 1.0) * sizeK;
      p.size1 =
        (billow ? rng.range(2.8, 3.8) : rng.range(2.6, 3.8)) *
        (0.8 + 0.3 * k) *
        sizeK;
      const b = rng.range(0.9, 1.02);
      setColor(p, b * GAS_R, b * GAS_G, b * GAS_B);
      p.alpha = billow ? rng.range(0.34, 0.45) : rng.range(0.38, 0.5);
      p.fadeIn = 0.08;
      p.fadeOut = 0.3;
      p.drag = billow ? 1.5 : 1.8;
      p.accelY = 0.25;
      p.turbulence = 1.6;
      this.smoke.emit(p);
    }
  }

  /**
   * Metal sparks for wreck impacts. intensity 0..1. `position` is a contact
   * point or the car's center; near the ground they start under the body.
   */
  sparks(position: Vec3, intensity: number): void {
    const k = clamp(intensity, 0, 1);
    const rng = this.rng;
    const p = this.p;
    const y0 =
      position.y > 2.5
        ? position.y
        : Math.max(0.05, position.y - CAR.comHeight * 0.8);
    resetGlow(p);
    // Bright flash at the contact.
    p.x = position.x;
    p.y = Math.max(0.15, y0);
    p.z = position.z;
    p.vx = p.vy = p.vz = 0;
    p.life = 0.14;
    p.size0 = 0.9 + 1.3 * k;
    p.size1 = p.size0 * 1.6;
    setGradient(p, 6, 4.2, 2.4, 2.5, 0.8, 0.15);
    p.alpha = 0.7;
    p.fadeOut = 0;
    this.glow.emit(p);

    const n = Math.round((16 + 60 * k) * Math.min(1, this.tier.density * 1.8));
    for (let i = 0; i < n; i++) {
      resetGlow(p);
      // Random direction biased upward.
      let dx = rng.signed();
      let dy = Math.abs(rng.signed()) * 0.9 + 0.25;
      let dz = rng.signed();
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= len;
      dy /= len;
      dz /= len;
      const speed = rng.range(3, 13) * (0.55 + 0.6 * k);
      p.x = position.x + rng.signed() * 0.25;
      p.y = Math.max(0.05, y0 + rng.signed() * 0.15);
      p.z = position.z + rng.signed() * 0.25;
      p.vx = dx * speed;
      p.vy = dy * speed;
      p.vz = dz * speed;
      p.life = rng.range(0.35, 1.05);
      p.size0 = p.size1 = rng.range(0.035, 0.06);
      setGradient(p, 7, 5.2, 3, 2.6, 0.55, 0.07);
      p.alpha = 1;
      p.fadeOut = 0.55;
      p.drag = 0.5;
      p.accelY = -9.81;
      p.ground = GROUND_BOUNCE;
      p.bounce = rng.range(0.25, 0.45);
      p.stretch = 0.035;
      this.glow.emit(p);
    }
  }

  /** Lingering smoke column from a wreck. */
  crashSmoke(position: Vec3): void {
    let slot = this.sources[0];
    for (const s of this.sources) {
      if (!s.active) {
        slot = s;
        break;
      }
      if (s.time > slot.time) slot = s;
    }
    slot.active = true;
    slot.x = position.x;
    slot.y = position.y;
    slot.z = position.z;
    slot.time = 0;
    slot.acc = 0;
    // Initial dark puff.
    const n = Math.round(12 * this.tier.density) + 2;
    for (let i = 0; i < n; i++) this.emitCrashPuff(slot, 1.6);
  }

  /** Remove every live particle (on restart). */
  clear(): void {
    this.smoke.clear();
    this.glow.clear();
    for (const jet of this.jets) {
      jet.level = 0;
      jet.puffAcc = 0;
      jet.groundAcc = 0;
      jet.hasPrev = false;
    }
    for (const s of this.sources) s.active = false;
    this.tireAcc.fill(0);
    this.carVel.set(0, 0, 0);
  }

  dispose(): void {
    this.smoke.dispose();
    this.glow.dispose();
    this.atlas.dispose();
  }

  private updateJets(
    dt: number,
    car: CarSnapshot,
    roadster: RoadsterModel
  ): void {
    for (let i = 0; i < 4; i++) {
      const jet = this.jets[i];
      const anchor = roadster.nozzles[i];
      if (!anchor) continue;
      anchor.updateWorldMatrix(true, false);
      const e = anchor.matrixWorld.elements;
      // Emit along the nozzle's motion since the last frame (smooth trails at
      // speed), unless it jumped (reset / teleport).
      const jx = e[12] - jet.x;
      const jy = e[13] - jet.y;
      const jz = e[14] - jet.z;
      const moved = jet.hasPrev && jx * jx + jy * jy + jz * jz < 100;
      jet.fromX = moved ? jet.x : e[12];
      jet.fromY = moved ? jet.y : e[13];
      jet.fromZ = moved ? jet.z : e[14];
      jet.x = e[12];
      jet.y = e[13];
      jet.z = e[14];
      jet.hasPrev = true;
      // Jet direction = the anchor's local -y in world space.
      const len = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]) || 1;
      jet.dx = -e[4] / len;
      jet.dy = -e[5] / len;
      jet.dz = -e[6] / len;

      const raw = car.thrusters[i];
      const target = raw > JET.threshold ? Math.min(1, raw) : 0;
      // Fast valves: ~30 ms attack, ~50 ms release.
      const rate = target > jet.level ? 35 : 20;
      jet.level = damp(jet.level, target, rate, dt);
      if (jet.level < JET.threshold) {
        jet.puffAcc = 0;
        jet.groundAcc = 0;
        continue;
      }
      this.emitJet(jet, dt, car.velocity);
    }
  }

  private emitJet(jet: JetState, dt: number, vel: Vec3): void {
    const sx = jet.fromX;
    const sy = jet.fromY;
    const sz = jet.fromZ;
    const nx = jet.x;
    const ny = jet.y;
    const nz = jet.z;
    const dx = jet.dx;
    const dy = jet.dy;
    const dz = jet.dz;
    const rng = this.rng;
    const level = jet.level;
    // Faster cars leave more lingering puffs: continuous trails in the air.
    const carSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const lingerShare = 0.05 + 0.25 * Math.min(1, carSpeed / 15);
    const density = this.tier.density;
    const sizeK = this.tier.size;

    // Distance along the jet to the ground plane (Infinity when it misses).
    const reach = dy < -0.2 ? Math.max(0, ny / -dy) : Infinity;

    // 1) Condensate puffs streaming along the jet.
    jet.puffAcc += JET.puffRate * density * level * dt;
    let count = Math.floor(jet.puffAcc);
    jet.puffAcc -= count;
    for (let k = 0; k < count; k++) {
      const f = (k + rng.next()) / count;
      const p = this.smokeSpawn();
      let ax = dx + rng.signed() * 0.08;
      let ay = dy + rng.signed() * 0.08;
      let az = dz + rng.signed() * 0.08;
      const al = Math.sqrt(ax * ax + ay * ay + az * az);
      ax /= al;
      ay /= al;
      az /= al;
      // Lingering puffs are the slow outer sheath of the jet: they stop close
      // to the nozzle's path and hang there as a trail.
      const linger = rng.next() < lingerShare;
      const speed =
        rng.range(JET.speedMin, JET.speedMax) *
        (0.55 + 0.45 * level) *
        (linger ? 0.45 : 1);
      const inherit = linger ? 0.3 : JET.inherit;
      p.age = (1 - f) * dt;
      p.x = sx + (nx - sx) * f + ax * 0.08;
      p.y = sy + (ny - sy) * f + ay * 0.08;
      p.z = sz + (nz - sz) * f + az * 0.08;
      p.vx = ax * speed + vel.x * inherit;
      p.vy = ay * speed + vel.y * inherit;
      p.vz = az * speed + vel.z * inherit;
      p.drag = linger ? 6 : rng.range(4, 5.5);
      // Most puffs die soon after reaching the ground: the ground cloud is
      // emitted separately, so the jets stay readable as columns.
      const reached = (reach * p.drag) / speed;
      // Seconds the puff stays opaque: until it hits the ground, at most
      // JET.visible (the condensate column is only a few meters long).
      const toGround =
        reached < 0.9
          ? Math.min(-Math.log(1 - reached) / p.drag, JET.visible)
          : -1;
      // Free-air jets dissolve within a few meters (the cold condensate
      // evaporates); a few lingering puffs leave a trail behind a moving car.
      p.life = linger
        ? rng.range(0.8, 1.3)
        : toGround >= 0
          ? toGround + rng.range(0.12, 0.3)
          : rng.range(0.16, 0.3);
      p.size0 = rng.range(0.28, 0.38) * sizeK;
      p.size1 = (linger ? rng.range(0.8, 1.1) : rng.range(0.4, 0.65)) * sizeK;
      p.spread = JET.spread * (linger ? 0.5 : 0.85 + 0.3 * rng.next());
      const b = rng.range(0.98, 1.1);
      setColor(p, b * GAS_R, b * GAS_G, b * GAS_B);
      p.alpha = (linger ? 0.14 : rng.range(0.75, 0.9)) * (0.5 + 0.5 * level);
      p.fadeIn = 0.03;
      // Keep the column opaque down to the ground, then dissolve.
      p.fadeOut = linger
        ? 0.25
        : toGround >= 0
          ? Math.min(0.8, toGround / p.life)
          : 0.3;
      p.accelY = 0.2;
      p.turbulence = 5;
      this.smoke.emit(p);
    }

    // 2) Ground cloud where the jet hits y = 0.
    if (reach < JET.groundRange) {
      const strength = level * Math.pow(1 - reach / JET.groundRange, 0.6);
      jet.groundAcc += JET.groundRate * density * strength * dt;
      count = Math.floor(jet.groundAcc);
      jet.groundAcc -= count;
      for (let k = 0; k < count; k++) {
        const f = (k + rng.next()) / count;
        const ox = sx + (nx - sx) * f;
        const oy = sy + (ny - sy) * f;
        const oz = sz + (nz - sz) * f;
        const t = Math.max(0, oy / -dy);
        const p = this.smokeSpawn();
        const a = rng.next() * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // A third billows up around the impact (a mound under the car), the
        // rest rolls outward along the ground.
        const billow = rng.next() < 0.35;
        const out =
          (billow ? rng.range(0.4, 1.5) : rng.range(1.5, 4.5)) *
          (0.6 + 0.6 * strength);
        const r0 = rng.range(0, 0.35);
        p.age = (1 - f) * dt;
        p.x = ox + dx * t + ca * r0;
        p.y = rng.range(0.25, 0.45);
        p.z = oz + dz * t + sa * r0;
        // Slanted jets push the cloud their way.
        p.vx = ca * out + dx * 8 * strength + vel.x * 0.25;
        p.vy = billow ? rng.range(0.8, 1.8) * strength : rng.range(0.15, 0.5);
        p.vz = sa * out + dz * 8 * strength + vel.z * 0.25;
        p.life = rng.range(1.0, 2.0);
        p.size0 = rng.range(0.45, 0.7) * sizeK;
        p.size1 = (billow ? rng.range(1.3, 1.8) : rng.range(1.0, 1.5)) * sizeK;
        const b = rng.range(0.88, 1.0);
        setColor(p, b * GAS_R, b * GAS_G, b * GAS_B);
        p.alpha = rng.range(0.26, 0.36);
        p.fadeIn = 0.06;
        p.fadeOut = 0.3;
        p.drag = billow ? 1.6 : 2.4;
        p.accelY = 0.1;
        p.turbulence = 2.5;
        this.smoke.emit(p);
      }
    } else {
      jet.groundAcc = 0;
    }

    // 3) Bright blue-white core: a one-frame streak from the nozzle plus a flare.
    const p = this.p;
    const flicker = 0.85 + 0.3 * rng.next();
    const length = JET.coreLength * (0.55 + 0.45 * level) * flicker;
    resetGlow(p);
    p.x = nx;
    p.y = ny;
    p.z = nz;
    p.vx = -dx * length;
    p.vy = -dy * length;
    p.vz = -dz * length;
    p.stretch = 1;
    p.life = 0;
    p.size0 = p.size1 = JET.coreWidth * (0.7 + 0.3 * level);
    setColor(p, GLOW.jet.r, GLOW.jet.g, GLOW.jet.b);
    p.alpha = level * flicker;
    this.glow.emit(p);

    resetGlow(p);
    p.x = nx + dx * 0.08;
    p.y = ny + dy * 0.08;
    p.z = nz + dz * 0.08;
    p.life = 0;
    p.size0 = p.size1 = 0.5 + 0.15 * level;
    setColor(p, GLOW.jet.r, GLOW.jet.g, GLOW.jet.b);
    p.alpha = 0.3 * level;
    this.glow.emit(p);
  }

  /** Rear tires: burnout (gas at low speed) or hard braking at speed. */
  private updateTireSmoke(
    dt: number,
    car: CarSnapshot,
    roadster: RoadsterModel
  ): void {
    let k = 0;
    if (car.mode === "grounded") {
      const speed = Math.abs(car.speed);
      if (car.throttle > 0.6 && speed < 13) {
        k = ((car.throttle - 0.6) / 0.4) * (1 - speed / 13);
      }
      if (car.brake > 0.5 && speed > 6) {
        const braking =
          ((car.brake - 0.5) / 0.5) * Math.min(1, (speed - 6) / 14);
        k = Math.max(k, braking);
      }
    }
    if (k <= 0.01) {
      this.tireAcc.fill(0);
      return;
    }
    const rng = this.rng;
    const sizeK = this.tier.size;
    roadster.root.updateWorldMatrix(true, false);
    const r = roadster.root.matrixWorld.elements;
    // Car axes in world space: forward (+x), up (+y), right (+z).
    const fx = r[0];
    const fy = r[1];
    const fz = r[2];
    const ux = r[4];
    const uy = r[5];
    const uz = r[6];
    const rx = r[8];
    const ry = r[9];
    const rz = r[10];
    const vel = car.velocity;
    for (let w = 0; w < 2; w++) {
      const anchor = roadster.wheels[2 + w];
      if (!anchor) continue;
      anchor.updateWorldMatrix(true, false);
      const e = anchor.matrixWorld.elements;
      const cx = e[12] - ux * CAR.wheelRadius;
      const cy = e[13] - uy * CAR.wheelRadius;
      const cz = e[14] - uz * CAR.wheelRadius;
      const outward = w === 0 ? -1 : 1;
      this.tireAcc[w] += TIRE_SMOKE_RATE * this.tier.density * k * dt;
      const count = Math.floor(this.tireAcc[w]);
      this.tireAcc[w] -= count;
      for (let i = 0; i < count; i++) {
        const p = this.smokeSpawn();
        const back = rng.range(2.5, 5.5);
        const side = rng.range(0.2, 1.0) * outward;
        p.age = rng.next() * dt;
        p.x = cx - fx * rng.range(0, 0.3) + rng.signed() * 0.1;
        p.y = Math.max(0.15, cy + 0.15);
        p.z = cz + rng.signed() * 0.12;
        p.vx = vel.x * 0.4 - fx * back + rx * side;
        p.vy = vel.y * 0.4 - fy * back + ry * side + rng.range(0.4, 1.4);
        p.vz = vel.z * 0.4 - fz * back + rz * side;
        p.life = rng.range(1.3, 2.4);
        p.size0 = rng.range(0.45, 0.7) * sizeK;
        p.size1 = rng.range(1.8, 2.6) * sizeK;
        const b = rng.range(0.72, 0.82);
        setColor(p, b, b, b * 1.02);
        p.alpha = rng.range(0.2, 0.28) * Math.min(1, 0.4 + k);
        p.fadeIn = 0.08;
        p.fadeOut = 0.3;
        p.drag = 1.3;
        p.accelY = 0.45;
        p.turbulence = 1.2;
        this.smoke.emit(p);
      }
    }
  }

  /** Crash smoke columns: follow the wreck while the car is crashed, thin out over time. */
  private updateSources(dt: number, car: CarSnapshot): void {
    for (const s of this.sources) {
      if (!s.active) continue;
      s.time += dt;
      if (s.time >= CRASH_SMOKE_SECONDS) {
        s.active = false;
        continue;
      }
      if (car.mode === "crashed") {
        s.x = damp(s.x, car.position.x, 6, dt);
        s.y = damp(s.y, car.position.y, 6, dt);
        s.z = damp(s.z, car.position.z, 6, dt);
      }
      const fade = 1 - s.time / CRASH_SMOKE_SECONDS;
      s.acc += CRASH_SMOKE_RATE * this.tier.density * Math.sqrt(fade) * dt;
      const count = Math.floor(s.acc);
      s.acc -= count;
      for (let k = 0; k < count; k++) this.emitCrashPuff(s, 1);
    }
  }

  private emitCrashPuff(s: SmokeSource, burst: number): void {
    const rng = this.rng;
    const sizeK = this.tier.size;
    const p = this.smokeSpawn();
    p.x = s.x + rng.signed() * 0.6;
    p.y = Math.max(0.3, s.y + rng.range(-0.2, 0.4));
    p.z = s.z + rng.signed() * 0.6;
    p.vx = rng.signed() * 0.8 * burst;
    p.vy = rng.range(1.2, 2.6) * burst;
    p.vz = rng.signed() * 0.8 * burst;
    p.life = rng.range(3.2, 5.2);
    p.size0 = rng.range(0.7, 1.1) * sizeK;
    p.size1 = rng.range(4.0, 6.5) * sizeK;
    const b = rng.range(0.035, 0.06);
    setColor(p, b, b * 0.97, b * 0.95);
    p.alpha = rng.range(0.5, 0.65);
    p.fadeIn = 0.06;
    p.fadeOut = 0.35;
    p.drag = 0.6;
    p.accelY = 0.45;
    p.turbulence = 0.9;
    this.smoke.emit(p);
  }

  /** The shared spawn record reset to smoke defaults (random rotation / sprite). */
  private smokeSpawn(): ParticleSpawn {
    const p = this.p;
    const rng = this.rng;
    p.age = 0;
    p.rotation = rng.next() * TAU;
    p.spin = rng.signed() * 0.9;
    p.variant = rng.int(PUFF_VARIANTS);
    p.fadeIn = 0.08;
    p.fadeOut = 0.35;
    p.drag = 0;
    p.accelY = 0;
    p.turbulence = 0;
    p.ground = GROUND_SPREAD;
    p.bounce = 0;
    p.stretch = 0;
    p.spread = 0;
    return p;
  }
}

function resetGlow(p: ParticleSpawn): void {
  p.age = 0;
  p.vx = p.vy = p.vz = 0;
  p.rotation = 0;
  p.spin = 0;
  p.variant = 0;
  p.fadeIn = 0;
  p.fadeOut = 1;
  p.drag = 0;
  p.accelY = 0;
  p.turbulence = 0;
  p.ground = GROUND_NONE;
  p.bounce = 0;
  p.stretch = 0;
  p.spread = 0;
}

function setColor(p: ParticleSpawn, r: number, g: number, b: number): void {
  p.r0 = p.r1 = r;
  p.g0 = p.g1 = g;
  p.b0 = p.b1 = b;
}

function setGradient(
  p: ParticleSpawn,
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number
): void {
  p.r0 = r0;
  p.g0 = g0;
  p.b0 = b0;
  p.r1 = r1;
  p.g1 = g1;
  p.b1 = b1;
}
