import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Quality } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";
import { buildScenery } from "@/render/scenery";
import { isSharedTexture } from "@/render/textures";

const LEVELS = [backflipLevel, kickflipLevel];

/** Every geometry, material and texture referenced under `root`. */
function resources(root: THREE.Object3D) {
  const found = new Set<
    THREE.BufferGeometry | THREE.Material | THREE.Texture
  >();
  const addTexture = (value: unknown) => {
    if (value instanceof THREE.Texture) found.add(value);
  };
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    if (mesh.geometry) found.add(mesh.geometry);
    for (const material of [mesh.material ?? []].flat()) {
      found.add(material);
      Object.values(material).forEach(addTexture);
      if (material instanceof THREE.ShaderMaterial) {
        Object.values(material.uniforms).forEach((u) => addTexture(u.value));
      }
    }
  });
  return [...found];
}

const isShared = (x: unknown) =>
  x instanceof THREE.Texture && isSharedTexture(x);

describe("venue scenery", () => {
  it.each(["high", "low"] as Quality[])(
    "keeps the %s tier's real-light budget",
    (quality) => {
      for (const level of LEVELS) {
        const scenery = buildScenery(level, quality);
        const lights: THREE.Light[] = [];
        scenery.root.traverse((o) => {
          if (o instanceof THREE.Light) lights.push(o);
        });
        const shadows = lights.filter((l) => l.castShadow).length;
        // High: the follow spot + 4 spots, leaving one for the Roadster's headlight.
        expect(lights.length).toBeLessThanOrEqual(quality === "high" ? 5 : 3);
        expect(shadows).toBe(quality === "high" ? 1 : 0);
        scenery.dispose();
      }
    }
  );

  it("dispose frees its own resources but not the shared textures", () => {
    const [first, second] = LEVELS.map((l) => buildScenery(l, "low"));
    const parent = new THREE.Group().add(first.root);
    const owned = resources(first.root);
    const other = resources(second.root);
    const disposed = new Set<unknown>();
    for (const x of [...owned, ...other]) {
      x.addEventListener("dispose", () => disposed.add(x));
    }

    first.dispose();

    expect(parent.children).toHaveLength(0);
    expect(owned.some(isShared)).toBe(true);
    for (const x of owned) expect(disposed.has(x)).toBe(!isShared(x));
    // The other level's scenery shares the procedural textures: untouched.
    expect(other.some((x) => disposed.has(x))).toBe(false);
    second.dispose();
  });
});
