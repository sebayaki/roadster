import * as THREE from "three";
import type { Quality } from "@/core/types";
import { GLOW } from "../palette";
import {
  createGlowBillboards,
  createLightCones,
  type ConeSpec,
  type GlowSpec,
} from "./glow";
import type { LightPool } from "./materials";
import { instances, MemberList, type Vec3Tuple } from "./members";

/** A floodlight: a mast with a lamp cluster aimed at a point, plus its fake beam. */
export interface FloodlightSpec {
  /** Mast base on the ground. */
  x: number;
  z: number;
  /** Height of the lamp head center (m). */
  height: number;
  /** Aim point (world). */
  target: Vec3Tuple;
  /** Lamp grid (columns × rows). */
  cols: number;
  rows: number;
  /** Beam half-angle used for the fake cone and pool (rad). */
  spread?: number;
  /** Brightness of the haze cone (0 = no cone). */
  beam?: number;
  /** Relative brightness (≈ 0.1–0.3) of the fake light pool where the beam lands on the ground; 0 = none. */
  pool?: number;
  /** Lamp / beam tint (default cool white). */
  tint?: THREE.ColorRepresentation;
  /** Lamp size (m); small values make a low light bar. Default 0.62. */
  lamp?: number;
  /** A real spotlight in this fixture (lights the scene; see LightRig for the budget). */
  spot?: {
    /** Luminous intensity (cd). */
    intensity: number;
    /** Cone half-angle (rad). */
    angle: number;
    penumbra?: number;
    /** Kept on the low quality tier. */
    essential?: boolean;
  };
  /** Skipped on the low quality tier. */
  optional?: boolean;
}

const LAMP = 0.62;
const HEAD_DEPTH = 0.35;
const DEFAULT_TINT = 0xf2f6ff;
const DEFAULT_SPREAD = 0.22;
/** Ground irradiance of a pool with `pool: 1` (see LightPool). */
const POOL_IRRADIANCE = 20;

const usedOn = (specs: readonly FloodlightSpec[], quality: Quality) =>
  specs.filter((s) => quality === "high" || !s.optional);

/**
 * Where the fixtures' beams land on the ground, as fake light pools for the
 * ground shaders: an ellipse stretched along the beam's horizontal direction.
 */
export function floodlightPools(
  specs: readonly FloodlightSpec[],
  quality: Quality
): LightPool[] {
  const pools: LightPool[] = [];
  for (const f of usedOn(specs, quality)) {
    if (!f.pool) continue;
    const [tx, ty, tz] = f.target;
    const dx = tx - f.x;
    const dz = tz - f.z;
    const horiz = Math.hypot(dx, dz);
    const drop = Math.max(0.5, f.height - ty);
    const elevation = Math.atan2(drop, horiz);
    const radius =
      Math.tan(f.spread ?? DEFAULT_SPREAD) * Math.hypot(horiz, drop);
    pools.push({
      x: tx,
      z: tz,
      length: Math.min(
        radius / Math.max(0.25, Math.sin(elevation)),
        radius * 3
      ),
      width: radius,
      heading: Math.atan2(dz, dx),
      color: new THREE.Color(f.tint ?? DEFAULT_TINT).multiplyScalar(
        f.pool * POOL_IRRADIANCE
      ),
    });
  }
  return pools;
}

const tmpObj = new THREE.Object3D();
const tmpVec = new THREE.Vector3();

/**
 * Floodlight masts, lamp heads, glowing lamps, halos and haze cones for a
 * whole level: five draw calls regardless of the number of fixtures. Their
 * light pools on the ground are drawn by the ground shaders (floodlightPools).
 */
