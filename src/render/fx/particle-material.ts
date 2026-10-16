import * as THREE from "three";

/**
 * "smoke": normal-blended, camera-facing puffs with a noisy sprite and fake
 * sphere lighting. "glow": additive capsules stretched along a streak vector
 * (sparks, jet cores, flashes).
 */
export type ParticleKind = "smoke" | "glow";

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

attribute vec4 iPosSize; // world position, diameter (m)
attribute vec4 iColor;   // linear rgb (HDR allowed), alpha / intensity

uniform float uViewportHeight;
uniform float uMinPixels;

varying vec4 vColor;
varying vec2 vQuad;
varying vec3 vWorldPos;

#ifdef GLOW
attribute vec3 iStreak; // head minus tail (m)
varying float vHalfLen;
#else
attribute vec2 iRot; // sprite rotation (rad), atlas tile 0..3
uniform vec3 uLightDir;
varying vec2 vTexUv;
varying vec3 vLight;
varying float vRadius;
#endif

void main() {
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 center = iPosSize.xyz;
  float radius = 0.5 * iPosSize.w;
  vColor = iColor;

  // Perspective size; far tiny particles keep a minimum on-screen width and
  // trade the extra area for opacity so they shimmer less.
  float depth = max(-(viewMatrix * vec4(center, 1.0)).z, 0.01);
  float pixels = radius * uViewportHeight * projectionMatrix[1][1] / depth;
  if (pixels < uMinPixels) {
    float grow = uMinPixels / max(pixels, 1e-3);
    radius *= grow;
    vColor.a /= grow;
  }

  vec2 corner = position.xy;
  vec3 world;
#ifdef GLOW
  // Capsule billboard: spans tail..head along the streak, faces the camera.
  vec3 tail = center - iStreak;
  vec3 toCam = normalize(cameraPosition - 0.5 * (center + tail));
  vec3 side = cross(iStreak, toCam);
  float sideLen = length(side);
  side = sideLen > 1e-6 ? side / sideLen : camRight;
  vec3 along = cross(toCam, side);
  float halfLen = 0.5 * max(dot(iStreak, along), 0.0);
  vec3 end = corner.x > 0.0 ? center : tail;
  // along × side points away from the camera: negate side to keep CCW winding.
  world = end + (along * corner.x - side * corner.y) * radius;
  vHalfLen = halfLen / radius;
  vQuad = vec2(corner.x * (vHalfLen + 1.0), corner.y);
#else
  world = center + (camRight * corner.x + camUp * corner.y) * radius;
  float c = cos(iRot.x);
  float s = sin(iRot.x);
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec2 tile = vec2(mod(iRot.y, 2.0), floor(iRot.y * 0.5));
  vTexUv = (tile + rotated * 0.5 + 0.5) * 0.5;
  vQuad = corner;
  vRadius = radius;
  vLight = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
#endif
  vWorldPos = world;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform float uSoftness;

varying vec4 vColor;
varying vec2 vQuad;
varying vec3 vWorldPos;

#ifdef GLOW
varying float vHalfLen;
#else
uniform sampler2D uSprite;
uniform float uShade;
varying vec2 vTexUv;
varying vec3 vLight;
varying float vRadius;
#endif

// Soft-particle fade against the known ground plane y = 0: distance from this
// fragment to the ground along the view ray.
float groundFade() {
  float drop = cameraPosition.y - vWorldPos.y;
  if (drop <= 1e-3) return 1.0;
  float behind = distance(cameraPosition, vWorldPos) * vWorldPos.y / drop;
  return smoothstep(0.0, uSoftness, behind);
}

void main() {
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec3 fogTint = fogColor;
#else
  float fogFactor = 0.0;
  vec3 fogTint = vec3(0.0);
#endif

#ifdef GLOW
  float d = length(vec2(max(abs(vQuad.x) - vHalfLen, 0.0), vQuad.y));
  if (d >= 1.0) discard;
  float falloff = 1.0 - d;
  falloff *= falloff;
  float headward = vHalfLen > 0.0
    ? clamp((vQuad.x + vHalfLen) / (2.0 * vHalfLen), 0.0, 1.0)
    : 1.0;
  float intensity = vColor.a * falloff * mix(0.12, 1.0, headward) * groundFade();
  gl_FragColor = vec4(vColor.rgb * intensity * (1.0 - fogFactor), 1.0);
#else
  float r2 = dot(vQuad, vQuad);
  if (r2 >= 1.0) discard;
  vec4 sprite = texture2D(uSprite, vTexUv);
  // Puffs resting on the ground thin out toward y = 0 instead of showing a cut line.
  float base = smoothstep(0.0, 0.15 + 0.12 * vRadius, vWorldPos.y);
  float alpha = vColor.a * sprite.r * groundFade() * base;
  if (alpha < 0.002) discard;
  // Fake volume: light a sphere bulging toward the camera, wrapped diffuse.
  vec3 normal = vec3(vQuad, sqrt(1.0 - r2));
  float lambert = clamp(dot(normal, vLight) * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = vColor.rgb * mix(uShade, 1.0, lambert) * (0.72 + 0.56 * sprite.g);
  gl_FragColor = vec4(mix(color, fogTint, fogFactor), alpha);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Uniforms shared by both particle kinds (only some are used by each). */
export interface ParticleUniforms {
  [name: string]: THREE.IUniform;
  uViewportHeight: THREE.IUniform<number>;
  uMinPixels: THREE.IUniform<number>;
  uSoftness: THREE.IUniform<number>;
  uSprite: THREE.IUniform<THREE.Texture | null>;
  uShade: THREE.IUniform<number>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
}

/**
 * Shader material for one particle system: depth test on, depth write off,
 * additive ("glow") or normal ("smoke") blending, scene fog aware.
 */
export function createParticleMaterial(
  kind: ParticleKind,
  sprite: THREE.Texture | null
): THREE.ShaderMaterial {
  const glow = kind === "glow";
  const uniforms: ParticleUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uViewportHeight: { value: 720 },
    uMinPixels: { value: glow ? 1.6 : 0 },
    uSoftness: { value: glow ? 0.15 : 0.6 },
    uSprite: { value: sprite },
    uShade: { value: 0.42 },
    // Key light from above, slightly toward the audience side (+z).
    uLightDir: { value: new THREE.Vector3(-0.25, 1, 0.45).normalize() },
  };
  return new THREE.ShaderMaterial({
    name: glow ? "fx-glow" : "fx-smoke",
    uniforms,
    vertexShader,
    fragmentShader,
    defines: glow ? { GLOW: "" } : {},
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
}
