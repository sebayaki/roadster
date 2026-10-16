import * as THREE from "three";
import type { Quality } from "@/core/types";
import { PALETTE } from "./palette";
import { patchVenueMaterial, type LightPool } from "./scenery/materials";
import { ASPHALT_TILE, type SurfaceTextures } from "./textures";

/** Exponential fog density of the night venue (≈50% visibility at 190 m). */
export const FOG_DENSITY = 0.0044;

/** Dark blue-gray night fog. Distant ground fades into the sky dome's horizon color. */
export function createFog(): THREE.FogExp2 {
  return new THREE.FogExp2(PALETTE.fog, FOG_DENSITY);
}

const SKY_RADIUS = 1400;

/**
 * Near-black sky dome with a faint blue-gray haze glow just above the horizon.
 * Below the horizon it matches the fog color so the ground edge disappears.
 */
export function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(PALETTE.sky) },
      uHaze: { value: new THREE.Color(0x111620) },
      uHorizon: { value: new THREE.Color(PALETTE.fog) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pin to the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHaze;
      uniform vec3 uHorizon;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        // Haze band peaks a few degrees above the horizon, fades to the zenith.
        float band = exp(-max(h - 0.02, 0.0) * 9.0);
        vec3 c = mix(uTop, uHaze, band);
        c = mix(c, uHorizon, smoothstep(0.03, -0.01, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
    material
  );
  mesh.name = "sky";
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Big slightly glossy asphalt ground plane (y = 0) centered at (cx, cz), lit
 * by the floodlights' fake pools. The color map is sampled twice (tile + a
 * rotated macro scale) to hide tiling.
 */
export function createGround(
  quality: Quality,
  textures: SurfaceTextures,
  pools: readonly LightPool[],
  cx: number,
  cz: number,
  size = 2200
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  // World-aligned UVs: one texture tile every ASPHALT_TILE meters.
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      (pos.getX(i) + cx) / ASPHALT_TILE,
      -(pos.getZ(i) + cz) / ASPHALT_TILE
    );
  }
  const material = new THREE.MeshStandardMaterial({
    color: 0x6e7076,
    map: textures.map,
    roughnessMap: textures.roughnessMap,
    roughness: 1,
    metalness: 0,
  });
  if (textures.normalMap) {
    material.normalMap = textures.normalMap;
    material.normalScale.set(0.6, 0.6);
  }
  patchVenueMaterial(material, {
    envScale: 0.1,
    pools,
    key: "asphalt",
    fragment: (source) =>
      source.replace(
        "#include <map_fragment>",
        /* glsl */ `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec2 macroUv = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * 0.083;
          float macro = texture2D( map, macroUv ).r;
          sampledDiffuseColor.rgb *= 0.72 + macro * 0.45;
          diffuseColor *= sampledDiffuseColor;
        #endif`
      ),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ground";
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = quality === "high";
  return mesh;
}
