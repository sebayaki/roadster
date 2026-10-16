import type * as THREE from "three";

/** Optional extras of envScale; all off by default. */
export interface EnvScaleOptions {
  /** Per-channel ceiling of the scaled environment reflections. */
  specularCap?: number;
  /** Multiplier and per-channel ceiling of the highlights of real lights. */
  direct?: { scale: number; cap: number };
  /** Further rewrites of the patched shader (extra uniforms, varyings, map tweaks). */
  extend?: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  /** Program cache key of `extend`: one per distinct rewrite. */
  key?: string;
}

/**
 * Scales the image-based lighting of a standard / physical material: the
 * environment's irradiance by `diffuse` and its reflections (clear coat
 * included) by `specular`. The shared studio environment (scene.environment)
 * is far brighter than a night venue and three.js ignores `envMapIntensity`
 * for it (it forces scene.environmentIntensity), so each surface keeps its own
 * fraction. The scales are uniforms: materials that differ only in them share
 * a program.
 */
export function envScale<T extends THREE.MeshStandardMaterial>(
  material: T,
  diffuse: number,
  specular = diffuse,
  { specularCap, direct, extend, key = "" }: EnvScaleOptions = {}
): T {
  const scaled = (radiance: string) =>
    specularCap === undefined
      ? `${radiance} *= uEnvSpecular;`
      : `${radiance} = min( ${radiance} * uEnvSpecular, vec3( ${specularCap} ) );`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvDiffuse = { value: diffuse };
    shader.uniforms.uEnvSpecular = { value: specular };
    let uniforms = "uniform float uEnvDiffuse;\nuniform float uEnvSpecular;";
    let source = shader.fragmentShader.replace(
      "#include <lights_fragment_maps>",
      /* glsl */ `#include <lights_fragment_maps>
      #if defined( RE_IndirectDiffuse )
        iblIrradiance *= uEnvDiffuse;
      #endif
      #if defined( RE_IndirectSpecular )
        ${scaled("radiance")}
        #ifdef USE_CLEARCOAT
          ${scaled("clearcoatRadiance")}
        #endif
      #endif`
    );
    if (direct) {
      shader.uniforms.uDirectSpecular = { value: direct.scale };
      uniforms += "\nuniform float uDirectSpecular;";
      source = source.replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        reflectedLight.directSpecular = min(
          reflectedLight.directSpecular * uDirectSpecular,
          vec3( ${direct.cap} )
        );`
      );
    }
    shader.fragmentShader = source.replace(
      "void main() {",
      `${uniforms}\nvoid main() {`
    );
    extend?.(shader);
  };
  const programKey = `env:${specularCap ?? ""}:${direct?.cap ?? ""}:${key}`;
  material.customProgramCacheKey = () => programKey;
  return material;
}
