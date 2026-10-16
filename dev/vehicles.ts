/**
 * Dev preview of the kickflip lineup (vehicles + stage) on a dark venue.
 *
 *   /dev/vehicles.html?view=front|three-quarter|side|top|chase
 *   /dev/vehicles.html?solo=<kind>&view=three-quarter|front|nose|side|rear|rear-three-quarter|top
 *   &clay=1 swaps the lit vehicle materials for neutral gray to judge the shapes.
 *
 * Logs per-vehicle triangle / draw-call counts, the measured size against the
 * obstacle box and how far any vertex pokes out of the physics collision polygon.
 */
import * as THREE from "three";
import type { Obstacle, Quality, VehicleKind } from "@/core/types";
import { kickflipLevel, OUTLINE_BASE } from "@/levels/kickflip";
import { GLOW, PALETTE } from "@/render/palette";
import { buildLineup, createVehicle } from "@/render/vehicles-model";
import { runHarness, type View } from "./harness";

const params = new URLSearchParams(location.search);
const obstacles = kickflipLevel.obstacles;
const solo = obstacles.find(
  (o) => o.kind !== "stage" && o.kind === params.get("solo")
);

const LINEUP_VIEWS: Record<string, View> = {
  front: { position: [0, 1.4, 24], target: [0, 3.0, 0], fov: 30 },
  "three-quarter": { position: [-16, 1.5, 10], target: [2, 1.7, 0], fov: 36 },
  side: { position: [21, 2.4, 9], target: [0, 1.8, 0], fov: 40 },
  top: { position: [0, 24, 10], target: [0, 0, 0], fov: 45 },
  chase: { position: [-40, 2.2, 0], target: [0, 1.8, 0], fov: 40 },
};

/** Close-up presets around a vehicle at the origin (+x = nose, +z = right side). */
function soloViews(o: Obstacle): Record<string, View> {
  const L = o.sizeZ;
  const H = o.sizeY;
  const d = Math.max(L, H * 1.8);
  const c: [number, number, number] = [0, H * 0.45, 0];
  return {
    "three-quarter": {
      position: [d * 0.75, H * 0.75 + 0.6, d * 0.8],
      target: c,
      fov: 40,
    },
    front: { position: [d * 1.25, H * 0.5 + 0.3, 0], target: c, fov: 40 },
    nose: {
      position: [L * 0.5 + 2.2, H * 0.55 + 0.5, 1.6],
      target: [L * 0.42, H * 0.4, 0],
      fov: 40,
    },
    side: { position: [0, H * 0.5 + 0.2, d * 1.3], target: c, fov: 40 },
    rear: { position: [-d * 1.25, H * 0.5 + 0.4, 0], target: c, fov: 40 },
    "rear-three-quarter": {
      position: [-d * 0.8, H * 0.8 + 0.6, -d * 0.75],
      target: c,
      fov: 40,
    },
    top: { position: [0.01, d * 1.5, 0.01], target: [0, 0, 0], fov: 40 },
  };
}

