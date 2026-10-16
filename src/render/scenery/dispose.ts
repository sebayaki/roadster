import * as THREE from "three";
import { isSharedTexture } from "../textures";

/** Disposes `value` if it is a texture owned by one scenery (shared ones outlive it). */
function disposeTexture(value: unknown): void {
  if (value instanceof THREE.Texture && !isSharedTexture(value)) {
    value.dispose();
  }
}

function disposeMaterial(material: THREE.Material): void {
  Object.values(material).forEach(disposeTexture);
  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      disposeTexture(uniform.value);
    }
  }
  material.dispose();
}

/**
 * Releases every geometry, material and texture under `root`, except the
 * page-wide procedural textures of textures.ts (resources used by several
 * meshes are visited more than once; disposal is idempotent).
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
    if (obj instanceof THREE.InstancedMesh) obj.dispose();
  });
}
