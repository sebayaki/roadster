import * as THREE from "three";
import type { Quality, ThrusterLevels } from "@/core/types";
import { CAR, NOZZLE_POSITIONS, WHEEL_CENTERS } from "@/core/car-spec";
import { clamp } from "@/core/math";
import { GLOW } from "./palette";
import { buildBody } from "./roadster/body";
import {
  createMaterials,
  disposeMaterials,
  type RoadsterMaterials,
} from "./roadster/materials";
import { X_NOSE } from "./roadster/shape";
import { buildWheel } from "./roadster/wheel";

export interface RoadsterVisualState {
  /** Accumulated wheel rotation (rad). */
  wheelSpin: number;
  /** Body heave -1..1 (+ = compressed). */
  suspension: number;
  /** Brake 0..1 (tail light bar boost). */
  brake: number;
  /** Jet intensities FL, FR, RL, RR (nozzle glow; plumes are drawn by FxSystem). */
  thrusters: ThrusterLevels;
  /** Signed speed (m/s). */
  speed: number;
}

/** Body drop (m) at full suspension compression. */
const HEAVE = 0.05;
/** Tail bar brightness (x GLOW.ledRed): running light and full brake. */
const TAIL_IDLE = 0.55;
const TAIL_BRAKE = 1.3;
/** Nozzle disc color when idle and at full jet. */
const NOZZLE_OFF = new THREE.Color(0.018, 0.02, 0.024);
const NOZZLE_ON = GLOW.jet.clone().multiplyScalar(1.6);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Procedural model of the new Roadster.
 * Frame: origin at the center of mass, +x forward, +y up, +z right (core/car-spec.ts).
 */
export class RoadsterModel {
  readonly root = new THREE.Group();
  /** Jet anchors FL, FR, RL, RR at NOZZLE_POSITIONS. Each anchor's local -y points along its jet. */
  readonly nozzles: readonly THREE.Object3D[];
  /** Wheel anchors FL, FR, RL, RR at WHEEL_CENTERS (the tire contact patch is wheelRadius below). */
  readonly wheels: readonly THREE.Object3D[];

  /** Everything that heaves with the suspension (the wheels stay put). */
  private readonly body = new THREE.Group();
  private readonly materials: RoadsterMaterials;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly wheelMeshes: THREE.InstancedMesh[] = [];
  private readonly nozzleGlow: THREE.InstancedMesh;
  private readonly headlight: THREE.SpotLight | null = null;

