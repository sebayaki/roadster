import * as THREE from "three";
import { mulberry32 } from "@/core/math";
import type { Quality } from "@/core/types";

/**
 * Procedural textures for the venue. Everything is generated from a seeded
 * PRNG into DataTextures, so the look is identical on every load and no
 * network request is needed. Being deterministic, each texture is generated
 * once (per quality) and shared by every scenery for the rest of the page's
 * life: never dispose one (scenery disposal skips them, see `isSharedTexture`).
 */

/** Color, roughness and normal maps of one tiling surface. */
export interface SurfaceTextures {
  map: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  /** Omitted on the low quality tier. */
  normalMap: THREE.DataTexture | null;
}

const cache = new Map<string, unknown>();
const sharedTextures = new WeakSet<THREE.Texture>();

/** The value cached under `key`, created on first use. */
function shared<T>(key: string, create: () => T): T {
  if (!cache.has(key)) cache.set(key, create());
  return cache.get(key) as T;
}

/** True for the textures made here, which outlive any one scenery. */
export function isSharedTexture(texture: THREE.Texture): boolean {
  return sharedTextures.has(texture);
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Tileable fractal value noise in [0, 1] on a size×size grid.
 * Each octave is [cells across the tile, weight]; cell counts must divide evenly into a tile to wrap.
 */
function fbm(
  size: number,
  rand: () => number,
  octaves: ReadonlyArray<readonly [number, number]>
): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  for (const [period, weight] of octaves) {
    total += weight;
    const grid = new Float32Array(period * period);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const scale = period / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale;
      const iy = Math.floor(fy);
      const ty = smooth(fy - iy);
      const row0 = (iy % period) * period;
      const row1 = ((iy + 1) % period) * period;
      for (let x = 0; x < size; x++) {
        const fx = x * scale;
        const ix = Math.floor(fx);
        const tx = smooth(fx - ix);
        const x0 = ix % period;
        const x1 = (ix + 1) % period;
        const a = grid[row0 + x0];
        const b = grid[row0 + x1];
        const c = grid[row1 + x0];
        const d = grid[row1 + x1];
        out[y * size + x] +=
          weight *
          (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Tangent-space normal map (OpenGL convention) from a wrapping height field. */
function normalsFromHeight(
  height: Float32Array,
  size: number,
  strength: number
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const up = ((y + size - 1) % size) * size;
    const down = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const left = (x + size - 1) % size;
      const right = (x + 1) % size;
      const nx = (height[row + left] - height[row + right]) * strength;
      const ny = (height[up + x] - height[down + x]) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function makeTexture(
  data: Uint8Array,
  width: number,
  height: number,
  opts: { srgb?: boolean; repeat?: boolean; mipmaps?: boolean; aniso?: number }
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrap = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter =
    opts.mipmaps === false
      ? THREE.LinearFilter
      : THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = opts.mipmaps !== false;
  tex.anisotropy = opts.aniso ?? 1;
  tex.needsUpdate = true;
  sharedTextures.add(tex);
  return tex;
}

/** Writes a single channel value (0..1) into R, G and B (A = 255). */
function grayPixel(data: Uint8Array, i: number, v: number): void {
  const b = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
  data[i] = b;
  data[i + 1] = b;
  data[i + 2] = b;
  data[i + 3] = 255;
}

/** World size (m) covered by one asphalt texture tile. */
export const ASPHALT_TILE = 7;

/**
 * Dark asphalt with aggregate grain and patchy wear. The color map is a light
 * modulation (average ≈ 0.6) meant to be multiplied by a dark material color.
 * Shared: generated once per quality.
 */
export function createAsphaltTextures(quality: Quality): SurfaceTextures {
  return shared(`asphalt-${quality}`, () => asphaltTextures(quality));
}

function asphaltTextures(quality: Quality): SurfaceTextures {
  const size = quality === "high" ? 1024 : 512;
  const rand = mulberry32(0xa5f417);
  const fine = size / 4;
  const macro = fbm(size, rand, [
    [4, 0.45],
    [8, 0.3],
    [16, 0.25],
  ]);
  const grainField = fbm(size, rand, [
    [fine / 4, 0.35],
    [fine / 2, 0.35],
    [fine, 0.3],
  ]);
  const height = new Float32Array(size * size);
  const stone = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) {
    height[i] = grainField[i] * 0.8 + rand() * 0.25;
  }
  // Aggregate: small bright / dark chips pressed into the binder.
  const chips = Math.floor((size * size) / 55);
  const radiusScale = size / 1024;
  for (let c = 0; c < chips; c++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = (0.7 + rand() * rand() * 2.6) * Math.max(0.6, radiusScale * 1.6);
    const tone = rand() < 0.7 ? 0.35 + rand() * 0.65 : -0.4 - rand() * 0.3;
    const r2 = r * r;
    const ext = Math.ceil(r);
    for (let dy = -ext; dy <= ext; dy++) {
      for (let dx = -ext; dx <= ext; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const x = (Math.floor(cx) + dx + size) % size;
        const y = (Math.floor(cy) + dy + size) % size;
        const i = y * size + x;
        const f = 1 - d2 / (r2 + 0.5);
        stone[i] = Math.max(stone[i], tone * f);
        height[i] += 0.35 * f;
      }
    }
  }

  const color = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  for (let i = 0; i < height.length; i++) {
    const m = macro[i];
    const wear = smooth(Math.min(1, Math.max(0, (m - 0.35) * 2.2)));
    let v = 0.7 + (grainField[i] - 0.5) * 0.3 + (rand() - 0.5) * 0.1;
    v += stone[i] * 0.3;
    v *= 0.84 + wear * 0.24;
    const p = i * 4;
    const b = Math.min(1, Math.max(0, v));
    color[p] = b * 246;
    color[p + 1] = b * 248;
    color[p + 2] = Math.min(255, b * 262);
    color[p + 3] = 255;
    // Worn binder is smoother (a faint sheen); chips are polished.
    const r =
      0.72 - wear * 0.14 - Math.max(0, stone[i]) * 0.12 + (rand() - 0.5) * 0.08;
    grayPixel(rough, p, r);
  }

  const aniso = quality === "high" ? 8 : 4;
  return {
    map: makeTexture(color, size, size, { srgb: true, repeat: true, aniso }),
    roughnessMap: makeTexture(rough, size, size, { repeat: true, aniso }),
    normalMap:
      quality === "high"
        ? makeTexture(normalsFromHeight(height, size, 2.2), size, size, {
            repeat: true,
            aniso,
          })
        : null,
  };
}

/** One concrete texture tile covers this many meters along the ride and the full 8 m width. */
export const CONCRETE_TILE = 8;
/** Distance between transverse panel joints on the Curl (m). */
const CONCRETE_PANEL = 2;
/** Painted center line width (m). */
const CENTER_LINE_WIDTH = 0.16;

/**
 * Light-gray concrete of the Curl's riding surface. u runs along the ride
 * (CONCRETE_TILE meters per tile), v across the 8 m width; the white center
 * line is painted at v = 0.5, with faint rubber marks along both wheel paths.
 * Shared: generated once per quality.
 */
export function createConcreteTextures(quality: Quality): SurfaceTextures {
  return shared(`concrete-${quality}`, () => concreteTextures(quality));
}

function concreteTextures(quality: Quality): SurfaceTextures {
  const size = quality === "high" ? 1024 : 512;
  const pxPerM = size / CONCRETE_TILE;
  const rand = mulberry32(0xc0c2e7);
  const mottle = fbm(size, rand, [
    [4, 0.35],
    [8, 0.3],
    [32, 0.2],
    [128, 0.15],
  ]);
  const grain = fbm(size, rand, [
    [size / 8, 0.5],
    [size / 4, 0.5],
  ]);
  const streak = fbm(size, rand, [
    [16, 0.6],
    [64, 0.4],
  ]);
  const height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const panel = CONCRETE_PANEL * pxPerM;
  const lineHalf = (CENTER_LINE_WIDTH / 2) * pxPerM;
  const wheelOffset = 0.86 * pxPerM;
  const wheelHalf = 0.22 * pxPerM;
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    // y runs across the width: distance to the center line and the wheel paths.
    const dLine = Math.abs(y + 0.5 - center);
    const dWheel = Math.min(
      Math.abs(y + 0.5 - (center - wheelOffset)),
      Math.abs(y + 0.5 - (center + wheelOffset))
    );
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const p = i * 4;
      // Transverse joints every CONCRETE_PANEL meters (wrapping distance).
      const along = x % panel;
      const dJoint = Math.min(along, panel - along);
      const joint = dJoint < 1 ? 1 : dJoint < 2 ? 0.3 : 0;
      const m = mottle[i];
      const g = grain[i];
      let v =
        0.84 + (m - 0.5) * 0.16 + (g - 0.5) * 0.09 + (rand() - 0.5) * 0.05;
      let r = 0.8 + (g - 0.5) * 0.12;
      let h = g * 0.5 + rand() * 0.12;
      // Faint rubber marks along both wheel paths.
      if (dWheel < wheelHalf) {
        const k = smooth(1 - dWheel / wheelHalf) * streak[i];
        v -= k * 0.08;
        r -= k * 0.05;
      }
      // Painted center line with slightly worn edges.
      const edge = lineHalf + (mottle[(i + 97) % mottle.length] - 0.5) * 1.6;
      if (dLine < edge) {
        v = 0.97 + (g - 0.5) * 0.04;
        r = 0.55;
        h += 0.15;
      }
      v -= joint * 0.13;
      r += joint * 0.06;
      h -= joint * 0.5;
      grayPixel(color, p, v);
      grayPixel(rough, p, r);
      height[i] = h;
    }
  }

  const aniso = quality === "high" ? 16 : 4;
  return {
    map: makeTexture(color, size, size, { srgb: true, repeat: true, aniso }),
    roughnessMap: makeTexture(rough, size, size, { repeat: true, aniso }),
    normalMap:
      quality === "high"
        ? makeTexture(normalsFromHeight(height, size, 1.6), size, size, {
            repeat: true,
            aniso,
          })
        : null,
  };
}

/**
 * Soft round glow: white RGB, alpha falling smoothly from 1 at the center to 0
 * at the edge. Used for lamp halos and haze. Shared.
 */
export function createGlowTexture(size = 128): THREE.DataTexture {
  return shared(`glow-${size}`, () => glowTexture(size));
}

function glowTexture(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      // Gaussian-like core with a long soft skirt that reaches exactly 0 at r = 1.
      const a =
        (Math.exp(-r * r * 5) * 0.75 + (1 - r) * (1 - r) * 0.25) * (1 - r * r);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return makeTexture(data, size, size, {});
}

/**
 * Cross profile of a light spill strip (u across, v unused): intensity in RGB,
 * peaking at u = 0.5 and fading to 0 at both edges. Shared.
 */
export function createSpillTexture(): THREE.DataTexture {
  return shared("spill", spillTexture);
}

function spillTexture(): THREE.DataTexture {
  const width = 256;
  const data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const d = Math.abs((x + 0.5) / width - 0.5) * 2;
    const v = (Math.exp(-d * 9) * 0.6 + Math.exp(-d * 3.2) * 0.4) * (1 - d);
    const i = x * 4;
    grayPixel(data, i, v);
  }
  return makeTexture(data, width, 1, { mipmaps: false });
}
