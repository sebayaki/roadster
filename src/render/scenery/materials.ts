import * as THREE from "three";
import { envScale } from "../env-scale";

/**
 * A fake floodlight pool on the ground: an ellipse of extra irradiance,
 * lit through the surface's own albedo so the asphalt texture shows through.
 */
export interface LightPool {
  /** Center on the ground (x, z). */
  x: number;
  z: number;
  /** Half extents along `heading` and across it (m). */
  length: number;
  width: number;
  /** Direction of the elongation in the ground plane: atan2(dz, dx). */
  heading: number;
  /** Irradiance at the center (linear RGB, same units as a light's color × intensity / d²). */
  color: THREE.Color;
}

export interface VenuePatch {
  /**
   * Multiplier for the image-based lighting from scene.environment (see
   * envScale): a night venue needs the dim studio environment much weaker on
   * asphalt and concrete than on car paint.
   */
  envScale: number;
  /** Floodlight pools lighting this surface (ground-level materials). */
  pools?: readonly LightPool[];
  /** Extra fragment shader rewrite (e.g. map tweaks). */
  fragment?: (source: string) => string;
  /** Program cache key; must be unique per distinct `fragment` rewrite. */
  key?: string;
}

/** Packs pools into uniform arrays: A = (center, along axis / length), B = (across axis / width). */
function poolUniforms(pools: readonly LightPool[]) {
  const a = pools.map(
    (p) =>
      new THREE.Vector4(
        p.x,
        p.z,
        Math.cos(p.heading) / p.length,
        Math.sin(p.heading) / p.length
      )
  );
  const b = pools.map(
    (p) =>
      new THREE.Vector2(
        -Math.sin(p.heading) / p.width,
        Math.cos(p.heading) / p.width
      )
  );
  return {
    uPoolA: { value: a },
    uPoolB: { value: b },
    uPoolColor: { value: pools.map((p) => p.color.clone()) },
  };
}

/** Scales a standard material's environment lighting and adds ground light pools. */
export function patchVenueMaterial<T extends THREE.MeshStandardMaterial>(
  material: T,
  patch: VenuePatch
): T {
  const pools = patch.pools ?? [];
  const count = pools.length;
  const uniforms = count ? poolUniforms(pools) : {};
  return envScale(material, patch.envScale, patch.envScale, {
    key: `venue:${patch.key ?? ""}:${count}`,
    extend(shader) {
      if (count) {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec2 vPoolXZ;\nvoid main() {")
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\nvPoolXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;"
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "void main() {",
            /* glsl */ `#define POOL_COUNT ${count}
            varying vec2 vPoolXZ;
            uniform vec4 uPoolA[POOL_COUNT];
            uniform vec2 uPoolB[POOL_COUNT];
            uniform vec3 uPoolColor[POOL_COUNT];
            void main() {`
          )
          .replace(
            "#include <lights_fragment_maps>",
            /* glsl */ `#include <lights_fragment_maps>
            #if defined( RE_IndirectDiffuse )
              for ( int i = 0; i < POOL_COUNT; i ++ ) {
                vec2 d = vPoolXZ - uPoolA[ i ].xy;
                float a = dot( d, uPoolA[ i ].zw );
                float b = dot( d, uPoolB[ i ] );
                float r2 = a * a + b * b;
                irradiance += uPoolColor[ i ] * exp( -2.6 * r2 ) * ( 1.0 - smoothstep( 0.55, 1.0, r2 ) );
              }
            #endif`
          );
      }
      if (patch.fragment) {
        shader.fragmentShader = patch.fragment(shader.fragmentShader);
      }
    },
  });
}
