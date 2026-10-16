import * as THREE from "three";
import { TAU } from "@/core/math";
import { createParticleMaterial, type ParticleKind } from "./particle-material";
import type { ParticleUniforms } from "./particle-material";
import type { Rng } from "./rng";

/** How a particle reacts to the ground plane y = 0. */
export const GROUND_NONE = 0;
/** Bounce off the ground like a spark (`bounce` = restitution). */
export const GROUND_BOUNCE = 1;
/** Smoke: stay above the ground and turn downward motion into outward spread. */
export const GROUND_SPREAD = 2;

/**
 * Description of one particle to emit. Emitters keep one instance, fill the
 * fields and call `ParticleSystem.emit` (no per-particle allocations).
 */
export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds already elapsed at spawn (sub-frame emission); the position is advanced by it. */
  age: number;
  /** Lifetime (s). 0 = a one-frame particle (drawn once, removed on the next simulate). */
  life: number;
  /** Diameter at birth and at death (m); grows with an ease-out curve. */
  size0: number;
  size1: number;
  /** Extra diameter gained per meter travelled (plume / jet spreading). */
  spread: number;
  /** Sprite rotation (rad) and its rate (rad/s). Smoke only. */
  rotation: number;
  spin: number;
  /** Linear color at birth / death (HDR allowed for glow). */
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  /** Peak opacity (smoke) or intensity multiplier (glow). */
  alpha: number;
  /** Fraction of the life spent fading in. */
  fadeIn: number;
  /** Life fraction where the fade-out starts (1 = no fade). */
  fadeOut: number;
  /** Air drag (1/s): velocity decays by exp(-drag·dt). */
  drag: number;
  /** Vertical acceleration (m/s²): gravity < 0, buoyancy > 0. */
  accelY: number;
  /** Amplitude of the smooth turbulent acceleration (m/s²). */
  turbulence: number;
  /** GROUND_NONE / GROUND_BOUNCE / GROUND_SPREAD. */
  ground: number;
  /** Restitution for GROUND_BOUNCE. */
  bounce: number;
  /** Glow: streak = velocity × stretch (s). */
  stretch: number;
  /** Smoke: atlas tile 0..3. */
  variant: number;
}

/** A spawn description with neutral defaults. */
export function createSpawn(): ParticleSpawn {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    life: 1,
    size0: 1,
    size1: 1,
    spread: 0,
    rotation: 0,
    spin: 0,
    r0: 1,
    g0: 1,
    b0: 1,
    r1: 1,
    g1: 1,
    b1: 1,
    alpha: 1,
    fadeIn: 0,
    fadeOut: 1,
    drag: 0,
    accelY: 0,
    turbulence: 0,
    ground: GROUND_NONE,
    bounce: 0,
    stretch: 0,
    variant: 0,
  };
}

// CPU state layout (array of structs in one Float32Array).
const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const AGE = 6;
const LIFE = 7;
const SIZE0 = 8;
const SIZE1 = 9;
const ROT = 10;
const SPIN = 11;
const R0 = 12;
const G0 = 13;
const B0 = 14;
const R1 = 15;
const G1 = 16;
const B1 = 17;
const ALPHA = 18;
const FADE_IN = 19;
const FADE_OUT = 20;
const DRAG = 21;
const ACCEL_Y = 22;
const TURB = 23;
const PHASE = 24;
const GROUND = 25;
const BOUNCE = 26;
const STRETCH = 27;
const VARIANT = 28;
const SPREAD = 29;
/** Diameter gained so far from SPREAD. */
const GROWN = 30;
const STRIDE = 31;

/** Depth range covered by the 16-bit sort keys (m). */
const SORT_RANGE = 1200;
/** GROUND_SPREAD puffs keep their center at least this many radii above y = 0. */
const GROUND_FLOOR = 0.4;

