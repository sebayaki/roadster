/**
 * Venue preview: `dev/scenery.html?level=backflip|kickflip&view=<name>`.
 * Views: overview, ramp-side, ramp-base, runway-chase, aerial, lineup-front,
 * lineup-chase, game-side, game-chase, or a custom one with
 * `?view=custom&pos=x,y,z&look=x,y,z&fov=deg`. `?focus=spawn|second|x,y,z`
 * picks what the follow spot tracks. `?stats=1` logs the scenery's draw calls /
 * triangles / lights.
 * White placeholder boxes (the Roadster's 4.45 × 1.12 × 2.0 m) give scale.
 */
import * as THREE from "three";
import { meshStats, runHarness, type View } from "./harness";
import { CAR } from "@/core/car-spec";
import type { LevelId, Vec3 } from "@/core/types";
import { getLevel } from "@/levels";
import { buildScenery, type Scenery } from "@/render/scenery";
import { placed, venueLayout, type Backdrop } from "@/render/scenery/layout";

const params = new URLSearchParams(location.search);
const levelId: LevelId =
  params.get("level") === "kickflip" ? "kickflip" : "backflip";
const level = getLevel(levelId);

/** Where the Curl and the lineup stand in this level (the other one is a backdrop). */
const home: Backdrop = { position: [0, 0, 0], yaw: 0 };
const { backdrop } = venueLayout(level);
const curlAt = levelId === "backflip" ? home : backdrop;
const lineupAt = levelId === "kickflip" ? home : backdrop;
const spawn = level.profile.sample(level.spawnS);

/** View given in a structure's own frame, moved to where that structure stands. */
function at(
  frame: Backdrop,
  position: [number, number, number],
  target: [number, number, number],
  fov: number
): View {
  return {
    position: placed(position, frame),
    target: placed(target, frame),
    fov,
  };
}

const views: Record<string, View> = {
  overview:
    levelId === "backflip"
      ? { position: [-95, 34, 88], target: [-20, 6, -8], fov: 50 }
      : { position: [-70, 26, 66], target: [6, 2, -12], fov: 50 },
  "ramp-side": at(curlAt, [-14, 3.5, 74], [-3, 12, 0], 36),
  "ramp-base": at(curlAt, [-17, 1.4, 0], [6, 7.5, 0], 38),
  "runway-chase": {
    position: [spawn.x - 10, 3.2, 0],
    target: [spawn.x + 30, 1.2, 0],
    fov: 55,
  },
  aerial: at(curlAt, [-88, 62, 74], [-22, 0, -8], 46),
  "lineup-front": at(lineupAt, [0, 2.2, 34], [0, 4.2, 0], 36),
  "lineup-chase": at(lineupAt, [-46, 2.3, 0], [0, 3.2, 0], 34),
  // In-game framings: backflip side view in the air, chase on the approach.
  "game-side": { position: [-8, 11, 55], target: [-6, 11, 0], fov: 55 },
  "game-chase": { position: [-40, 3.2, 0], target: [-20, 2, 0], fov: 55 },
};

const triple = (name: string): [number, number, number] | null => {
  const v = params.get(name)?.split(",").map(Number);
  return v && v.length === 3 && v.every(Number.isFinite)
    ? [v[0], v[1], v[2]]
    : null;
};
const customPos = triple("pos");
const customLook = triple("look");
if (customPos && customLook) {
  views.custom = {
    position: customPos,
    target: customLook,
    fov: Number(params.get("fov") ?? 45),
  };
}

/** A white car-sized box (onProfile rests it on the track). */
function placeholder(): THREE.Mesh {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(CAR.length, CAR.height, CAR.width),
    new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.35 })
  );
  box.castShadow = true;
  box.receiveShadow = true;
  return box;
}

/** Box resting on the profile at arc length s (tangent aligned). Returns the COM. */
function onProfile(box: THREE.Mesh, s: number): Vec3 {
  const q = level.profile.sample(s);
  const nx = -Math.sin(q.angle);
  const ny = Math.cos(q.angle);
  box.rotation.set(0, 0, q.angle);
  box.position.set(q.x + nx * (CAR.height / 2), q.y + ny * (CAR.height / 2), 0);
  return {
    x: q.x + nx * CAR.comHeight,
    y: q.y + ny * CAR.comHeight,
    z: 0,
  };
}

/** Worst case cost of the scenery (every object, regardless of the view frustum). */
function logStats(root: THREE.Object3D): void {
  const { calls, triangles } = meshStats(root);
  let lights = 0;
  let shadows = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Light) {
      lights++;
      if (o.castShadow) shadows++;
    }
  });
  console.log(
    `[stats] calls=${calls} triangles=${triangles} lights=${lights} shadowCasters=${shadows}`
  );
}

let scenery: Scenery | null = null;
const focus: Vec3 = { x: 0, y: 0, z: 0 };

void runHarness({
  views,
  setup(ctx) {
    scenery = buildScenery(level, ctx.quality);
    ctx.scene.add(scenery.root);
    ctx.scene.fog = scenery.fog;

    const spawnBox = placeholder();
    const spawnFocus = onProfile(spawnBox, level.spawnS);
    ctx.scene.add(spawnBox);

    const second = placeholder();
    let secondFocus: Vec3;
    if (levelId === "backflip") {
      secondFocus = onProfile(second, level.profile.rampStart + 17);
    } else {
      // Upside down high above the Semi, mid-roll, like the unveil photo.
      second.position.set(0, 9, 0);
      second.rotation.set(Math.PI, 0, 0);
      secondFocus = { x: 0, y: 9, z: 0 };
    }
    ctx.scene.add(second);

    const view = ctx.params.get("view") ?? "overview";
    const focusName =
      ctx.params.get("focus") ??
      (view === "runway-chase" || view === "overview" ? "spawn" : "second");
    const focusAt = triple("focus");
    Object.assign(
      focus,
      focusAt
        ? { x: focusAt[0], y: focusAt[1], z: focusAt[2] }
        : focusName === "spawn"
          ? spawnFocus
          : secondFocus
    );

    if (ctx.params.get("stats") === "1") logStats(scenery.root);
  },
  update(dt, time) {
    scenery?.update(dt, time, focus);
  },
});
