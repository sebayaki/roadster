import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ProfileSample, Quality } from "@/core/types";
import { backflipLevel, CURL_WIDTH } from "@/levels/backflip";
import { GLOW, PALETTE } from "./palette";
import { createLedLines, type LedLineOptions } from "./scenery/led-lines";
import { scaleEnvironment } from "./scenery/materials";
import { MemberList, type Vec3Tuple } from "./scenery/members";
import { CONCRETE_TILE, createConcreteTextures } from "./textures";

/**
 * "The Curl": the riding surface is the backflip profile swept across exactly
 * CURL_WIDTH (the car rides this surface), with a dark ~0.7 m shell behind it,
 * red LED strips on both edges, a concrete apron at the base and a galvanized
 * steel truss tower holding it up to the lip. Built in the backflip level's
 * world frame: base at x = 0, rising toward +x, lip pointing back over -x.
 */

/** Shell thickness behind the riding surface (m). */
export const CURL_SHELL = 0.7;
/** Front / back faces of the truss tower (world x). */
export const TOWER_X0 = 11;
export const TOWER_X1 = 14;
/** Truss planes at z = ±TOWER_Z. */
export const TOWER_Z = 4.6;
/** Top of the tower and the top truss (m). */
export const TOWER_TOP = 28.2;
/** Bottom chord of the top truss that hangs the upper curl (m). */
const TOP_CHORD_LOW = 25.8;
/** Where the top truss cantilever ends, just past the lip (world x). */
const TOP_TIP_X = 1.0;
/** Concrete apron in front of the base: x from -APRON_LENGTH to 0, |z| ≤ APRON_HALF_WIDTH. */
export const APRON_LENGTH = 14;
export const APRON_HALF_WIDTH = 5.4;

const HALF = CURL_WIDTH / 2;
/** Edge LEDs: the venue's LED red with a narrower, dimmer halo than the runway's. */
const EDGE_LED: LedLineOptions = {
  color: GLOW.ledStrip,
  width: 0.07,
  minPixels: 1.5,
  nearScale: 0.75,
  nearDistance: 8,
  farDistance: 50,
  halo: {
    width: 0.4,
    minPixels: 5,
    color: GLOW.ledHalo.clone().multiplyScalar(0.6),
  },
};

export interface CurlOptions {
  /**
   * Emissive "up-light" wash on the riding surface so it reads bright like the
   * photos even away from real lights. Default neutral white.
   */
  wash?: THREE.ColorRepresentation;
  /** Strength of the wash (default 0.4). */
  washIntensity?: number;
}

