/**
 * App icon / favicon scene: the real Roadster model launching nose-up inside a
 * glowing red counter-clockwise light trail (the backflip). Rendered square;
 * `npm run social` screenshots it and scales it down to every icon size.
 *
 * URL params (besides the harness ones): ?cam=x,y,z,tx,ty,tz,fov to try another framing.
 */
import * as THREE from "three";
import { camParam, runHarness, type View } from "./harness";
import { CAR } from "@/core/car-spec";
import { RoadsterModel } from "@/render/roadster-model";

const SHOT: View = camParam(new URLSearchParams(location.search)) ?? {
  position: [6.2, 2.1, 7.4],
  target: [0.1, 0.2, 0],
  fov: 31,
};

/** Ring radius, tube radius at the head, and the swept angle of the trail. */
const RING = { radius: 2.2, tube: 0.2, arc: Math.PI * 1.5 };
/** Trail core red: bright enough to read, low enough that tone mapping keeps it red. */
const TRAIL_RED = new THREE.Color(1.25, 0.02, 0.03);
/** Additive glow around the core. */
const GLOW_RED = new THREE.Color(0.55, 0.01, 0.015);

/** Dark tile with a soft charcoal glow behind the car. */
function backdrop(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(
      size * 0.5,
      size * 0.46,
      0,
      size * 0.5,
      size * 0.5,
      size * 0.62
    );
    grad.addColorStop(0, "#2a2c33");
    grad.addColorStop(0.55, "#101116");
    grad.addColorStop(1, "#050507");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A ↺ light trail: a torus arc that starts thin and dim at the bottom, sweeps
 * counter-clockwise over the top and ends thick and bright at the left, where
 * an arrowhead points down along the motion.
 */
function trail(): THREE.Group {
  const geometry = new THREE.TorusGeometry(
    RING.radius,
    RING.tube,
    20,
    160,
    RING.arc
  );
  const pos = geometry.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let u = Math.atan2(v.y, v.x);
    if (u < 0) u += Math.PI * 2;
    const t = Math.min(1, u / RING.arc);
    center.set(Math.cos(u), Math.sin(u), 0).multiplyScalar(RING.radius);
    v.sub(center)
      .multiplyScalar(0.2 + 0.8 * Math.pow(t, 0.8))
      .add(center);
    pos.setXYZ(i, v.x, v.y, v.z);
    const k = 0.15 + 0.85 * t * t;
    colors.set([k, k, k], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: TRAIL_RED,
    vertexColors: true,
  });
  const ring = new THREE.Mesh(geometry, material);
  // Start at the bottom so the trail ends at the left (180°).
  ring.rotation.z = -Math.PI / 2;

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(RING.tube * 2.6, RING.tube * 4.2, 24),
    new THREE.MeshBasicMaterial({ color: TRAIL_RED })
  );
  // Cones point along +y; flip to point down (the counter-clockwise tangent at 180°).
  head.rotation.z = Math.PI;
  head.position.set(-RING.radius, -RING.tube * 1.6, 0);

  // Soft glow: a fatter, faint additive copy of the trail behind the core.
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(RING.radius, RING.tube * 2, 16, 120, RING.arc),
    new THREE.MeshBasicMaterial({
      color: GLOW_RED,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.rotation.z = -Math.PI / 2;
  glow.position.z = -0.3;

  const group = new THREE.Group();
  group.add(glow, ring, head);
  return group;
}

void runHarness({
  views: { shot: SHOT },
  setup({ scene }) {
    scene.background = backdrop();
    scene.fog = null;

    const key = new THREE.SpotLight(0xffffff, 140, 0, 0.6, 1, 2);
    key.position.set(2, 10, 7);
    key.target.position.set(0, 0.3, 0);
    const fill = new THREE.SpotLight(0xdfe6ff, 30, 0, 0.7, 1, 2);
    fill.position.set(6, 2, 8);
    fill.target.position.set(0, 0.3, 0);
    const rim = new THREE.SpotLight(0xffe2dc, 90, 0, 0.5, 1, 2);
    rim.position.set(-6, 5, -7);
    rim.target.position.set(0, 0.4, 0);
    scene.add(key, key.target, fill, fill.target, rim, rim.target);

    const car = new RoadsterModel("high");
    // Launching nose-up (the start of a backflip), centered in the ring.
    car.root.rotation.set(0, 0, THREE.MathUtils.degToRad(17), "ZXY");
    car.root.position.set(0.15, -CAR.comHeight * 0.2, 0);
    car.update(0, {
      wheelSpin: 0.9,
      suspension: 0,
      brake: 0,
      thrusters: [0, 0, 0, 0],
      speed: 0,
    });
    scene.add(car.root);

    // The trail faces the camera and sits just behind the car.
    const ring = trail();
    const toCamera = new THREE.Vector3(...SHOT.position)
      .sub(new THREE.Vector3(...SHOT.target))
      .normalize();
    ring.position.copy(toCamera).multiplyScalar(-1.4);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toCamera);
    scene.add(ring);
  },
});
