import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Obstacle, Quality } from "@/core/types";
import { envScale } from "../env-scale";
import { GLOW } from "../palette";

/** Spacing of the individual LEDs along the strips (m). */
const LED_PITCH = 0.07;
/** Depth of the red glow spilling onto the ground in front of each strip (m). */
const SPILL_DEPTH = 2.4;
/** The LED halo's red, much brighter right at the stage edge than the runway's spill. */
const SPILL_COLOR = GLOW.ledHalo.clone().multiplyScalar(2.2);

/** One LED per texel row: bright dot, dim gap (multiplies the HDR strip color). */
function ledTexture(length: number): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const v =
      0.14 + 0.86 * Math.exp(-(((i + 0.5 - size / 2) / (size * 0.2)) ** 2));
    data.set([v * 255, v * 255, v * 255, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, size, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(length / LED_PITCH, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Glow falloff away from the stage (v = 1 at the stage edge), soft at both ends (u). */
function spillTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const ends = Math.min(1, u / 0.08, (1 - u) / 0.08);
      const g = Math.pow(v, 2.4) * ends * ends;
      data.set([g * 255, g * 255, g * 255, 255], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The low black stage the lineup stands on: a glossy dark box sized from the
 * obstacle, red LED strips along the top of both long edges and a red glow
 * spilling onto the ground in front of them. Three draw calls.
 */
export function buildStage(o: Obstacle, quality: Quality): THREE.Group {
  const high = quality === "high";
  const group = new THREE.Group();
  group.name = o.id;
  group.position.set(o.x, o.baseY, o.z);
  group.rotation.y = o.yaw;

  // Build with the long axis on local x; turn the content if the stage is deeper than wide.
  const alongX = o.sizeX >= o.sizeZ;
  const length = alongX ? o.sizeX : o.sizeZ;
  const depth = alongX ? o.sizeZ : o.sizeX;
  const content = new THREE.Group();
  if (!alongX) content.rotation.y = Math.PI / 2;
  group.add(content);

  const topMaterial = envScale(
    high
      ? new THREE.MeshPhysicalMaterial({
          color: o.color,
          metalness: 0.1,
          roughness: 0.34,
          clearcoat: 0.7,
          clearcoatRoughness: 0.12,
        })
      : new THREE.MeshStandardMaterial({
          color: o.color,
          metalness: 0.1,
          roughness: 0.36,
        }),
    0.3,
    0.35
  );
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(length, o.sizeY, depth),
    topMaterial
  );
  body.name = "stage-body";
  body.position.y = o.sizeY / 2;
  body.receiveShadow = high;
  content.add(body);

  const strips = [-1, 1].map((side) =>
    new THREE.BoxGeometry(length - 0.03, 0.026, 0.014).translate(
      0,
      o.sizeY - 0.028,
      side * (depth / 2 + 0.003)
    )
  );
  const leds = new THREE.Mesh(
    mergeGeometries(strips),
    new THREE.MeshBasicMaterial({
      color: GLOW.ledStrip,
      map: ledTexture(length),
    })
  );
  leds.name = "stage-leds";
  content.add(leds);

  const spills = [-1, 1].map((side) =>
    new THREE.PlaneGeometry(length + 0.8, SPILL_DEPTH)
      .rotateX(-Math.PI / 2)
      .rotateY(side < 0 ? Math.PI : 0)
      .translate(0, 0.01, side * (depth / 2 + SPILL_DEPTH / 2))
  );
  const spill = new THREE.Mesh(
    mergeGeometries(spills),
    new THREE.MeshBasicMaterial({
      color: SPILL_COLOR,
      map: spillTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  spill.name = "stage-spill";
  spill.renderOrder = 1;
  content.add(spill);

  for (const g of [...strips, ...spills]) g.dispose();
  return group;
}
