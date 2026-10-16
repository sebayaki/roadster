/**
 * Social preview (og:image) scene: plays the real physics, autopilot and FX of
 * the backflip up to the moment the car hangs nose-down past the Curl's lip,
 * freezes it and frames it under the title overlay in og.html.
 * `npm run social` screenshots it at 1200×630 into public/og.jpg.
 *
 * URL params (besides the harness ones): ?at=<game seconds to freeze at>,
 * ?cam=x,y,z,tx,ty,tz,fov to try another framing.
 */
import { camParam, runHarness, type View } from "./harness";
import { backflipLevel } from "@/levels/backflip";
import { createAutopilot } from "@/physics/autopilot";
import { CarPhysics } from "@/physics/car-physics";
import { FxSystem } from "@/render/fx";
import { RoadsterModel } from "@/render/roadster-model";
import { buildScenery, type Scenery } from "@/render/scenery";

const params = new URLSearchParams(location.search);
/** Game time of the frozen moment (s): the car is vertical, nose down, jets firing. */
const stopAt = Number(params.get("at") ?? "10");
const SHOT: View = camParam(params) ?? {
  position: [-13, 21.5, 10.5],
  target: [-9.5, 24, 0],
  fov: 40,
};

let physics: CarPhysics;
let pilot: ReturnType<typeof createAutopilot>;
let roadster: RoadsterModel;
let fx: FxSystem;
let scenery: Scenery;
let simTime = 0;

void runHarness({
  views: { shot: SHOT },
  setup({ scene, quality }) {
    scenery = buildScenery(backflipLevel, quality);
    scene.add(scenery.root);
    scene.fog = scenery.fog;
    roadster = new RoadsterModel(quality);
    scene.add(roadster.root);
    fx = new FxSystem(scene, quality);
    physics = new CarPhysics(backflipLevel);
    pilot = createAutopilot(backflipLevel, "clean");
  },
  update(dt, time, { camera }) {
    if (simTime < stopAt) {
      const step = Math.min(dt, stopAt - simTime);
      physics.step(step, pilot(physics.car, step));
      physics.drainEvents();
      simTime += step;
      const { car } = physics;
      const { position: p, quaternion: q } = car;
      roadster.root.position.set(p.x, p.y, p.z);
      roadster.root.quaternion.set(q.x, q.y, q.z, q.w);
      roadster.root.updateMatrixWorld(true);
      roadster.update(step, car);
      fx.update(step, car, roadster, camera);
    }
    scenery.update(dt, time, physics.car.position);
  },
});
