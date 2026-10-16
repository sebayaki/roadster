import * as THREE from "three";
import type { Quality, VehicleKind } from "@/core/types";
import { envScale } from "../env-scale";
import { GLOW } from "../palette";
import { SLOT_NAMES } from "./geometry";

interface Finish {
  metalness: number;
  roughness: number;
  /** 0 = no clear coat (bare metal). */
  clearcoat: number;
}

/** Paint character per vehicle; the color itself comes from the obstacle data. */
const FINISH: Readonly<Record<VehicleKind, Finish>> = {
  model3: { metalness: 0.55, roughness: 0.34, clearcoat: 1 },
  modelY: { metalness: 0.35, roughness: 0.32, clearcoat: 1 },
  semi: { metalness: 0.0, roughness: 0.34, clearcoat: 0.8 },
  cybertruck: { metalness: 0.7, roughness: 0.42, clearcoat: 0 },
  cybercab: { metalness: 0.62, roughness: 0.3, clearcoat: 1 },
};

/** Head lamps / light bars: blooms, but thin parked-car lamps must not veil the scene. */
const LAMP = GLOW.white.clone().multiplyScalar(0.5);
/** Tail light red: dimmer than the LED strips, still above the bloom threshold (Rec. 709 luma ≈ 1.08). */
const TAIL = new THREE.Color(4.6, 0.13, 0.1);
/** Amber marker lamps (Semi). */
const AMBER = new THREE.Color(2.6, 0.95, 0.1);

/**
 * Materials shared by a set of vehicles; only the paint differs per vehicle.
 * Lit ones keep only a fraction of the studio environment (envScale) and rely
 * on the venue's spotlights. Disposing the vehicle meshes frees them too.
 */
export interface VehicleMaterials {
  /** Materials indexed by slot (see SLOT), with a new paint material for this vehicle. */
  forVehicle(kind: VehicleKind, color: number): THREE.Material[];
}

export function createVehicleMaterials(quality: Quality): VehicleMaterials {
  const high = quality === "high";
  const standard = (
    params: THREE.MeshStandardMaterialParameters,
    diffuse: number,
    specular: number
  ) => envScale(new THREE.MeshStandardMaterial(params), diffuse, specular);
  // Plain dielectric: a sharp clear coat on glass turns spotlight highlights into bloom glare.
  const glass = standard(
    { color: 0x07090c, metalness: 0.3, roughness: 0.4 },
    0.3,
    0.3
  );
  const trim = standard(
    { color: 0x0b0c0e, metalness: 0, roughness: 0.72 },
    0.3,
    0.3
  );
  const rim = standard(
    { color: 0xaeb3b9, metalness: 0.85, roughness: 0.3 },
    0.35,
    0.5
  );
  const light = new THREE.MeshBasicMaterial({ color: LAMP });
  const tail = new THREE.MeshBasicMaterial({ color: TAIL });
  const amber = new THREE.MeshBasicMaterial({ color: AMBER });

  return {
    forVehicle(kind, color) {
      const f = FINISH[kind];
      const paint = envScale(
        high && f.clearcoat > 0
          ? new THREE.MeshPhysicalMaterial({
              color,
              metalness: f.metalness,
              roughness: f.roughness,
              clearcoat: f.clearcoat,
              // Not mirror-sharp: spotlight highlights stay small instead of blooming into glare.
              clearcoatRoughness: 0.3,
            })
          : new THREE.MeshStandardMaterial({
              color,
              metalness: f.metalness,
              roughness: f.roughness * (high ? 1 : 0.85),
            }),
        0.3,
        0.6
      );
      const slots = [paint, glass, trim, rim, light, tail, amber];
      slots.forEach((m, i) => (m.name = `vehicle-${SLOT_NAMES[i]}`));
      return slots;
    },
  };
}