export function buildFloodlights(
  specs: readonly FloodlightSpec[],
  quality: Quality,
  glowTexture: THREE.Texture
): THREE.Group {
  const group = new THREE.Group();
  group.name = "floodlights";
  const masts = new MemberList();
  const heads: THREE.Matrix4[] = [];
  const lamps: THREE.Matrix4[] = [];
  const glows: GlowSpec[] = [];
  const cones: ConeSpec[] = [];
  const white = new THREE.Color();

  for (const f of usedOn(specs, quality)) {
    const tint = new THREE.Color(f.tint ?? DEFAULT_TINT);
    const head = new THREE.Vector3(f.x, f.height, f.z);
    const target = new THREE.Vector3(...f.target);
    const lamp = f.lamp ?? LAMP;
    const pitch = lamp * 1.26;
    const headW = f.cols * pitch + lamp * 0.26;
    const headH = f.rows * pitch + lamp * 0.26;
    const tall = f.height > 6;

    // Mast (and a cross arm under the head on tall towers).
    const mastTop = f.height - headH * 0.5;
    masts.add([f.x, 0, f.z], [f.x, mastTop, f.z], tall ? 0.22 : 0.08);
    if (!tall && f.height > 1.5) {
      // Short stand: three splayed legs.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        masts.add(
          [f.x + Math.cos(a) * 0.9, 0, f.z + Math.sin(a) * 0.9],
          [f.x, mastTop * 0.55, f.z],
          0.04
        );
      }
    }

    // Lamp head aimed at the target: local +z points along the beam.
    tmpObj.position.copy(head);
    tmpObj.lookAt(target);
    tmpObj.scale.set(headW, headH, HEAD_DEPTH);
    tmpObj.updateMatrix();
    heads.push(tmpObj.matrix.clone());
    const quat = tmpObj.quaternion;
    for (let c = 0; c < f.cols; c++) {
      for (let r = 0; r < f.rows; r++) {
        tmpVec
          .set(
            (c - (f.cols - 1) / 2) * pitch,
            (r - (f.rows - 1) / 2) * pitch,
            HEAD_DEPTH / 2 + 0.01
          )
          .applyQuaternion(quat)
          .add(head);
        const m = new THREE.Matrix4().compose(
          tmpVec,
          quat,
          new THREE.Vector3(lamp, lamp, 1)
        );
        lamps.push(m);
      }
    }

    // Halo: a faint wide glow plus a hot core that blooms, both only seen from the front.
    const aim = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const facing: Vec3Tuple = [aim.x, aim.y, aim.z];
    const front = aim.clone().multiplyScalar(0.6).add(head);
    const span = Math.max(headW, headH);
    glows.push({
      position: [front.x, front.y, front.z],
      size: span * 3.2,
      color: white.copy(tint).multiplyScalar(0.018).clone(),
      facing,
    });
    glows.push({
      position: [front.x, front.y, front.z],
      size: span * 1.15,
      color: white.copy(tint).multiplyScalar(0.55).clone(),
      facing,
    });

    const beam = f.beam ?? 0.03;
    if (beam > 0) {
      const length = head.distanceTo(target);
      cones.push({
        from: head.clone(),
        to: target.clone(),
        radiusFrom: span * 0.45,
        radiusTo: span * 0.45 + Math.tan(f.spread ?? DEFAULT_SPREAD) * length,
        color: tint.clone().multiplyScalar(beam),
      });
    }
  }

  const steel = new THREE.MeshStandardMaterial({
    color: 0x3a3e44,
    metalness: 0.6,
    roughness: 0.5,
  });
  group.add(masts.toMesh(steel, 8, "flood-masts"));
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x1b1d21,
    metalness: 0.4,
    roughness: 0.6,
  });
  group.add(
    instances(new THREE.BoxGeometry(1, 1, 1), headMat, heads, "flood-heads")
  );
  const lampMat = new THREE.MeshBasicMaterial({ color: GLOW.white });
  group.add(
    instances(new THREE.PlaneGeometry(1, 1), lampMat, lamps, "flood-lamps")
  );
  group.add(createGlowBillboards(glows, glowTexture, "flood-glows"));
  if (cones.length) {
    group.add(createLightCones(cones, quality === "high" ? 20 : 12));
  }
  return group;
}