function ease(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Current diameter of the particle at state offset `o`, life fraction `t`. */
function sizeAt(s: Float32Array, o: number, t: number): number {
  const grow = 1 - (1 - t) * (1 - t);
  return s[o + SIZE0] + (s[o + SIZE1] - s[o + SIZE0]) * grow + s[o + GROWN];
}

export interface ParticleSystemOptions {
  kind: ParticleKind;
  capacity: number;
  rng: Rng;
  /** Puff atlas for smoke. */
  sprite?: THREE.Texture | null;
  /** Sort back to front every upload (normal blending). */
  sorted: boolean;
  renderOrder: number;
}

/**
 * Pooled particle system drawn as camera-facing instanced quads in ONE draw
 * call. Simulation (integration, ground contact, curves over life) runs on the
 * CPU in preallocated typed arrays; the live range is streamed to instanced
 * attributes each frame. Dead particles are swap-removed so live ones stay packed.
 */
export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  /** Live particle count. */
  count = 0;

  private readonly kind: ParticleKind;
  private readonly sorted: boolean;
  private readonly rng: Rng;
  private readonly state: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms: ParticleUniforms;
  private readonly posSize: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  /** iStreak (vec3) for glow, iRot (vec2) for smoke. */
  private readonly extra: THREE.InstancedBufferAttribute;
  private readonly keys: Uint16Array;
  private readonly order: Uint16Array;
  private readonly scratch: Uint16Array;
  private readonly buckets = new Uint32Array(256);
  private readonly viewport = new THREE.Vector4();
  private readonly ranges = new Map<
    THREE.BufferAttribute,
    { start: number; count: number }
  >();

  constructor(opts: ParticleSystemOptions) {
    this.kind = opts.kind;
    this.capacity = opts.capacity;
    this.sorted = opts.sorted;
    this.rng = opts.rng;
    const cap = opts.capacity;
    this.state = new Float32Array(cap * STRIDE);
    this.keys = new Uint16Array(cap);
    this.order = new Uint16Array(cap);
    this.scratch = new Uint16Array(cap);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        3
      )
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (size: number) => {
      const attr = new THREE.InstancedBufferAttribute(
        new Float32Array(cap * size),
        size
      );
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    this.posSize = attribute(4);
    this.color = attribute(4);
    this.extra = attribute(this.kind === "glow" ? 3 : 2);
    geometry.setAttribute("iPosSize", this.posSize);
    geometry.setAttribute("iColor", this.color);
    geometry.setAttribute(
      this.kind === "glow" ? "iStreak" : "iRot",
      this.extra
    );
    geometry.instanceCount = 0;
    this.geometry = geometry;

    this.material = createParticleMaterial(opts.kind, opts.sprite ?? null);
    this.uniforms = this.material.uniforms as ParticleUniforms;
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `fx-${opts.kind}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = opts.renderOrder;
    mesh.visible = false;
    mesh.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(this.viewport);
      if (this.uniforms.uViewportHeight.value !== this.viewport.w) {
        this.uniforms.uViewportHeight.value = this.viewport.w;
        this.material.uniformsNeedUpdate = true;
      }
    };
    this.mesh = mesh;
  }

  /** Add one particle; when the pool is full it replaces an old one. */
  emit(p: ParticleSpawn): void {
    const i = this.count < this.capacity ? this.count++ : this.victim();
    const s = this.state;
    const o = i * STRIDE;
    s[o + X] = p.x + p.vx * p.age;
    s[o + Y] = p.y + p.vy * p.age;
    s[o + Z] = p.z + p.vz * p.age;
    s[o + VX] = p.vx;
    s[o + VY] = p.vy;
    s[o + VZ] = p.vz;
    s[o + AGE] = p.life > 0 ? Math.min(p.age, p.life * 0.5) : 0;
    s[o + LIFE] = p.life;
    s[o + SIZE0] = p.size0;
    s[o + SIZE1] = p.size1;
    s[o + ROT] = p.rotation;
    s[o + SPIN] = p.spin;
    s[o + R0] = p.r0;
    s[o + G0] = p.g0;
    s[o + B0] = p.b0;
    s[o + R1] = p.r1;
    s[o + G1] = p.g1;
    s[o + B1] = p.b1;
    s[o + ALPHA] = p.alpha;
    s[o + FADE_IN] = p.fadeIn;
    s[o + FADE_OUT] = p.fadeOut;
    s[o + DRAG] = p.drag;
    s[o + ACCEL_Y] = p.accelY;
    s[o + TURB] = p.turbulence;
    s[o + PHASE] = this.rng.next() * TAU;
    s[o + GROUND] = p.ground;
    s[o + BOUNCE] = p.bounce;
    s[o + STRETCH] = p.stretch;
    s[o + VARIANT] = p.variant;
    s[o + SPREAD] = p.spread;
    s[o + GROWN] = 0;
  }

  /** Advance every particle by dt and drop the dead ones. */
  simulate(dt: number): void {
    const s = this.state;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      const life = s[o + LIFE];
      const age = s[o + AGE] + dt;
      if (life <= 0 || age >= life) {
        this.remove(i);
        continue;
      }
      s[o + AGE] = age;
      let vx = s[o + VX];
      let vy = s[o + VY];
      let vz = s[o + VZ];
      const drag = s[o + DRAG];
      if (drag > 0) {
        const k = Math.exp(-drag * dt);
        vx *= k;
        vy *= k;
        vz *= k;
      }
      vy += s[o + ACCEL_Y] * dt;
      const turb = s[o + TURB];
      if (turb > 0) {
        // Smooth per-particle wobble (cheap stand-in for a curl-noise field).
        const ph = s[o + PHASE];
        const a = turb * dt;
        vx += a * Math.sin(age * 5.3 + ph);
        vy += a * 0.6 * Math.sin(age * 6.1 + ph * 1.7);
        vz += a * Math.cos(age * 4.7 + ph * 2.3);
      }
      const spread = s[o + SPREAD];
      if (spread > 0) {
        s[o + GROWN] += spread * Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
      }
      const x = s[o + X] + vx * dt;
      let y = s[o + Y] + vy * dt;
      const z = s[o + Z] + vz * dt;
      const ground = s[o + GROUND];
      if (ground === GROUND_BOUNCE) {
        if (y < 0.02) {
          y = 0.02;
          if (vy < 0) {
            vy = -vy * s[o + BOUNCE];
            vx *= 0.7;
            vz *= 0.7;
          }
        }
      } else if (ground === GROUND_SPREAD) {
        const floor = 0.5 * sizeAt(s, o, age / life) * GROUND_FLOOR;
        if (y < floor) {
          y = floor;
          if (vy < 0) {
            // The ground deflects the downward motion outward (ground-hugging
            // spread); the share varies per particle so no ring wall forms.
            const ph = s[o + PHASE];
            const push = -vy * (0.42 + 0.18 * Math.sin(ph * 3.7));
            const h = Math.sqrt(vx * vx + vz * vz);
            if (h > 0.05) {
              vx += (vx / h) * push;
              vz += (vz / h) * push;
            } else {
              vx += Math.cos(ph) * push;
              vz += Math.sin(ph) * push;
            }
            vy = 0;
            // Mixing slows once the plume runs along the ground.
            s[o + SPREAD] *= 0.5;
          }
        }
      }
      s[o + X] = x;
      s[o + Y] = y;
      s[o + Z] = z;
      s[o + VX] = vx;
      s[o + VY] = vy;
      s[o + VZ] = vz;
      s[o + ROT] += s[o + SPIN] * dt;
      i++;
    }
  }

  /**
   * Evaluate size / color / alpha over life and stream the live particles to
   * the GPU (back to front for normal blending). `camera.matrixWorld` must be current.
   */
  upload(camera: THREE.Camera): void {
    const n = this.count;
    this.mesh.visible = n > 0;
    this.geometry.instanceCount = n;
    if (n === 0) return;
    const order = this.sorted ? this.sortBackToFront(camera) : null;
    const s = this.state;
    const ps = this.posSize.array as Float32Array;
    const col = this.color.array as Float32Array;
    const ex = this.extra.array as Float32Array;
    const glow = this.kind === "glow";
    for (let j = 0; j < n; j++) {
      const o = (order ? order[j] : j) * STRIDE;
      const life = s[o + LIFE];
      const t = life > 0 ? Math.min(1, s[o + AGE] / life) : 0;
      let alpha = s[o + ALPHA];
      const fadeIn = s[o + FADE_IN];
      if (t < fadeIn) alpha *= ease(t / fadeIn);
      const fadeOut = s[o + FADE_OUT];
      if (t > fadeOut) alpha *= 1 - ease((t - fadeOut) / (1 - fadeOut));
      const j4 = j * 4;
      ps[j4] = s[o + X];
      ps[j4 + 1] = s[o + Y];
      ps[j4 + 2] = s[o + Z];
      ps[j4 + 3] = sizeAt(s, o, t);
      col[j4] = s[o + R0] + (s[o + R1] - s[o + R0]) * t;
      col[j4 + 1] = s[o + G0] + (s[o + G1] - s[o + G0]) * t;
      col[j4 + 2] = s[o + B0] + (s[o + B1] - s[o + B0]) * t;
      col[j4 + 3] = alpha;
      if (glow) {
        const stretch = s[o + STRETCH];
        const j3 = j * 3;
        ex[j3] = s[o + VX] * stretch;
        ex[j3 + 1] = s[o + VY] * stretch;
        ex[j3 + 2] = s[o + VZ] * stretch;
      } else {
        const j2 = j * 2;
        ex[j2] = s[o + ROT];
        ex[j2 + 1] = s[o + VARIANT];
      }
    }
    this.markUpdated(this.posSize, n);
    this.markUpdated(this.color, n);
    this.markUpdated(this.extra, n);
  }

  /** Kill every particle. */
  clear(): void {
    this.count = 0;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Upload only the live range; reuses one range record per attribute (no per-frame garbage). */
  private markUpdated(attr: THREE.InstancedBufferAttribute, n: number): void {
    let range = this.ranges.get(attr);
    if (!range) {
      range = { start: 0, count: 0 };
      this.ranges.set(attr, range);
    }
    range.count = n * attr.itemSize;
    attr.updateRanges.length = 0;
    attr.updateRanges.push(range);
    attr.needsUpdate = true;
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.state.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
    }
  }

  /** Pool full: replace the most aged of a few random particles. */
  private victim(): number {
    const s = this.state;
    let best = 0;
    let bestAge = -1;
    for (let k = 0; k < 6; k++) {
      const i = this.rng.int(this.count);
      const o = i * STRIDE;
      const life = s[o + LIFE];
      const aged = life > 0 ? s[o + AGE] / life : 1;
      if (aged > bestAge) {
        bestAge = aged;
        best = i;
      }
    }
    return best;
  }

  /** Two-pass 8-bit radix sort of particle indices by view depth, farthest first. */
  private sortBackToFront(camera: THREE.Camera): Uint16Array {
    const n = this.count;
    const s = this.state;
    const e = camera.matrixWorld.elements;
    const cx = e[12];
    const cy = e[13];
    const cz = e[14];
    // Camera looks down its local -z.
    const fx = -e[8];
    const fy = -e[9];
    const fz = -e[10];
    const keys = this.keys;
    const order = this.order;
    const scratch = this.scratch;
    const buckets = this.buckets;
    const scale = 65535 / SORT_RANGE;
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const depth =
        (s[o + X] - cx) * fx + (s[o + Y] - cy) * fy + (s[o + Z] - cz) * fz;
      let q = depth * scale;
      q = q < 0 ? 0 : q > 65535 ? 65535 : q;
      keys[i] = 65535 - (q | 0);
      order[i] = i;
    }
    // Pass 1: low byte, order -> scratch.
    buckets.fill(0);
    for (let i = 0; i < n; i++) buckets[keys[i] & 255]++;
    let sum = 0;
    for (let b = 0; b < 256; b++) {
      const c = buckets[b];
      buckets[b] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const idx = order[i];
      scratch[buckets[keys[idx] & 255]++] = idx;
    }
    // Pass 2: high byte, scratch -> order.
    buckets.fill(0);
    for (let i = 0; i < n; i++) buckets[keys[i] >> 8]++;
    sum = 0;
    for (let b = 0; b < 256; b++) {
      const c = buckets[b];
      buckets[b] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const idx = scratch[i];
      order[buckets[keys[idx] >> 8]++] = idx;
    }
    return order;
  }
}