  private readonly matrix = new THREE.Matrix4();
  private readonly spin = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly flip = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI
  );
  private readonly position = new THREE.Vector3();
  private readonly unit = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color();

  constructor(quality: Quality) {
    const high = quality === "high";
    this.root.name = "roadster";
    this.body.name = "roadster-body";
    this.root.add(this.body);
    this.materials = createMaterials(quality);
    const m = this.materials;

    const g = buildBody(high);
    const mesh = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      cast: boolean,
      receive: boolean
    ) => {
      this.geometries.push(geometry);
      const out = new THREE.Mesh(geometry, material);
      out.castShadow = cast;
      out.receiveShadow = receive;
      this.body.add(out);
    };
    mesh(g.paint, m.paint, true, true);
    mesh(g.black, m.black, true, true);
    mesh(g.gloss, m.gloss, true, true);
    mesh(g.rings, m.rings, false, false);
    mesh(g.interior, m.interior, false, false);
    mesh(g.lamps, m.lamps, false, false);
    mesh(g.tailBar, m.tailBar, false, false);
    mesh(g.plate, m.plate, false, true);
    // Transparent: drawn after the opaque parts, depth-sorted with other transparents.
    mesh(g.glass, m.glass, true, false);

    this.geometries.push(g.nozzleDisc);
    this.nozzleGlow = new THREE.InstancedMesh(g.nozzleDisc, m.nozzle, 4);
    this.nozzleGlow.name = "roadster-nozzles";
    NOZZLE_POSITIONS.forEach(([x, , z], i) => {
      this.matrix.makeTranslation(x, g.nozzleDiscY[i], z);
      this.nozzleGlow.setMatrixAt(i, this.matrix);
      this.nozzleGlow.setColorAt(i, NOZZLE_OFF);
    });
    this.body.add(this.nozzleGlow);

    const w = buildWheel(high);
    for (const [geometry, material] of [
      [w.tire, m.tire],
      [w.disc, m.disc],
      [w.spokes, m.spokes],
    ] as const) {
      this.geometries.push(geometry);
      const wheel = new THREE.InstancedMesh(geometry, material, 4);
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      this.wheelMeshes.push(wheel);
      this.root.add(wheel);
    }

    if (high) {
      // One forward headlight pool (no shadow); the light bar itself is emissive.
      const light = new THREE.SpotLight(0xf1f4ff, 40, 45, 0.42, 0.7, 2);
      light.position.set(X_NOSE, 0.43 - CAR.comHeight, 0);
      light.target.position.set(X_NOSE + 12, -CAR.comHeight, 0);
      light.castShadow = false;
      this.body.add(light, light.target);
      this.headlight = light;
    }

    this.nozzles = NOZZLE_POSITIONS.map(([x, y, z], i) => {
      const anchor = new THREE.Object3D();
      anchor.name = `nozzle-${i}`;
      anchor.position.set(x, y, z);
      this.root.add(anchor);
      return anchor;
    });
    this.wheels = WHEEL_CENTERS.map(([x, y, z], i) => {
      const anchor = new THREE.Object3D();
      anchor.name = `wheel-${i}`;
      anchor.position.set(x, y, z);
      this.root.add(anchor);
      return anchor;
    });

    this.update(0, {
      wheelSpin: 0,
      suspension: 0,
      brake: 0,
      thrusters: [0, 0, 0, 0],
      speed: 0,
    });
    for (const wheel of this.wheelMeshes) wheel.computeBoundingSphere();
    this.nozzleGlow.computeBoundingSphere();
  }

  /** Per frame: body heave, wheel spin, tail bar brightness and nozzle glow. */
  update(_dt: number, state: RoadsterVisualState): void {
    this.body.position.y = -HEAVE * clamp(state.suspension, -1, 1);

    // Rolling forward (+x) turns the wheels about local z by -wheelSpin.
    this.spin.setFromAxisAngle(Z_AXIS, -state.wheelSpin);
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = WHEEL_CENTERS[i];
      this.position.set(x, y, z);
      // Left wheels are the right-hand mesh turned around so their face points out.
      if (z < 0) this.turn.multiplyQuaternions(this.spin, this.flip);
      else this.turn.copy(this.spin);
      this.matrix.compose(this.position, this.turn, this.unit);
      for (const wheel of this.wheelMeshes) wheel.setMatrixAt(i, this.matrix);
    }
    for (const wheel of this.wheelMeshes)
      wheel.instanceMatrix.needsUpdate = true;

    const brake = clamp(state.brake, 0, 1);
    this.materials.tailBar.color
      .copy(GLOW.ledRed)
      .multiplyScalar(TAIL_IDLE + TAIL_BRAKE * brake);

    for (let i = 0; i < 4; i++) {
      const t = clamp(state.thrusters[i], 0, 1);
      this.color.copy(NOZZLE_OFF).lerp(NOZZLE_ON, t);
      this.nozzleGlow.setColorAt(i, this.color);
    }
    if (this.nozzleGlow.instanceColor) {
      this.nozzleGlow.instanceColor.needsUpdate = true;
    }
  }

  /** Frees the GPU resources (geometries, materials, plate texture, instance buffers) and detaches the model. */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const wheel of this.wheelMeshes) wheel.dispose();
    this.nozzleGlow.dispose();
    this.headlight?.dispose();
    disposeMaterials(this.materials);
    this.root.removeFromParent();
  }
}
