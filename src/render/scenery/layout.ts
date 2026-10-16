import * as THREE from "three";
import type { LevelDef } from "@/core/types";
import { CURL_WIDTH } from "@/levels/backflip";
import { APRON_LENGTH, curlPoint } from "../ramp-model";
import type { FloodlightSpec } from "./floodlights";
import type { GlowSpec } from "./glow";
import type { GrandstandSpec } from "./grandstand";
import type { FollowSpec, SpotSpec } from "./lights";
import type { Stripe } from "./markings";
import type { Vec3Tuple } from "./members";

/** Where the other stunt's structure stands as a backdrop. */
export interface Backdrop {
  position: Vec3Tuple;
  /** Rotation about +y (rad). */
  yaw: number;
}

/** Everything placed around one level's runway. */
export interface VenueLayout {
  /** Ground plane center (x, z). */
  groundCenter: [number, number];
  paint: Stripe[];
  /** Red LED strips along the runway edges. */
  leds: Stripe[];
  /** Light fixtures; some carry one of the level's real spotlights. */
  floodlights: FloodlightSpec[];
  /** The car's follow spot (the only shadow caster). */
  follow: FollowSpec;
  /** Faint haze puffs (additive billboards). */
  haze: GlowSpec[];
  /** Barrier walls with red LED bars along the approach. */
  barriers: Stripe[];
  /** Audience stands lined with red LEDs. */
  grandstands: GrandstandSpec[];
  backdrop: Backdrop;
}

/** Runway center line and the big crossing lines (wide enough not to alias into dashes far away). */
const LINE = 0.22;
const CROSS_LINE = 0.36;
const LED = 0.07;
/** Half the car length plus a little: the start line sits just ahead of the front bumper. */
const START_AHEAD = 2.9;
const COOL_WHITE = 0xe8eeff;
const BLUE_WASH = 0x5d7dff;

const haze = (
  x: number,
  y: number,
  z: number,
  size: number,
  k: number
): GlowSpec => ({
  position: [x, y, z],
  size,
  color: new THREE.Color(0.55, 0.6, 0.72).multiplyScalar(k),
});

/** Tall floodlight tower: a 3×2 lamp head on a mast. */
const tower = (
  x: number,
  z: number,
  height: number,
  target: Vec3Tuple,
  extra: Partial<FloodlightSpec> = {}
): FloodlightSpec => ({ x, z, height, target, cols: 3, rows: 2, ...extra });

/** Low fixture on the ground (up-light or light bar): one row of small lamps, no haze cone. */
const fixture = (
  x: number,
  z: number,
  height: number,
  target: Vec3Tuple,
  cols: number,
  extra: Partial<FloodlightSpec> = {}
): FloodlightSpec => ({
  x,
  z,
  height,
  target,
  cols,
  rows: 1,
  lamp: 0.3,
  beam: 0,
  ...extra,
});

/** World position of a point given in the Curl's own frame, moved to a backdrop placement. */
function placed(p: Vec3Tuple, b: Backdrop): Vec3Tuple {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return [
    b.position[0] + p[0] * c + p[2] * s,
    b.position[1] + p[1],
    b.position[2] - p[0] * s + p[2] * c,
  ];
}

/** Center line and start line of a runway along +x. */
function runwayPaint(
  x0: number,
  centerTo: number,
  spawnX: number,
  halfWidth: number
): Stripe[] {
  const startX = spawnX + START_AHEAD;
  return [
    { x0, z0: 0, x1: centerTo, z1: 0, width: LINE },
    { x0: startX, z0: -halfWidth, x1: startX, z1: halfWidth, width: 0.4 },
  ];
}

/** LED strip along z = `z` from x0 to x1, skipping the open interval `gap` if given. */
function ledLine(
  x0: number,
  x1: number,
  z: number,
  gap?: [number, number]
): Stripe[] {
  if (!gap) return [{ x0, z0: z, x1, z1: z, width: LED }];
  return [
    { x0, z0: z, x1: gap[0], z1: z, width: LED },
    { x0: gap[1], z0: z, x1, z1: z, width: LED },
  ];
}

