import * as THREE from "three";

/**
 * Fake volumetric lighting: camera-facing glow billboards (lamp halos, haze)
 * and translucent light cones. Both are additive, never write depth, and fade
 * to black in the fog (instead of to the fog color) so distant ones vanish.
 */

const FOG_FADE = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
`;

function additiveMaterial(
  params: THREE.ShaderMaterialParameters
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...params,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      params.uniforms ?? {},
    ]),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

export interface GlowSpec {
  position: readonly [number, number, number];
  /** Billboard edge length (m). */
  size: number;
  /** Linear RGB; values above ~1 bloom. */
  color: THREE.Color;
  /** Unit direction a lamp shines in: the glow fades out when seen from behind. Omit for omnidirectional haze. */
  facing?: readonly [number, number, number];
}

/** All glow billboards of a scene in one instanced draw call. */
export function createGlowBillboards(
  specs: readonly GlowSpec[],
  texture: THREE.Texture,
  name = "glows"
): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  geometry.setAttribute("uv", base.getAttribute("uv"));
  const offsets = new Float32Array(specs.length * 3);
  const sizes = new Float32Array(specs.length);
  const colors = new Float32Array(specs.length * 3);
  const facings = new Float32Array(specs.length * 3);
  specs.forEach((g, i) => {
    offsets.set(g.position, i * 3);
    sizes[i] = g.size;
    colors[i * 3] = g.color.r;
    colors[i * 3 + 1] = g.color.g;
    colors[i * 3 + 2] = g.color.b;
    if (g.facing) facings.set(g.facing, i * 3);
  });
  geometry.setAttribute(
    "aOffset",
    new THREE.InstancedBufferAttribute(offsets, 3)
  );
  geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute(
    "aColor",
    new THREE.InstancedBufferAttribute(colors, 3)
  );
  geometry.setAttribute(
    "aFacing",
    new THREE.InstancedBufferAttribute(facings, 3)
  );
  geometry.instanceCount = specs.length;

  const material = additiveMaterial({
    uniforms: { map: { value: texture } },
    vertexShader: /* glsl */ `
      attribute vec3 aOffset;
      attribute float aSize;
      attribute vec3 aColor;
      attribute vec3 aFacing;
      varying vec2 vUv;
      varying vec3 vColor;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(aOffset, 1.0);
        mvPosition.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv;
        // Lamps only glare toward where they point.
        float facing = 1.0;
        if (dot(aFacing, aFacing) > 0.25) {
          vec3 world = (modelMatrix * vec4(aOffset, 1.0)).xyz;
          vec3 toCamera = normalize(cameraPosition - world);
          facing = smoothstep(-0.15, 0.55, dot(toCamera, normalize(mat3(modelMatrix) * aFacing)));
        }
        vColor = aColor * facing;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vColor;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(map, vUv).a;
        gl_FragColor = vec4(vColor * a, 1.0);
        ${FOG_FADE}
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  // Instances are spread over the whole venue; the base quad's bounds are meaningless.
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  base.dispose();
  return mesh;
}

export interface ConeSpec {
  /** Lamp position (cone apex). */
  from: THREE.Vector3;
  /** Where the beam axis ends (usually on the ground). */
  to: THREE.Vector3;
  /** Radius at the lamp and at the far end (m). */
  radiusFrom: number;
  radiusTo: number;
  /** Linear RGB strength of the haze in the beam. */
  color: THREE.Color;
}

const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Translucent light beams in the haze, merged into one mesh. Brightest near
 * the lamp, fading along the beam and toward the silhouette edges.
 */
export function createLightCones(
  specs: readonly ConeSpec[],
  radialSegments = 18,
  name = "light-cones"
): THREE.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const dir = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const cone of specs) {
    dir.subVectors(cone.to, cone.from);
    const length = dir.length();
    dir.divideScalar(length);
    // Cone built along -y from the apex, then rotated onto the beam.
    const part = new THREE.CylinderGeometry(
      cone.radiusFrom,
      cone.radiusTo,
      length,
      radialSegments,
      1,
      true
    );
    part.translate(0, -length / 2, 0);
    quat.setFromUnitVectors(DOWN, dir);
    const pos = part.getAttribute("position") as THREE.BufferAttribute;
    const nor = part.getAttribute("normal") as THREE.BufferAttribute;
    const first = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      along.push(-v.y / length);
      v.applyQuaternion(quat).add(cone.from);
      n.fromBufferAttribute(nor, i).applyQuaternion(quat);
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
      colors.push(cone.color.r, cone.color.g, cone.color.b);
    }
    const idx = part.index;
    if (idx)
      for (let i = 0; i < idx.count; i++) indices.push(first + idx.getX(i));
    part.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const material = additiveMaterial({
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute vec3 aColor;
      varying float vAlong;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vView;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vAlong = aAlong;
        vColor = aColor;
        vNormal = normalize(normalMatrix * normal);
        vView = -mvPosition.xyz;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vView;
      #include <fog_pars_fragment>
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float edge = facing * facing;
        float t = clamp(vAlong, 0.0, 1.0);
        float fade = pow(1.0 - t, 1.6) * smoothstep(0.0, 0.04, t);
        gl_FragColor = vec4(vColor * edge * fade, 1.0);
        ${FOG_FADE}
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = 4;
  return mesh;
}
