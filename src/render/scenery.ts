import * as THREE from "three";
import type { LevelDef, Quality, Vec3 } from "@/core/types";
import { kickflipLevel } from "@/levels/kickflip";
import { createFog, createGround, createSky } from "./environment";
import { buildCurl } from "./ramp-model";
import { disposeObject } from "./scenery/dispose";
import { buildFloodlights, floodlightPools } from "./scenery/floodlights";
import { createGlowBillboards } from "./scenery/glow";
import { buildGrandstands } from "./scenery/grandstand";
import { spotsOf, venueLayout, type Backdrop } from "./scenery/layout";
import { LightRig } from "./scenery/lights";
import { buildBarriers, buildLedStrips, buildPaint } from "./scenery/markings";
import {
  createAsphaltTextures,
  createGlowTexture,
  createSpillTexture,
} from "./textures";
import { buildLineup } from "./vehicles-model";

/** Everything static (plus animated lights) around the car for one level. */
export interface Scenery {
  readonly root: THREE.Group;
  /** Scene fog to apply while this scenery is shown. */
  readonly fog: THREE.FogExp2;
  /**
   * Per frame. `focus` is the car's center of mass; the shadow-casting light
   * follows it so the car always has a crisp contact shadow.
   */
  update(dt: number, time: number, focus: Vec3): void;
  dispose(): void;
}

function placeBackdrop(
  object: THREE.Object3D,
  backdrop: Backdrop
): THREE.Object3D {
  object.position.set(...backdrop.position);
  object.rotation.y = backdrop.yaw;
  object.name = `backdrop-${object.name}`;
  return object;
}

/** Builds the night venue for a level: ground, runway, LED strips, floodlights, haze, the Curl or the lineup. */
export function buildScenery(level: LevelDef, quality: Quality): Scenery {
  const root = new THREE.Group();
  root.name = "scenery";
  const layout = venueLayout(level);

  const asphalt = createAsphaltTextures(quality);
  const glowTexture = createGlowTexture();
  const spillTexture = createSpillTexture();

  const pools = floodlightPools(layout.floodlights, quality);

  root.add(createSky());
  root.add(createGround(quality, asphalt, pools, ...layout.groundCenter));
  root.add(buildPaint(layout.paint, pools, quality));
  root.add(buildLedStrips(layout.leds, spillTexture));
  if (layout.barriers.length) root.add(buildBarriers(layout.barriers, quality));
  root.add(buildGrandstands(layout.grandstands, quality));
  root.add(buildFloodlights(layout.floodlights, quality, glowTexture));
  if (layout.haze.length) {
    root.add(createGlowBillboards(layout.haze, glowTexture, "haze"));
  }

  if (level.id === "backflip") {
    root.add(buildCurl(quality));
    root.add(
      placeBackdrop(
        buildLineup(kickflipLevel.obstacles, quality),
        layout.backdrop
      )
    );
  } else {
    root.add(buildLineup(level.obstacles, quality));
    root.add(
      placeBackdrop(
        buildCurl(quality, { wash: 0x6d8cff, washIntensity: 0.42 }),
        layout.backdrop
      )
    );
  }

  const lights = new LightRig(
    layout.follow,
    spotsOf(layout.floodlights),
    quality
  );
  root.add(lights.group);

  return {
    root,
    fog: createFog(),
    update(_dt: number, _time: number, focus: Vec3) {
      lights.update(focus);
    },
    dispose() {
      lights.dispose();
      disposeObject(root);
      root.removeFromParent();
    },
  };
}
