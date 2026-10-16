import * as THREE from "three";
import type { Quality, Vec3 } from "@/core/types";
import type { Vec3Tuple } from "./members";

/** A real (lit, unshadowed) spotlight pooling light on a key area. */
export interface SpotSpec {
  position: Vec3Tuple;
  target: Vec3Tuple;
  /** Luminous intensity (cd); falloff is physically based (decay 2). */
  intensity: number;
  /** Cone half-angle (rad). */
  angle: number;
  penumbra?: number;
  color?: THREE.ColorRepresentation;
  /** Kept on the low quality tier (at most two essential spots). */
  essential?: boolean;
}

/**
 * The single shadow-casting light: a stage follow spot that keeps the car in
 * a soft pool of light and gives it a crisp contact shadow wherever it goes.
 */
export interface FollowSpec {
  /** Light position relative to the focus point (m). */
  offset: Vec3Tuple;
  intensity: number;
  /** Cone half-angle (rad): small, so the shadow frustum stays tight. */
  angle: number;
  penumbra?: number;
  color?: THREE.ColorRepresentation;
}

const SHADOW_MAP = 2048;

/**
 * Real lights of a level: the follow spot (shadows on high quality only) plus
 * a few static spotlights. Budget: high 1 + up to 4 spots (≤ 6 lights in the
 * scene), low 1 + up to 2 spots and no shadows.
 */
export class LightRig {
  readonly group = new THREE.Group();
  private readonly follow: THREE.SpotLight;
  private readonly offset: THREE.Vector3;

  constructor(
    follow: FollowSpec,
    spots: readonly SpotSpec[],
    quality: Quality
  ) {
    this.group.name = "lights";
    const high = quality === "high";
    this.offset = new THREE.Vector3(...follow.offset);
    this.follow = new THREE.SpotLight(
      follow.color ?? 0xffffff,
      follow.intensity,
      0,
      follow.angle,
      follow.penumbra ?? 0.55,
      2
    );
    this.follow.name = "follow-spot";
    if (high) {
      const distance = this.offset.length();
      const shadow = this.follow.shadow;
      this.follow.castShadow = true;
      shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
      shadow.camera.near = Math.max(1, distance * 0.35);
      // Reaches the ground below the car even when it flies high above it.
      shadow.camera.far = distance * 2.6;
      shadow.bias = -0.00015;
      shadow.normalBias = 0.02;
    }
    this.group.add(this.follow, this.follow.target);

    const kept = high
      ? spots.slice(0, 4)
      : spots.filter((s) => s.essential).slice(0, 2);
    for (const spec of kept) {
      const spot = new THREE.SpotLight(
        spec.color ?? 0xffffff,
        spec.intensity,
        0,
        spec.angle,
        spec.penumbra ?? 0.5,
        2
      );
      spot.name = "spot";
      spot.position.set(...spec.position);
      spot.target.position.set(...spec.target);
      this.group.add(spot, spot.target);
    }
    this.update({ x: 0, y: 0, z: 0 });
  }

  /** Keeps the follow spot (and its shadow frustum) aimed at `focus`. */
  update(focus: Vec3): void {
    this.follow.target.position.set(focus.x, focus.y, focus.z);
    this.follow.position.copy(this.follow.target.position).add(this.offset);
    this.follow.target.updateMatrixWorld();
  }

  dispose(): void {
    this.follow.shadow.dispose();
  }
}
