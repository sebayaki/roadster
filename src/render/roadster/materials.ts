import * as THREE from "three";
import type { Quality } from "@/core/types";
import { envScale } from "@/render/env-scale";
import { GLOW, PALETTE } from "@/render/palette";

/** Every material of the Roadster (one draw call each, wheels are instanced). */
export interface RoadsterMaterials {
  paint: THREE.Material;
  black: THREE.Material;
  gloss: THREE.Material;
  rings: THREE.Material;
  glass: THREE.Material;
  lamps: THREE.MeshBasicMaterial;
  tailBar: THREE.MeshBasicMaterial;
  interior: THREE.Material;
  nozzle: THREE.MeshBasicMaterial;
  tire: THREE.Material;
  disc: THREE.Material;
  spokes: THREE.Material;
  plate: THREE.MeshStandardMaterial;
}

/** Transmission tint and reflective coating of the Gold Glazed canopy (linear RGB). */
const GLASS_TINT = new THREE.Color(0.26, 0.185, 0.135);
const GLASS_COATING = new THREE.Color(0.32, 0.21, 0.12);

/**
 * envScale with caps: the shared RoomEnvironment has very bright panels that
 * would blow out glossy paint and bloom off mirror-like glass, and light glints
 * (scaled by `direct`) must not bloom into huge blobs either.
 */
function roadsterEnv<T extends THREE.MeshStandardMaterial>(
  material: T,
  diffuse: number,
  specular: number,
  direct = 1
): T {
  return envScale(material, diffuse, specular, {
    specularCap: 1.2,
    direct: { scale: direct, cap: 1 },
  });
}

/** Procedural "RDSTR" plate (white, condensed black letters). */
function plateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#e6e7e5";
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#2a2c30";
    g.lineWidth = 6;
    g.strokeRect(7, 7, 242, 114);
    g.fillStyle = "#1d1f23";
    g.font = 'bold 84px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.save();
    g.translate(128, 68);
    g.scale(0.82, 1);
    g.fillText("RDSTR", 0, 0);
    g.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createMaterials(quality: Quality): RoadsterMaterials {
  const high = quality === "high";
  const standard = (
    params: THREE.MeshStandardMaterialParameters,
    diffuse: number,
    specular: number
  ) => roadsterEnv(new THREE.MeshStandardMaterial(params), diffuse, specular);

  // Ano White: clear-coated satin white (plain standard material on phones).
  const paint = roadsterEnv(
    high
      ? new THREE.MeshPhysicalMaterial({
          color: PALETTE.anoWhite,
          metalness: 0.08,
          roughness: 0.42,
          clearcoat: 1,
          clearcoatRoughness: 0.28,
        })
      : new THREE.MeshStandardMaterial({
          color: PALETTE.anoWhite,
          metalness: 0.08,
          roughness: 0.28,
        }),
    0.55,
    0.3
  );
  // Gold Glazed canopy as coated, tinted glass: what is behind it (the white
  // interior, the night) is multiplied by a bronze tint and the coating adds
  // gold reflections with no diffuse term (result = behind * tint + reflection).
  const glass = roadsterEnv(
    new THREE.MeshStandardMaterial({
      color: GLASS_COATING,
      metalness: 1,
      roughness: 0.14,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.ConstantColorFactor,
    }),
    0,
    0.8,
    0.3
  );
  glass.blendColor.copy(GLASS_TINT);
  return {
    paint,
    glass,
    black: standard(
      { color: PALETTE.satinBlack, metalness: 0.15, roughness: 0.55 },
      0.6,
      0.4
    ),
    gloss: standard(
      { color: 0x08090b, metalness: 0.3, roughness: 0.16 },
      0.5,
      0.25
    ),
    rings: standard(
      { color: 0x5b5e63, metalness: 0.85, roughness: 0.35 },
      0.6,
      0.5
    ),
    lamps: new THREE.MeshBasicMaterial({ vertexColors: true }),
    tailBar: new THREE.MeshBasicMaterial({ color: GLOW.ledRed.clone() }),
    interior: standard(
      { vertexColors: true, metalness: 0, roughness: 0.75 },
      0.7,
      0.3
    ),
    nozzle: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    tire: standard(
      { color: 0x0f1012, metalness: 0, roughness: 0.88 },
      0.6,
      0.4
    ),
    disc: standard(
      { color: 0x8e9297, metalness: 0.45, roughness: 0.42 },
      0.6,
      0.45
    ),
    spokes: standard(
      { color: 0x0b0c0e, metalness: 0.45, roughness: 0.24 },
      0.6,
      0.35
    ),
    plate: standard(
      { map: plateTexture(), metalness: 0, roughness: 0.55 },
      0.6,
      0.4
    ),
  };
}

/** Disposes every material and the plate texture. */
export function disposeMaterials(m: RoadsterMaterials): void {
  m.plate.map?.dispose();
  for (const material of Object.values(m)) material.dispose();
}