/** The Curl: runway along +x into the ramp base at x = 0. */
function backflipLayout(level: LevelDef): VenueLayout {
  const x0 = level.profile.sample(0).x;
  const spawnX = level.profile.sample(level.spawnS).x;
  const half = CURL_WIDTH / 2 + 1.6;
  const face = curlPoint(0.4);
  const upper = curlPoint(0.62);
  const landing = level.camera.focusX - 4;
  const upLight = { lamp: 0.4, spread: 0.06, beam: 0.05 };
  return {
    groundCenter: [-150, 0],
    paint: [
      ...runwayPaint(x0, -APRON_LENGTH, spawnX, half),
      // Big crossing lines like the aerial shots: an X over the landing zone.
      { x0: -170, z0: -78, x1: 60, z1: 70, width: CROSS_LINE },
      { x0: -170, z0: 74, x1: 60, z1: -62, width: CROSS_LINE },
      { x0: -36, z0: -90, x1: -36, z1: 90, width: CROSS_LINE },
    ],
    leds: [...ledLine(x0, -0.4, -half), ...ledLine(x0, -0.4, half)],
    floodlights: [
      // Far side towers (z < 0) behind the runway.
      tower(-240, -40, 22, [-222, 0, -2], { pool: 0.22, optional: true }),
      tower(-170, -36, 22, [spawnX + 4, 0, 0], {
        beam: 0.03,
        pool: 0.12,
        spot: { intensity: 1800, angle: 0.26 },
      }),
      tower(-104, -34, 22, [-90, 0, 0], { pool: 0.24 }),
      tower(-46, -88, 30, [-24, 0, -6], { beam: 0.025, pool: 0.12 }),
      tower(58, -86, 30, [20, 0, 4], { pool: 0.18, optional: true }),
      // Lights the lineup backdrop.
      tower(-60, -44, 14, [-60, 1.2, -70], {
        cols: 2,
        beam: 0.02,
        spot: { intensity: 1200, angle: 0.42, penumbra: 0.6 },
      }),
      // Near side towers (z > 0), behind the side camera's 45-60 m band.
      tower(-236, 66, 24, [-206, 0, 2], { pool: 0.2, optional: true }),
      tower(-150, 66, 24, [-136, 0, 0], { pool: 0.24 }),
      tower(-120, 68, 26, [-78, 0, 0], { pool: 0.22, optional: true }),
      // Landing-zone tower above and behind the side camera.
      tower(-30, 70, 34, [landing, 0, 0], {
        beam: 0.02,
        spot: { intensity: 9000, angle: 0.2, essential: true },
      }),
      // Up-lights at the ramp base: steep beams up the Curl's face.
      fixture(-9, 6.6, 0.7, face, 2, {
        ...upLight,
        spot: { intensity: 900, angle: 0.42, penumbra: 0.7, essential: true },
      }),
      fixture(-9, -6.6, 0.7, face, 2, upLight),
      fixture(-20, 7.5, 0.7, upper, 2, { ...upLight, optional: true }),
      fixture(-20, -7.5, 0.7, upper, 2, { ...upLight, optional: true }),
      // Low light bars along the landing zone.
      fixture(-70, -12, 0.9, [-30, 2, 0], 6),
      fixture(22, -16, 0.9, [6, 4, 0], 4, { optional: true }),
    ],
    follow: {
      offset: [-16, 40, 24],
      intensity: 2000,
      angle: 0.13,
      color: COOL_WHITE,
    },
    haze: [haze(-60, 7, -84, 50, 0.012), haze(-150, 9, -58, 60, 0.01)],
    barriers: [],
    grandstands: [
      { x: -112, z: -46, facing: Math.PI / 2, length: 64, tiers: 6 },
    ],
    backdrop: { position: [-60, 0, -70], yaw: 0 },
  };
}