function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Night venue stand-in: asphalt, runway LED edges, spotlights, red-lit haze. */
function addVenue(scene: THREE.Scene, quality: Quality): void {
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.009);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.6 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const led = new THREE.MeshBasicMaterial({ color: GLOW.ledStrip });
  for (const z of [-6.5, 6.5]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(300, 0.04, 0.06), led);
    strip.position.set(0, 0.02, z);
    scene.add(strip);
  }

  const key = new THREE.SpotLight(0xffffff, 1100, 0, 0.36, 0.6, 2);
  key.position.set(-10, 18, 28);
  key.target.position.set(0, 1.6, 0);
  key.castShadow = quality === "high";
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.SpotLight(0xf2f4ff, 550, 0, 0.4, 0.7, 2);
  fill.position.set(15, 14, 24);
  fill.target.position.set(1, 1.4, 0);
  const back = new THREE.SpotLight(0x7f96ff, 260, 0, 0.35, 0.8, 2);
  back.position.set(12, 14, -22);
  back.target.position.set(0, 2.5, 0);
  const approach = new THREE.SpotLight(0xffffff, 700, 0, 0.3, 0.7, 2);
  approach.position.set(-30, 9, 6);
  approach.target.position.set(0, 1.4, 0);
  const red = new THREE.PointLight(0xff2010, 4, 12, 2);
  red.position.set(0, 0.5, 6);
  scene.add(key, key.target, fill, fill.target, back, back.target);
  scene.add(approach, approach.target, red);
  scene.add(new THREE.AmbientLight(0x8090a8, 0.06));

  const tex = glowTexture();
  const haze = (
    pos: [number, number, number],
    scale: [number, number],
    color: THREE.Color,
    opacity: number
  ) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color,
        opacity,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sprite.position.set(...pos);
    sprite.scale.set(scale[0], scale[1], 1);
    scene.add(sprite);
  };
  const redHaze = new THREE.Color(0.5, 0.03, 0.02);
  for (const x of [-12, 12]) haze([x, 0.8, 1], [12, 3], redHaze, 0.15);
  haze([10.5, 3.2, -3], [13, 9], new THREE.Color(0.5, 0.5, 0.56), 0.2);
  haze([-8.5, 2.6, -4], [5, 5], new THREE.Color(0.35, 0.35, 0.42), 0.12);
}

/** Console report: triangles, draw calls, size vs. obstacle box, collision polygon fit. */
function report(root: THREE.Object3D, list: Obstacle[]): void {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const o of list) {
    if (o.kind === "stage") continue;
    const node = root.getObjectByName(o.id) ?? root;
    let triangles = 0;
    let draws = 0;
    let worst = 0;
    const box = new THREE.Box3();
    node.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const geo = m.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute("position");
      triangles += (geo.index ? geo.index.count : pos.count) / 3;
      draws++;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        box.expandByPoint(v);
        // The polygon starts OUTLINE_BASE above the stand (1 mm slack).
        if (node !== root && v.y > o.baseY + OUTLINE_BASE + 0.001) {
          worst = Math.max(worst, outside(o.polygon, v.x, v.y));
        }
      }
    });
    const size = box.getSize(new THREE.Vector3());
    const fmt = (a: number, b: number, c: number) =>
      [a, b, c].map((n) => n.toFixed(3)).join("x");
    console.log(
      `${o.id}: triangles=${triangles} draws=${draws} ` +
        `size=${fmt(size.x, size.y, size.z)} obstacle=${fmt(o.sizeX, o.sizeY, o.sizeZ)} ` +
        `polygonOut=${worst.toFixed(3)}m`
    );
  }
}

/** Distance of (x, y) outside a convex counter-clockwise polygon (0 inside). */
function outside(poly: Array<[number, number]>, x: number, y: number): number {
  let d = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    // Outward normal of a CCW edge is (ey, -ex).
    d = Math.max(d, ((x - ax) * ey - (y - ay) * ex) / len);
  }
  return d;
}

/** ?clay=1: neutral gray material on every lit vehicle part, to judge the shapes. */
function showClay(root: THREE.Object3D): void {
  const clay = new THREE.MeshStandardMaterial({
    color: 0x8c8c8c,
    roughness: 0.55,
  });
  root.traverse((m) => {
    if (
      m instanceof THREE.Mesh &&
      !m.name.startsWith("stage") &&
      !(m.material instanceof THREE.MeshBasicMaterial)
    ) {
      m.material = clay;
    }
  });
}

void runHarness({
  views: solo ? soloViews(solo) : LINEUP_VIEWS,
  setup({ scene, quality }) {
    addVenue(scene, quality);
    if (solo) {
      const vehicle = createVehicle(
        solo.kind as VehicleKind,
        solo.color,
        quality
      );
      if (params.get("clay") === "1") showClay(vehicle);
      scene.add(vehicle);
      report(vehicle, [{ ...solo, x: 0, z: 0, baseY: 0, polygon: [] }]);
      return;
    }
    const start = performance.now();
    const lineup = buildLineup(obstacles, quality);
    console.log(
      `buildLineup(${quality}): ${(performance.now() - start).toFixed(1)} ms`
    );
    if (params.get("clay") === "1") showClay(lineup);
    scene.add(lineup);
    report(lineup, obstacles);
  },
});
