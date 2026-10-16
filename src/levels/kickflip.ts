import type { LevelDef, Obstacle, VehicleKind } from "@/core/types";
import { createProfile } from "@/physics/profile";

const RUNWAY_BEHIND = 300;
const RUNWAY_AHEAD = 400;

/** Height of the low stage the lineup stands on (m). */
export const STAGE_HEIGHT = 0.22;
const GAP = 0.8;

/** Bumper-to-bumper length, body width without mirrors and height of a vehicle (m). */
export interface VehicleDims {
  length: number;
  width: number;
  height: number;
}

/**
 * Size of each lineup vehicle (parked across the path: width along x, length
 * along z). The vehicle models (render/vehicles) are built at these sizes.
 */
export const LINEUP_DIMS: Readonly<Record<VehicleKind, VehicleDims>> = {
  model3: { length: 4.72, width: 1.85, height: 1.44 },
  modelY: { length: 4.79, width: 1.92, height: 1.62 },
  semi: { length: 7.5, width: 2.6, height: 4.0 },
  cybertruck: { length: 5.68, width: 2.03, height: 1.79 },
  cybercab: { length: 4.3, width: 1.95, height: 1.35 },
};

interface LineupEntry {
  kind: VehicleKind;
  label: string;
  color: number;
}

/** Left to right as seen from the audience side (+z), i.e. in order of increasing x. */
const LINEUP: LineupEntry[] = [
  { kind: "model3", label: "Model 3", color: 0x1d2f7a },
  { kind: "modelY", label: "Model Y", color: 0x8e0f16 },
  { kind: "semi", label: "Semi", color: 0xf1f2f3 },
  { kind: "cybertruck", label: "Cybertruck", color: 0xb9bdc1 },
  { kind: "cybercab", label: "Cybercab", color: 0xcdb27a },
];

const lineupWidth =
  LINEUP.reduce((sum, v) => sum + LINEUP_DIMS[v.kind].width, 0) +
  GAP * (LINEUP.length - 1);
const STAGE_MARGIN = 0.5;
export const LINEUP_START_X = -lineupWidth / 2;
export const LINEUP_END_X = lineupWidth / 2;

/** Height above the stand plane where a vehicle's collision outline starts (m). */
export const OUTLINE_BASE = 0.12;

/**
 * Front-view collision outline rule of a lineup vehicle: vertical flanks (half
 * width `half`) up to the `belt` line, then the greenhouse tapers to `roofHalf`
 * at the roof (`top`). Heights are above the stand plane (m).
 */
export function vehicleOutline(kind: VehicleKind): {
  half: number;
  belt: number;
  roofHalf: number;
  top: number;
} {
  const { width, height } = LINEUP_DIMS[kind];
  const half = width / 2;
  const semi = kind === "semi";
  return {
    half,
    belt: height * (semi ? 0.9 : 0.58),
    roofHalf: half * (semi ? 0.86 : 0.68),
    top: height,
  };
}

function vehiclePolygon(x: number, kind: VehicleKind): Array<[number, number]> {
  const { half, belt, roofHalf, top } = vehicleOutline(kind);
  const baseY = STAGE_HEIGHT + OUTLINE_BASE;
  const beltY = STAGE_HEIGHT + belt;
  const topY = STAGE_HEIGHT + top;
  return [
    [x - half, baseY],
    [x + half, baseY],
    [x + half, beltY],
    [x + roofHalf, topY],
    [x - roofHalf, topY],
    [x - half, beltY],
  ];
}

function buildObstacles(): Obstacle[] {
  const out: Obstacle[] = [];
  const stageX0 = LINEUP_START_X - STAGE_MARGIN;
  const stageX1 = LINEUP_END_X + STAGE_MARGIN;
  out.push({
    id: "stage",
    kind: "stage",
    label: "stage",
    x: (stageX0 + stageX1) / 2,
    z: 0,
    baseY: 0,
    sizeX: stageX1 - stageX0,
    sizeY: STAGE_HEIGHT,
    sizeZ: 8.4,
    yaw: 0,
    polygon: [
      [stageX0, 0],
      [stageX1, 0],
      [stageX1, STAGE_HEIGHT],
      [stageX0, STAGE_HEIGHT],
    ],
    color: 0x111114,
  });
  let cursor = LINEUP_START_X;
  for (const v of LINEUP) {
    const d = LINEUP_DIMS[v.kind];
    const x = cursor + d.width / 2;
    out.push({
      id: v.kind,
      kind: v.kind,
      label: v.label,
      x,
      z: 0,
      baseY: STAGE_HEIGHT,
      sizeX: d.width,
      sizeY: d.height,
      sizeZ: d.length,
      // Parked side by side, noses pointing at the audience (+z).
      yaw: -Math.PI / 2,
      polygon: vehiclePolygon(x, v.kind),
      color: v.color,
    });
    cursor += d.width + GAP;
  }
  return out;
}

const profile = createProfile({
  startX: -RUNWAY_BEHIND,
  segments: [{ length: RUNWAY_BEHIND + RUNWAY_AHEAD, k0: 0, k1: 0 }],
});

export const kickflipLevel: LevelDef = {
  id: "kickflip",
  title: "KICKFLIP",
  venue: "The Lineup",
  tagline: "Thrust off the ground and barrel-roll over five parked cars.",
  howTo: [
    "Pick your speed, then fire the thrusters before the lineup to lift off.",
    "Spin a full roll in the air — that's the kickflip.",
    "Get upright and thrust again to land soft past the last car.",
  ],
  spinAxis: "roll",
  profile,
  obstacles: buildObstacles(),
  spawnS: RUNWAY_BEHIND - 120,
  gasCapacity: 2.2,
  speedHint: [55 / 3.6, 85 / 3.6],
  goal: {
    requireRampLaunch: false,
    minTouchdownX: LINEUP_END_X + STAGE_MARGIN + 2.4,
  },
  camera: { airView: "chase", focusX: 0 },
};
