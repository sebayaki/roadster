import * as THREE from "three";

/** Pixel size of one sprite tile; the atlas is 2×2 tiles. */
const TILE = 128;
/** Number of puff variants in the atlas (2×2 tiles). */
export const PUFF_VARIANTS = 4;

function hash(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) ^
    Math.imul(iy, 668265263) ^
    Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 31);
    norm += amp;
    x = x * 2.03 + 1.7;
    y = y * 2.03 - 0.9;
    amp *= 0.5;
  }
  return sum / norm;
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Procedural 2×2 atlas of soft, billowy smoke puffs (no image assets).
 * R = density: a round mask whose rim is eroded by fbm noise into lumpy lobes.
 * G = interior detail used to modulate the fake lighting.
 */
export function createPuffAtlas(): THREE.DataTexture {
  const size = TILE * 2;
  const data = new Uint8Array(size * size * 4);
  for (let v = 0; v < PUFF_VARIANTS; v++) {
    const ox = (v % 2) * TILE;
    const oy = Math.floor(v / 2) * TILE;
    const seed = 7 + v * 101;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const u = ((x + 0.5) / TILE) * 2 - 1;
        const w = ((y + 0.5) / TILE) * 2 - 1;
        const r = Math.sqrt(u * u + w * w);
        // Soft gaussian core, faded to exactly 0 at the tile's inscribed circle.
        const falloff = Math.exp(-r * r * 2.4) * smooth(1.0, 0.78, r);
        // Lumpy outline: low-frequency noise erodes the outer part unevenly.
        const lobes = fbm(u * 1.9 + v * 5.3, w * 1.9 - v * 2.7, seed, 4);
        const outline = smooth(0.2, 0.8, lobes + 0.45 - r * 0.55);
        // Interior wisps and holes.
        const detail = fbm(u * 3.6 + 13.1, w * 3.6 - 5.7, seed + 7, 5);
        const density = Math.min(
          1,
          1.3 * falloff * (0.3 + 0.7 * outline) * (0.35 + 0.9 * detail)
        );
        const i = ((oy + y) * size + ox + x) * 4;
        data[i] = Math.round(density * 255);
        data[i + 1] = Math.round(detail * 255);
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