interface Frame {
  s: number;
  x: number;
  y: number;
  /** Unit tangent (along the ride) and normal (toward the free side). */
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

function frames(step: number): Frame[] {
  const p = backflipLevel.profile;
  return p.samples(step, p.rampStart, p.length).map((q: ProfileSample) => ({
    s: q.s - p.rampStart,
    x: q.x,
    y: q.y,
    tx: Math.cos(q.angle),
    ty: Math.sin(q.angle),
    nx: -Math.sin(q.angle),
    ny: Math.cos(q.angle),
  }));
}

interface GridVertex {
  p: [number, number, number];
  n: [number, number, number];
  uv?: [number, number];
}

/**
 * Indexed grid over (row i along the curl, column j); `vertex` fills each vertex.
 * Triangles are wound so that (row, column) increasing toward (+along, +column)
 * faces along `along × column`; `flip` reverses them.
 */
function grid(
  rows: number,
  cols: number,
  vertex: (i: number, j: number) => GridVertex,
  flip: boolean
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = vertex(i, j);
      positions.push(...v.p);
      normals.push(...v.n);
      uvs.push(...(v.uv ?? [0, 0]));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + j + 1;
      const d = i * cols + j + 1;
      if (flip) indices.push(a, b, c, a, c, d);
      else indices.push(a, d, c, a, c, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The riding surface: exactly the profile, |z| ≤ CURL_WIDTH / 2, normals toward the free side. */
function ridingSurface(f: Frame[], columns: number): THREE.BufferGeometry {
  return grid(
    f.length,
    columns + 1,
    (i, j) => {
      const q = f[i];
      const z = -HALF + (CURL_WIDTH * j) / columns;
      return {
        p: [q.x, q.y, z],
        n: [q.nx, q.ny, 0],
        uv: [q.s / CONCRETE_TILE, (z + HALF) / CURL_WIDTH],
      };
    },
    false
  );
}

/** Back face and both side faces of the shell plus the end cap at the lip. */
function shell(f: Frame[]): THREE.BufferGeometry {
  const back = grid(
    f.length,
    2,
    (i, j) => {
      const q = f[i];
      return {
        p: [q.x - q.nx * CURL_SHELL, q.y - q.ny * CURL_SHELL, j ? HALF : -HALF],
        n: [-q.nx, -q.ny, 0],
      };
    },
    true
  );
  const side = (sign: 1 | -1) =>
    grid(
      f.length,
      2,
      (i, j) => {
        const q = f[i];
        const d = j * CURL_SHELL;
        return {
          p: [q.x - q.nx * d, q.y - q.ny * d, sign * HALF],
          n: [0, 0, sign],
        };
      },
      sign < 0
    );
  const lip = f[f.length - 1];
  const cap = grid(
    2,
    2,
    (i, j) => ({
      p: [
        lip.x - lip.nx * CURL_SHELL * i,
        lip.y - lip.ny * CURL_SHELL * i,
        j ? HALF : -HALF,
      ],
      n: [lip.tx, lip.ty, 0],
    }),
    false
  );
  const parts = [back, side(1), side(-1), cap];
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** LED strip polylines along both edges of the riding surface, just proud of it. */
function edgeLines(f: Frame[]): THREE.Vector3[][] {
  return [1, -1].map((sign) =>
    f.map(
      (q) =>
        new THREE.Vector3(
          q.x + q.nx * 0.03,
          q.y + q.ny * 0.03,
          sign * (HALF - 0.02)
        )
    )
  );
}

/** Point on the shell's back face at a profile frame. */
function backPoint(q: Frame): [number, number] {
  return [q.x - q.nx * CURL_SHELL, q.y - q.ny * CURL_SHELL];
}

/**
 * Back-face point where `key` (0 = x, 1 = y) reaches `value`, searching the
 * lower (angle < 90°) or upper part of the curl. Null when out of range.
 */
function backWhere(
  f: Frame[],
  upper: boolean,
  key: 0 | 1,
  value: number
): [number, number] | null {
  for (let i = 0; i < f.length - 1; i++) {
    const isUpper = f[i].tx < 0;
    if (isUpper !== upper) continue;
    const a = backPoint(f[i]);
    const b = backPoint(f[i + 1]);
    const lo = Math.min(a[key], b[key]);
    const hi = Math.max(a[key], b[key]);
    if (value < lo || value > hi || hi === lo) continue;
    const t = (value - a[key]) / (b[key] - a[key]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return null;
}

/** Galvanized truss: tower, cantilevered top truss, hangers, struts and posts. */
function truss(f: Frame[], quality: Quality): MemberList {
  const m = new MemberList();
  const high = quality === "high";
  const COLUMN = 0.14;
  const BRACE = 0.05;
  const TIE = 0.075;
  const levels = 12;
  const dy = TOWER_TOP / levels;
  const zs = [-TOWER_Z, 0, TOWER_Z];
  const xs = [TOWER_X0, TOWER_X1];

  // Tower columns.
  for (const x of xs)
    for (const z of zs) m.add([x, 0, z], [x, TOWER_TOP, z], COLUMN);
  for (let l = 1; l <= levels; l++) {
    const y0 = (l - 1) * dy;
    const y1 = l * dy;
    // Side faces (z = ±TOWER_Z): ring beams and X-bracing — the lattice seen from the side.
    for (const z of [-TOWER_Z, TOWER_Z]) {
      m.add([TOWER_X0, y1, z], [TOWER_X1, y1, z], TIE);
      m.add([TOWER_X0, y0, z], [TOWER_X1, y1, z], BRACE);
      m.add([TOWER_X1, y0, z], [TOWER_X0, y1, z], BRACE);
    }
    // Front / back faces: beams across the width and alternating diagonals.
    for (const x of xs) {
      for (let k = 0; k < zs.length - 1; k++) {
        m.add([x, y1, zs[k]], [x, y1, zs[k + 1]], TIE);
        if (high || x === TOWER_X1) {
          const flipDiag = (l + k) % 2 === 0;
          m.add(
            [x, y0, flipDiag ? zs[k] : zs[k + 1]],
            [x, y1, flipDiag ? zs[k + 1] : zs[k]],
            BRACE
          );
        }
      }
    }
    if (high && l % 3 === 0) {
      // Plan bracing keeps the box square.
      m.add([TOWER_X0, y1, -TOWER_Z], [TOWER_X1, y1, 0], BRACE);
      m.add([TOWER_X0, y1, TOWER_Z], [TOWER_X1, y1, 0], BRACE);
    }
  }

  // Cantilevered top truss reaching back over the lip (two planes + cross ties).
  const panels = 5;
  const span = TOWER_X0 - TOP_TIP_X;
  const nodes: number[] = [];
  for (let k = 0; k <= panels; k++) nodes.push(TOP_TIP_X + (span * k) / panels);
  for (const z of [-TOWER_Z, TOWER_Z]) {
    m.add(
      [TOP_TIP_X, TOP_CHORD_LOW, z],
      [TOWER_X0, TOP_CHORD_LOW, z],
      COLUMN * 0.8
    );
    m.add([TOP_TIP_X, TOWER_TOP, z], [TOWER_X0, TOWER_TOP, z], COLUMN * 0.8);
    for (let k = 0; k < panels; k++) {
      const xa = nodes[k];
      const xb = nodes[k + 1];
      m.add([xa, TOP_CHORD_LOW, z], [xa, TOWER_TOP, z], TIE);
      if (k % 2 === 0) m.add([xa, TOWER_TOP, z], [xb, TOP_CHORD_LOW, z], BRACE);
      else m.add([xa, TOP_CHORD_LOW, z], [xb, TOWER_TOP, z], BRACE);
    }
  }
  for (const x of nodes.slice(0, -1)) {
    m.add([x, TOP_CHORD_LOW, -TOWER_Z], [x, TOP_CHORD_LOW, TOWER_Z], TIE);
    m.add([x, TOWER_TOP, -TOWER_Z], [x, TOWER_TOP, TOWER_Z], TIE);
  }
  if (high) {
    for (let k = 0; k < panels; k++) {
      const xa = nodes[k];
      const xb = nodes[k + 1];
      m.add([xa, TOWER_TOP, -TOWER_Z], [xb, TOWER_TOP, TOWER_Z], BRACE);
    }
  }

  // Attachment points on the back of the shell, inside the riding width.
  const attachZ = [-HALF + 0.7, HALF - 0.7];
  // Hangers from the top truss down to the upper curl.
  for (const x of nodes.slice(0, -1)) {
    const p = backWhere(f, true, 0, x);
    if (!p || p[1] > TOP_CHORD_LOW - 0.2) continue;
    for (const z of attachZ) {
      m.add([x, TOP_CHORD_LOW, z], [p[0], p[1], z], TIE);
      m.add(
        [x, TOP_CHORD_LOW, -TOWER_Z * Math.sign(-z)],
        [p[0], p[1], z],
        BRACE
      );
    }
  }
  // Horizontal struts from the tower's front face to the back of the curl.
  for (let l = 1; l < levels - 1; l++) {
    const y = l * dy;
    const upper = backWhere(f, true, 1, y);
    const lower = backWhere(f, false, 1, y);
    for (const p of [upper, lower]) {
      if (!p || p[0] > TOWER_X0 - 0.15) continue;
      for (const z of attachZ) {
        m.add([p[0], y, z], [TOWER_X0, y, z], TIE);
        // Knee brace down to the tower to stiffen the long upper struts.
        if (TOWER_X0 - p[0] > 2.5)
          m.add([p[0], y, z], [TOWER_X0, y - dy, z], BRACE);
      }
    }
  }
  // Posts under the lower curl.
  for (const x of [7.0, 8.2, 9.3, 10.2]) {
    const p = backWhere(f, false, 0, x);
    if (!p || p[1] < 0.6) continue;
    for (const z of attachZ) m.add([p[0], 0, z], [p[0], p[1], z], TIE);
  }
  return m;
}

/** Guy cables from the tower top to ground anchors behind it. */
function guyCables(): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const z of [-TOWER_Z, TOWER_Z]) {
    pts.push(TOWER_X1, TOWER_TOP, z, TOWER_X1 + 24, 0, z * 3.2);
    pts.push(TOWER_X1, TOWER_TOP * 0.66, z, TOWER_X1 + 18, 0, z * 2.4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** Flat concrete pad in front of the ramp base; texture continues the ramp's center line. */
function apron(): THREE.BufferGeometry {
  return grid(
    2,
    2,
    (i, j) => {
      const x = -APRON_LENGTH + APRON_LENGTH * i;
      const z = j ? APRON_HALF_WIDTH : -APRON_HALF_WIDTH;
      return {
        p: [x, 0.006, z],
        n: [0, 1, 0],
        uv: [x / CONCRETE_TILE, (z + HALF) / CURL_WIDTH],
      };
    },
    false
  );
}

/**
 * Builds the Curl (surface, shell, LED edges, apron, truss tower, cables).
 * Dispose with the scenery's traversal; all resources but the shared concrete
 * textures are owned by the group.
 */
export function buildCurl(
  quality: Quality,
  options: CurlOptions = {}
): THREE.Group {
  const high = quality === "high";
  const group = new THREE.Group();
  group.name = "curl";
  const f = frames(high ? 0.2 : 0.45);
  const tex = createConcreteTextures(quality);

  const concrete = new THREE.MeshStandardMaterial({
    color: PALETTE.rampSurface,
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    roughness: 1,
    metalness: 0,
    emissive: new THREE.Color(options.wash ?? 0xffffff),
    emissiveMap: tex.map,
    emissiveIntensity: options.washIntensity ?? 0.4,
  });
  if (tex.normalMap) {
    concrete.normalMap = tex.normalMap;
    concrete.normalScale.set(0.7, 0.7);
  }
  scaleEnvironment(concrete, 0.35);
  const surface = new THREE.Mesh(ridingSurface(f, high ? 8 : 2), concrete);
  surface.name = "curl-surface";
  surface.receiveShadow = high;

  const shellMat = scaleEnvironment(
    new THREE.MeshStandardMaterial({
      color: 0x2a2d32,
      roughness: 0.7,
      metalness: 0.25,
    }),
    0.3
  );
  const shellMesh = new THREE.Mesh(shell(f), shellMat);
  shellMesh.name = "curl-shell";

  const leds = createLedLines(edgeLines(f), EDGE_LED, "curl-leds");

  const apronMat = scaleEnvironment(concrete.clone(), 0.2);
  apronMat.emissiveIntensity = (options.washIntensity ?? 0.4) * 0.15;
  apronMat.color.multiplyScalar(0.85);
  apronMat.polygonOffset = true;
  apronMat.polygonOffsetFactor = -1;
  apronMat.polygonOffsetUnits = -1;
  const apronMesh = new THREE.Mesh(apron(), apronMat);
  apronMesh.name = "curl-apron";
  apronMesh.receiveShadow = high;

  const steel = scaleEnvironment(
    new THREE.MeshStandardMaterial({
      color: PALETTE.steel,
      metalness: 0.45,
      roughness: 0.5,
    }),
    0.5
  );
  const trussMesh = truss(f, quality).toMesh(steel, high ? 6 : 4, "curl-truss");

  const cables = new THREE.LineSegments(
    guyCables(),
    new THREE.LineBasicMaterial({ color: 0x2c2f35 })
  );
  cables.name = "curl-cables";

  group.add(surface, shellMesh, leds, apronMesh, trussMesh, cables);
  return group;
}

/** Points along the Curl's riding surface for aiming lights (world, backflip frame). */
export function curlPoint(fraction: number): Vec3Tuple {
  const p = backflipLevel.profile;
  const q = p.sample(p.rampStart + (p.length - p.rampStart) * fraction);
  return [q.x, q.y, 0];
}