/** The Lineup: flat runway along +x, five vehicles across the path at x ≈ 0. */
function kickflipLayout(level: LevelDef): VenueLayout {
  const x0 = level.profile.sample(0).x;
  const x1 = level.profile.sample(level.profile.length).x;
  const spawnX = level.profile.sample(level.spawnS).x;
  const half = 6.6;
  const landing = (level.goal.minTouchdownX ?? 10) + 14;
  const backdrop: Backdrop = { position: [140, 0, -90], yaw: -0.35 };
  const curlFace = placed(curlPoint(0.45), backdrop);
  const stage = { spread: 0.22, beam: 0.02 };
  const stageSpot = { intensity: 700, angle: 0.36 };
  const wash = { lamp: 0.62, spread: 0.14, tint: BLUE_WASH };
  return {
    groundCenter: [0, 0],
    paint: [
      ...runwayPaint(x0, x1, spawnX, half),
      { x0: -90, z0: -80, x1: 150, z1: 84, width: CROSS_LINE },
      { x0: -90, z0: 76, x1: 150, z1: -80, width: CROSS_LINE },
      { x0: 62, z0: -90, x1: 62, z1: 90, width: CROSS_LINE },
    ],
    // The audience-side strip stops around the lineup so the stage's own LED edge reads in front.
    leds: [...ledLine(x0, x1, -half), ...ledLine(x0, x1, half, [-24, 24])],
    floodlights: [
      // Far side towers, kept out of the audience's front view of the lineup.
      tower(-150, -44, 22, [-128, 0, 0], { pool: 0.22, optional: true }),
      tower(-96, -40, 22, [spawnX + 4, 0, 0], {
        beam: 0.03,
        pool: 0.12,
        spot: { intensity: 1800, angle: 0.25 },
      }),
      tower(-86, -64, 26, [-58, 0, -22], { pool: 0.14, optional: true }),
      tower(92, -60, 26, [60, 0, 0], { pool: 0.18 }),
      // Behind the lineup at the end of the approach (the glare in the chase shots).
      tower(52, -15, 15, [landing, 0, 0], {
        beam: 0.025,
        pool: 0.08,
        spot: { intensity: 1500, angle: 0.4, penumbra: 0.6, essential: true },
      }),
      // Near side (audience).
      tower(-150, 46, 22, [-140, 0, 0], { pool: 0.2, optional: true }),
      tower(-72, 52, 22, [-66, 0, 14], { pool: 0.16 }),
      tower(76, 52, 22, [62, 0, 0], { pool: 0.2, optional: true }),
      // Stage lights washing the lineup from the audience side.
      tower(-16, 30, 13, [-2, 1.6, 0], {
        ...stage,
        spot: { ...stageSpot, essential: true },
      }),
      tower(16, 30, 13, [2, 1.6, 0], { ...stage, spot: stageSpot }),
      // Low light bars beside the approach.
      fixture(-40, -11, 0.9, [-4, 1.5, 0], 3),
      fixture(26, 12, 0.9, [4, 1.5, 0], 4, { optional: true }),
      // Blue washes on the Curl backdrop.
      fixture(112, -70, 3, curlFace, 2, { ...wash, rows: 2, beam: 0.07 }),
      fixture(118, -108, 3, curlFace, 2, {
        ...wash,
        rows: 2,
        beam: 0.06,
        optional: true,
      }),
    ],
    follow: {
      offset: [-20, 38, 20],
      intensity: 1900,
      angle: 0.14,
      color: COOL_WHITE,
    },
    haze: [
      haze(140, 14, -96, 70, 0.03),
      // Faint haze behind the lineup so the vehicles' silhouettes separate from the night.
      haze(4, 6, -14, 40, 0.012),
    ],
    barriers: [
      { x0: -82, z0: -8.6, x1: -26, z1: -8.6, width: 0.4 },
      { x0: -82, z0: 8.6, x1: -26, z1: 8.6, width: 0.4 },
    ],
    grandstands: [{ x: 0, z: 44, facing: -Math.PI / 2, length: 70, tiers: 7 }],
    backdrop,
  };
}

/** Venue layout (paint, LEDs, fixtures, lights, haze, backdrop) for a level. */
export function venueLayout(level: LevelDef): VenueLayout {
  return level.id === "backflip"
    ? backflipLayout(level)
    : kickflipLayout(level);
}

/** The real spotlights mounted in fixtures, essential ones first (they survive the low tier). */
export function spotsOf(fixtures: readonly FloodlightSpec[]): SpotSpec[] {
  const spots: SpotSpec[] = [];
  for (const f of fixtures) {
    if (!f.spot) continue;
    spots.push({
      position: [f.x, f.height, f.z],
      target: f.target,
      color: f.tint,
      ...f.spot,
    });
  }
  return spots.sort((a, b) => Number(!!b.essential) - Number(!!a.essential));
}
