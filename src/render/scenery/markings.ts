import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Quality } from "@/core/types";
import { envScale } from "../env-scale";
import { GLOW, PALETTE } from "../palette";
import { createLedLines, subdivide, type LedLineOptions } from "./led-lines";
import { patchVenueMaterial, type LightPool } from "./materials";

/** Runway / barrier / stand LED strips: the glow comes from the additive halo ribbon. */
export const LED_STRIP: LedLineOptions = {
  color: GLOW.ledStrip,
  width: 0.07,
  minPixels: 1.7,
  nearScale: 0.7,
  nearDistance: 8,
  farDistance: 45,
  halo: {
    width: 0.7,
    minPixels: 7,
    color: GLOW.ledHalo,
  },
};

/** A straight stripe on the ground from (x0, z0) to (x1, z1). */
export interface Stripe {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Stripe width (m). */
  width: number;
}

/** Flat upward-facing quads for stripes at height y, merged. `u` runs across (0..1), `v` along (m). */
function stripeGeometry(
  stripes: readonly Stripe[],
  y: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const s of stripes) {
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    const len = Math.hypot(dx, dz) || 1;
    // Unit vector across the stripe, scaled to half its width.
    const ax = (-dz / len) * (s.width / 2);
    const az = (dx / len) * (s.width / 2);
    const first = positions.length / 3;
    positions.push(
      s.x0 - ax,
      y,
      s.z0 - az,
      s.x0 + ax,
      y,
      s.z0 + az,
      s.x1 + ax,
      y,
      s.z1 + az,
      s.x1 - ax,
      y,
      s.z1 - az
    );
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(0, 0, 1, 0, 1, len, 0, len);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
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

/** White painted lines (runway center line, start line, crossing lines), one mesh. */
export function buildPaint(
  stripes: readonly Stripe[],
  pools: readonly LightPool[],
  quality: Quality
): THREE.Mesh {
  const material = patchVenueMaterial(
    new THREE.MeshStandardMaterial({
      color: PALETTE.linePaint,
      roughness: 0.62,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    }),
    { envScale: 0.15, pools }
  );
  const mesh = new THREE.Mesh(stripeGeometry(stripes, 0.004), material);
  mesh.name = "paint";
  mesh.receiveShadow = quality === "high";
  return mesh;
}

/** Boxes of the given height along each stripe (stripe width = box width), merged. */
export function stripeBoxes(
  stripes: readonly Stripe[],
  height: number,
  y = 0
): THREE.BufferGeometry {
  const parts = stripes.map((s) => {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const box = new THREE.BoxGeometry(len, height, s.width);
    box.rotateY(-Math.atan2(s.z1 - s.z0, s.x1 - s.x0));
    box.translate((s.x0 + s.x1) / 2, y + height / 2, (s.z0 + s.z1) / 2);
    return box;
  });
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** Dark barrier walls along stripes with vertical red LED bars every `spacing` meters. */
export function buildBarriers(
  stripes: readonly Stripe[],
  quality: Quality,
  height = 2.4,
  spacing = 7
): THREE.Group {
  const group = new THREE.Group();
  group.name = "barriers";
  const walls = new THREE.Mesh(
    stripeBoxes(stripes, height),
    envScale(
      new THREE.MeshStandardMaterial({
        color: 0x1e2024,
        roughness: 0.8,
        metalness: 0.1,
      }),
      0.3
    )
  );
  walls.name = "barrier-walls";
  walls.receiveShadow = quality === "high";
  const bars: THREE.Vector3[][] = [];
  for (const s of stripes) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const ux = (s.x1 - s.x0) / len;
    const uz = (s.z1 - s.z0) / len;
    // Bars on the face toward the runway (z = 0).
    const side = Math.sign(-(s.z0 + s.z1)) || 1;
    const off = (s.width / 2 + 0.05) * side;
    for (let d = spacing / 2; d < len; d += spacing) {
      const x = s.x0 + ux * d - uz * off;
      const z = s.z0 + uz * d + ux * off;
      bars.push([
        new THREE.Vector3(x, 0.25, z),
        new THREE.Vector3(x, height - 0.2, z),
      ]);
    }
  }
  group.add(
    walls,
    createLedLines(bars, { ...LED_STRIP, width: 0.08 }, "barrier-leds")
  );
  return group;
}

/**
 * Continuous red LED strips at ground level (the stripes give their path and
 * bar width) plus the soft red spill they throw on the asphalt (additive gradient).
 */
export function buildLedStrips(
  stripes: readonly Stripe[],
  spillTexture: THREE.Texture,
  spillWidth = 3.2,
  spillColor: THREE.ColorRepresentation = GLOW.ledHalo
    .clone()
    .multiplyScalar(0.65)
): THREE.Group {
  const group = new THREE.Group();
  group.name = "led-strips";
  const lines = stripes.map((s) =>
    subdivide(
      new THREE.Vector3(s.x0, 0.03, s.z0),
      new THREE.Vector3(s.x1, 0.03, s.z1),
      4
    )
  );
  const bars = createLedLines(
    lines,
    { ...LED_STRIP, width: stripes[0]?.width ?? LED_STRIP.width, lift: true },
    "led-bars"
  );
  const spill = new THREE.Mesh(
    stripeGeometry(
      stripes.map((s) => ({ ...s, width: spillWidth })),
      0.02
    ),
    new THREE.MeshBasicMaterial({
      color: spillColor,
      map: spillTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    })
  );
  spill.name = "led-spill";
  spill.renderOrder = 2;
  group.add(bars, spill);
  return group;
}
