import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Quality } from "@/core/types";
import { createLedLines } from "./led-lines";
import { LED_STRIP } from "./markings";
import { scaleEnvironment } from "./materials";

/** A tiered audience stand: the long red-lit structure of the aerial shots. */
export interface GrandstandSpec {
  /** Center of the front edge on the ground. */
  x: number;
  z: number;
  /** Direction the seats look at: atan2(dz, dx) in the ground plane. */
  facing: number;
  /** Length of the front edge (m). */
  length: number;
  tiers: number;
}

const RISE = 0.75;
const TREAD = 1.3;
const BACK_WALL = 1.6;

/**
 * Stepped cross-section in the local (x, y) plane. The front edge is at x = 0
 * and the tiers climb toward -x, away from the direction the seats look at (+x).
 */
function section(tiers: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i < tiers; i++) {
    shape.lineTo(-i * TREAD, (i + 1) * RISE);
    shape.lineTo(-(i + 1) * TREAD, (i + 1) * RISE);
  }
  const back = -tiers * TREAD;
  shape.lineTo(back, tiers * RISE + BACK_WALL);
  shape.lineTo(back - 0.4, tiers * RISE + BACK_WALL);
  shape.lineTo(back - 0.4, 0);
  shape.lineTo(0, 0);
  return shape;
}

/**
 * Dark tiered stands with a red LED strip along every step nose. All stands of
 * a level share three draw calls (stands, LED cores, LED halos).
 */
export function buildGrandstands(
  specs: readonly GrandstandSpec[],
  quality: Quality
): THREE.Group {
  const group = new THREE.Group();
  group.name = "grandstands";
  if (!specs.length) return group;
  const parts: THREE.BufferGeometry[] = [];
  const lines: THREE.Vector3[][] = [];
  const toWorld = new THREE.Matrix4();
  for (const g of specs) {
    // Local +x (the view direction) → world (cos facing, sin facing) in x-z.
    toWorld.makeRotationY(-g.facing).setPosition(g.x, 0, g.z);
    const geometry = new THREE.ExtrudeGeometry(section(g.tiers), {
      depth: g.length,
      bevelEnabled: false,
    });
    geometry.translate(0, 0, -g.length / 2);
    geometry.applyMatrix4(toWorld);
    parts.push(geometry);

    const stride = quality === "high" ? 1 : 2;
    const segments = Math.max(2, Math.ceil(g.length / 8));
    for (let i = 0; i < g.tiers; i += stride) {
      const line: THREE.Vector3[] = [];
      for (let k = 0; k <= segments; k++) {
        line.push(
          new THREE.Vector3(
            -i * TREAD + 0.04,
            (i + 1) * RISE - 0.05,
            -g.length / 2 + (g.length * k) / segments
          ).applyMatrix4(toWorld)
        );
      }
      lines.push(line);
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  const stands = new THREE.Mesh(
    merged,
    scaleEnvironment(
      new THREE.MeshStandardMaterial({
        color: 0x17191d,
        roughness: 0.85,
        metalness: 0.1,
      }),
      0.25
    )
  );
  stands.name = "grandstand-stands";
  stands.receiveShadow = quality === "high";
  group.add(stands, createLedLines(lines, LED_STRIP, "grandstand-leds"));
  return group;
}
