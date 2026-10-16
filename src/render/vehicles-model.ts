import * as THREE from "three";
import type { Obstacle, Quality, VehicleKind } from "@/core/types";
import { buildCybercab } from "./vehicles/cybercab";
import { buildCybertruck } from "./vehicles/cybertruck";
import { MeshBuilder } from "./vehicles/geometry";
import {
  createVehicleMaterials,
  type VehicleMaterials,
} from "./vehicles/materials";
import { buildModelY } from "./vehicles/model-y";
import { buildModel3 } from "./vehicles/model3";
import { buildSemi } from "./vehicles/semi";
import {
  type Envelope,
  polygonEnvelope,
  ruleEnvelope,
  VEHICLE_DIMS,
} from "./vehicles/specs";
import { buildStage } from "./vehicles/stage";

type Builder = (b: MeshBuilder, env: Envelope, quality: Quality) => void;

const BUILDERS: Record<VehicleKind, Builder> = {
  model3: buildModel3,
  modelY: buildModelY,
  semi: buildSemi,
  cybertruck: buildCybertruck,
  cybercab: buildCybercab,
};

/** Builds one vehicle at its nominal size: one mesh (draw call) per material. */
function assemble(
  kind: VehicleKind,
  color: number,
  quality: Quality,
  kit: VehicleMaterials,
  env: Envelope
): THREE.Group {
  const builder = new MeshBuilder();
  BUILDERS[kind](builder, env, quality);
  const group = new THREE.Group();
  group.name = kind;
  const shadows = quality === "high";
  for (const mesh of builder.build(kit.forVehicle(kind, color))) {
    const lit = !(mesh.material instanceof THREE.MeshBasicMaterial);
    mesh.castShadow = shadows && lit;
    mesh.receiveShadow = shadows && lit;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

/**
 * Low-poly but recognizable model of a parked vehicle.
 * Frame: origin on the ground under the vehicle's center, +x forward (nose), +y up, +z right.
 */
export function createVehicle(
  kind: VehicleKind,
  color: number,
  quality: Quality
): THREE.Group {
  return assemble(
    kind,
    color,
    quality,
    createVehicleMaterials(quality),
    ruleEnvelope(kind)
  );
}

/**
 * Places every obstacle (stage + vehicles) from level data: position (x, baseY, z), yaw, color.
 * Each vehicle is scaled to its obstacle box and kept inside its collision polygon.
 */
export function buildLineup(
  obstacles: Obstacle[],
  quality: Quality
): THREE.Group {
  const group = new THREE.Group();
  group.name = "lineup";
  const kit = createVehicleMaterials(quality);
  for (const o of obstacles) {
    const node =
      o.kind === "stage"
        ? buildStage(o, quality)
        : placeVehicle(o, o.kind, quality, kit);
    node.updateMatrix();
    node.matrixAutoUpdate = false;
    group.add(node);
  }
  return group;
}

function placeVehicle(
  o: Obstacle,
  kind: VehicleKind,
  quality: Quality,
  kit: VehicleMaterials
): THREE.Group {
  const dims = VEHICLE_DIMS[kind];
  // Obstacle sizes are world-axis aligned; a vehicle across the path has its length on z.
  const across = Math.abs(Math.sin(o.yaw)) > 0.5;
  const scaleX = (across ? o.sizeZ : o.sizeX) / dims.length;
  const scaleY = o.sizeY / dims.height;
  const scaleZ = (across ? o.sizeX : o.sizeZ) / dims.width;
  const env = polygonEnvelope(o, scaleY, scaleZ) ?? ruleEnvelope(kind);
  const vehicle = assemble(kind, o.color, quality, kit, env);
  vehicle.name = o.id;
  vehicle.position.set(o.x, o.baseY, o.z);
  vehicle.rotation.y = o.yaw;
  vehicle.scale.set(scaleX, scaleY, scaleZ);
  return vehicle;
}
