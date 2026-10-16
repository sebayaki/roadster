import * as THREE from "three";
import type { Quality, VehicleKind } from "@/core/types";
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
 * Scales the image-based lighting of a lit material. The shared studio
 * environment (scene.environment) overrides envMapIntensity and is far brighter
 * than a night venue, so vehicles keep only a fraction of it and rely on the
 * venue's spotlights.
 */
export function envScale<T extends THREE.MeshStandardMaterial>(
  material: T,
  diffuse: number,
  specular: number
): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvDiffuse = { value: diffuse };
    shader.uniforms.uEnvSpecular = { value: specular };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "uniform float uEnvDiffuse;\nuniform float uEnvSpecular;\nvoid main() {"
      )
      .replace(
        "#include <lights_fragment_maps>",
        /* glsl */ `#include <lights_fragment_maps>
        #if defined( RE_IndirectDiffuse )
          iblIrradiance *= uEnvDiffuse;
        #endif
        #if defined( RE_IndirectSpecular )
          radiance *= uEnvSpecular;
          #ifdef USE_CLEARCOAT
            clearcoatRadiance *= uEnvSpecular;
          #endif
        #endif`
      );
  };
  material.customProgramCacheKey = () => "vehicle-env";
  return material;
}

/** Materials shared by a set of vehicles; only the paint differs per vehicle. */
export interface VehicleMaterials {
  /** Materials indexed by slot (see SLOT), with a new paint material for this vehicle. */
  forVehicle(kind: VehicleKind, color: number): THREE.Material[];
  dispose(): void;
}

export function createVehicleMaterials(quality: Quality): VehicleMaterials {
  const high = quality === "high";
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T): T => {
    owned.push(m);
    return m;
  };
  // Plain dielectric: a sharp clear coat on glass turns spotlight highlights into bloom glare.
  const glass = own(
    envScale(
      new THREE.MeshStandardMaterial({
        color: 0x07090c,
        metalness: 0.3,
        roughness: 0.4,
      }),
      0.3,
      0.3
    )
  );
  const trim = own(
    envScale(
      new THREE.MeshStandardMaterial({
        color: 0x0b0c0e,
        metalness: 0,
        roughness: 0.72,
      }),
      0.3,
      0.3
    )
  );
  const rim = own(
    envScale(
      new THREE.MeshStandardMaterial({
        color: 0xaeb3b9,
        metalness: 0.85,
        roughness: 0.3,
      }),
      0.35,
      0.5
    )
  );
  const light = own(new THREE.MeshBasicMaterial({ color: LAMP }));
  const tail = own(new THREE.MeshBasicMaterial({ color: TAIL }));
  const amber = own(new THREE.MeshBasicMaterial({ color: AMBER }));

  return {
    forVehicle(kind, color) {
      const f = FINISH[kind];
      const paint = own(
        envScale(
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
        )
      );
      const slots = [paint, glass, trim, rim, light, tail, amber];
      slots.forEach((m, i) => (m.name = `vehicle-${SLOT_NAMES[i]}`));
      return slots;
    },
    dispose() {
      for (const m of owned) m.dispose();
      owned.length = 0;
    },
  };
}
