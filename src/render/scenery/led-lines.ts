import * as THREE from "three";
import { FOG_FADE } from "./glow";

/**
 * LED strips drawn as camera-facing ribbons along polylines. Each ribbon keeps
 * a minimum on-screen width, so a 7 cm strip still reads as a crisp red line
 * 300 m away. Its intensity ramps up with distance from `nearScale` (close
 * strips are dimmed so they do not wash the frame red) and drops where the
 * ribbon is widened past its real width. A second, wider additive ribbon adds
 * a soft controlled halo.
 */

export interface LedLineOptions {
  /** Linear HDR color of the strip at full intensity. */
  color: THREE.Color;
  /** Real strip width (m). */
  width: number;
  /** Minimum on-screen width of the core (px). */
  minPixels?: number;
  /** Intensity multiplier for strips close to the camera (fades to 1 by `farDistance`). */
  nearScale?: number;
  nearDistance?: number;
  farDistance?: number;
  /** Lift the ribbon so its lower edge stays above the ground (ground strips). */
  lift?: boolean;
  /** Halo ribbon: width (m), minimum width (px) and linear color; omit for none. */
  halo?: { width: number; minPixels: number; color: THREE.Color };
}

/** Polylines (each at least two points) to ribbon geometry with tangents and side flags. */
function ribbonGeometry(
  lines: readonly THREE.Vector3[][]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const tangents: number[] = [];
  const sides: number[] = [];
  const indices: number[] = [];
  const t = new THREE.Vector3();
  for (const line of lines) {
    const first = positions.length / 3;
    for (let i = 0; i < line.length; i++) {
      const prev = line[Math.max(0, i - 1)];
      const next = line[Math.min(line.length - 1, i + 1)];
      t.subVectors(next, prev).normalize();
      for (const side of [-1, 1]) {
        positions.push(line[i].x, line[i].y, line[i].z);
        tangents.push(t.x, t.y, t.z);
        sides.push(side);
      }
    }
    for (let i = 0; i < line.length - 1; i++) {
      const a = first + i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute(
    "aTangent",
    new THREE.Float32BufferAttribute(tangents, 3)
  );
  geometry.setAttribute("aSide", new THREE.Float32BufferAttribute(sides, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  // Ribbons widen with distance; pad the bounds so culling never clips them.
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 4;
  return geometry;
}

const VERTEX = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  uniform float uWidth;
  uniform float uPixelScale;
  uniform float uLift;
  uniform vec3 uFade; // near scale, near distance, far distance
  varying float vAcross;
  varying float vIntensity;
  #include <fog_pars_vertex>
  void main() {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    float dist = distance(wp, cameraPosition);
    float w = max(uWidth, dist * uPixelScale);
    wp.y += 0.5 * w * uLift;
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 s = cross(t, normalize(cameraPosition - wp));
    float sl = length(s);
    s = sl > 1e-4 ? s / sl : vec3(0.0, 1.0, 0.0);
    wp += s * aSide * 0.5 * w;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vAcross = aSide;
    // Widened (far) ribbons are dimmed partly to keep their energy plausible.
    vIntensity = mix(uFade.x, 1.0, smoothstep(uFade.y, uFade.z, dist)) * sqrt(uWidth / w);
    #include <fog_vertex>
  }`;

const CORE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vIntensity;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(uColor * vIntensity, 1.0);
    #include <fog_fragment>
  }`;

const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAcross;
  varying float vIntensity;
  #include <fog_pars_fragment>
  void main() {
    float a = exp(-vAcross * vAcross * 5.0) - 0.0067;
    gl_FragColor = vec4(uColor * max(a, 0.0) * vIntensity, 1.0);
    ${FOG_FADE}
  }`;

const tmpSize = new THREE.Vector2();

function ribbonMaterial(
  fragmentShader: string,
  color: THREE.Color,
  width: number,
  minPixels: number,
  opts: LedLineOptions,
  additive: boolean
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: color.clone() },
        uWidth: { value: width },
        uPixelScale: { value: 0 },
        uLift: { value: opts.lift ? 1 : 0 },
        uFade: {
          value: new THREE.Vector3(
            opts.nearScale ?? 1,
            opts.nearDistance ?? 10,
            opts.farDistance ?? 60
          ),
        },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader,
    fog: true,
    side: THREE.DoubleSide,
    transparent: additive,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.userData.minPixels = minPixels;
  return material;
}

/** Keeps `uPixelScale` (world width per meter of distance for N pixels) in sync with the camera. */
function trackPixelScale(mesh: THREE.Mesh): void {
  mesh.onBeforeRender = (renderer, _scene, camera, _geometry, material) => {
    const shader = material as THREE.ShaderMaterial;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const target = renderer.getRenderTarget();
    const height = target
      ? target.height
      : renderer.getDrawingBufferSize(tmpSize).y;
    const perPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
      (camera.zoom * Math.max(1, height));
    shader.uniforms.uPixelScale.value = shader.userData.minPixels * perPixel;
  };
}

/** Builds LED ribbons (core + optional halo) along the given polylines. */
export function createLedLines(
  lines: readonly THREE.Vector3[][],
  opts: LedLineOptions,
  name = "led-lines"
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const geometry = ribbonGeometry(lines);
  const core = new THREE.Mesh(
    geometry,
    ribbonMaterial(
      CORE_FRAGMENT,
      opts.color,
      opts.width,
      opts.minPixels ?? 1.6,
      opts,
      false
    )
  );
  core.name = `${name}-core`;
  trackPixelScale(core);
  group.add(core);
  if (opts.halo) {
    const halo = new THREE.Mesh(
      geometry,
      ribbonMaterial(
        HALO_FRAGMENT,
        opts.halo.color,
        opts.halo.width,
        opts.halo.minPixels,
        { ...opts, nearScale: 1 },
        true
      )
    );
    halo.name = `${name}-halo`;
    halo.renderOrder = 3;
    trackPixelScale(halo);
    group.add(halo);
  }
  return group;
}

/** Splits a straight segment into points every `step` meters (so ribbon width is evaluated densely). */
export function subdivide(
  a: THREE.Vector3,
  b: THREE.Vector3,
  step: number
): THREE.Vector3[] {
  const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++)
    out.push(new THREE.Vector3().lerpVectors(a, b, i / n));
  return out;
}
