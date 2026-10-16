/**
 * Roadster model preview in a dark studio like the press shots:
 * `dev/roadster.html?view=<name>`.
 *
 * Views: hero (low front 3/4, like the press shot), side, profile (long lens),
 * front34, rear34, press34 / pressrear (framed like the press shots), front, rear,
 * top, under, wheel, chase (in-game chase distance).
 * Params: `?thrust=1` fires all nozzles, `?spin=1` spins the wheels, `?brake=1`
 * lights the brake bar, `?susp=<-1..1>` heaves the body, `?lights=0` leaves only the
 * environment light, `?view=custom&cam=px,py,pz,tx,ty,tz,fov` sets any camera.
 * The model's draw calls and triangles are logged on load.
 */
import * as THREE from "three";
import { runHarness, type View } from "./harness";
import { CAR } from "@/core/car-spec";
import { GLOW } from "@/render/palette";
import {
  RoadsterModel,
  type RoadsterVisualState,
} from "@/render/roadster-model";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "hero";
const H = CAR.comHeight;

const views: Record<string, View> = {
  hero: { position: [5.6, 0.85, -4.3], target: [0.2, 0.45, 0], fov: 32 },
  side: { position: [0, 0.62, -10.5], target: [0.08, 0.55, 0], fov: 28 },
  /** Near-orthographic long-lens profile for overlaying the press shot. */
  profile: { position: [0.085, 0.56, -25], target: [0.085, 0.56, 0], fov: 7 },
  front34: { position: [6.2, 1.35, -5.2], target: [0.2, 0.5, 0], fov: 30 },
  /** Framed like the front three-quarter press shot (use a 1404x900 snapshot). */
  press34: {
    position: [5.54, 0.76, -4.04],
    target: [0.65, 0.77, -0.05],
    fov: 31.8,
  },
  /** Framed like the rear three-quarter press shot (use a 1601x960 snapshot). */
  pressrear: {
    position: [-6.09, 0.75, -6.0],
    target: [-2.07, 0.79, -1.74],
    fov: 24.2,
  },
  rear34: { position: [-6.4, 1.15, -4.6], target: [-0.3, 0.5, 0], fov: 30 },
  front: { position: [9, 0.75, 0], target: [0, 0.5, 0], fov: 22 },
  rear: { position: [-9, 0.85, 0], target: [0, 0.5, 0], fov: 22 },
  top: { position: [0, 11, 0.001], target: [0, 0, 0], fov: 28 },
  under: { position: [0.001, -9, 0], target: [0, 0.5, 0], fov: 30 },
  wheel: { position: [1.4, 0.4, -2.6], target: [1.36, 0.36, -0.86], fov: 30 },
  /** In-game chase camera distance (~10 m behind, 3.2 m up). */
  chase: { position: [-10, 3.2, -1.2], target: [8, 1.0, 0], fov: 55 },
};

const cam = (params.get("cam") ?? "").split(",").map(Number);
if (cam.length === 7 && cam.every(Number.isFinite)) {
  views.custom = {
    position: [cam[0], cam[1], cam[2]],
    target: [cam[3], cam[4], cam[5]],
    fov: cam[6],
  };
}

const state: RoadsterVisualState = {
  wheelSpin: 0,
  suspension: Number(params.get("susp") ?? 0),
  brake: params.get("brake") === "1" ? 1 : 0,
  thrusters: [0, 0, 0, 0],
  speed: 0,
};
if (params.get("thrust") === "1") state.thrusters = [1, 1, 1, 1];
const spin = params.get("spin") === "1";

let model: RoadsterModel | null = null;

/** Dark asphalt: fine gray noise with sparse lighter aggregate. */
function asphaltTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const image = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = 34 + Math.random() * 18 + (Math.random() < 0.05 ? 26 : 0);
      image.data.set([v, v, v + 2, 255], i * 4);
    }
    g.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(40, 40);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function logStats(root: THREE.Object3D): void {
  let calls = 0;
  let tris = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    const count = o instanceof THREE.InstancedMesh ? o.count : 1;
    calls += 1;
    tris += n * count;
  });
  console.log(`[roadster] draw calls ${calls}, triangles ${Math.round(tris)}`);
}

void runHarness({
  views,
  setup({ scene, quality }) {
    const high = quality === "high";

    // Dark asphalt studio floor.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: asphaltTexture(),
        roughness: 0.8,
        metalness: 0,
      })
    );
    floor.receiveShadow = true;
    floor.visible = view !== "under";
    // Keep the floor dark: the shared room environment would light it up.
    floor.material.envMap = scene.environment;
    floor.material.envMapIntensity = 0.05;
    scene.add(floor);

    // Big soft key overhead (slightly front-left, like the press shots), a low
    // fill from the camera side and a rim light from behind.
    const key = new THREE.SpotLight(0xffffff, 110, 0, 0.62, 1, 2);
    key.position.set(1.5, 10.5, -6.5);
    key.target.position.set(0.3, 0, -0.6);
    key.castShadow = high;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const fill = new THREE.SpotLight(0xdfe6ff, 22, 0, 0.7, 1, 2);
    fill.position.set(4, 3, -8);
    fill.target.position.set(0, 0.5, 0);
    scene.add(fill, fill.target);
    const rim = new THREE.SpotLight(0xffffff, 60, 0, 0.5, 1, 2);
    rim.position.set(-7, 6, 5);
    rim.target.position.set(0, 0.5, 0);
    scene.add(rim, rim.target);
    if (params.get("lights") === "0")
      key.visible = fill.visible = rim.visible = false;

    // A red LED strip on the floor behind the car.
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.03, 0.04),
      new THREE.MeshBasicMaterial({ color: GLOW.ledRed })
    );
    strip.position.set(0, 0.015, 9);
    scene.add(strip);

    model = new RoadsterModel(quality);
    model.root.position.y = view === "under" ? H + 1.5 : H;
    scene.add(model.root);
    model.update(0, state);
    model.root.updateMatrixWorld(true);
    logStats(model.root);
  },
  update(dt) {
    if (!model) return;
    if (spin) state.wheelSpin += dt * 6;
    model.update(dt, state);
  },
});
