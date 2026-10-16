import type { LevelDef, Obstacle, VehicleKind } from "@/core/types";
import { createProfile } from "@/physics/profile";

const RUNWAY_BEHIND = 300;
const RUNWAY_AHEAD = 400;

/** Height of the low stage the lineup stands on (m). */
export const STAGE_HEIGHT = 0.22;
const GAP = 0.8;

interface LineupEntry {
  kind: VehicleKind;
  label: string;
  /** Body width across the path, height and length (m). */
  width: number;
  height: number;
  length: number;
  color: number;
}

/** Left to right as seen from the audience side (+z), i.e. in order of increasing x. */
const LINEUP: LineupEntry[] = [
  {
    kind: "model3",
    label: "Model 3",
    width: 1.85,
    height: 1.44,
    length: 4.72,
    color: 0x1d2f7a,
  },
  {
    kind: "modelY",
    label: "Model Y",
    width: 1.92,
    height: 1.62,
    length: 4.79,
    color: 0x8e0f16,
  },
  {
    kind: "semi",
    label: "Semi",
    width: 2.6,
    height: 4.0,
    length: 7.5,
    color: 0xf1f2f3,
  },
  {
    kind: "cybertruck",
    label: "Cybertruck",
    width: 2.03,
    height: 1.79,
    length: 5.68,
    color: 0xb9bdc1,
  },
  {
    kind: "cybercab",
    label: "Cybercab",
    width: 1.95,
    height: 1.35,
    length: 4.3,
    color: 0xcdb27a,
  },
];

const lineupWidth =
  LINEUP.reduce((sum, v) => sum + v.width, 0) + GAP * (LINEUP.length - 1);
const STAGE_MARGIN = 0.5;
export const LINEUP_START_X = -lineupWidth / 2;
export const LINEUP_END_X = lineupWidth / 2;

/** Front-view outline: vertical flanks up to the belt line, then the greenhouse tapers to the roof. */
function vehiclePolygon(x: number, v: LineupEntry): Array<[number, number]> {
  const base = STAGE_HEIGHT + 0.12;
  const top = STAGE_HEIGHT + v.height;
  const half = v.width / 2;
  const belt = STAGE_HEIGHT + v.height * (v.kind === "semi" ? 0.9 : 0.58);
  const roofHalf = v.kind === "semi" ? half * 0.86 : half * 0.68;
  return [
    [x - half, base],
    [x + half, base],
    [x + half, belt],
    [x + roofHalf, top],
    [x - roofHalf, top],
    [x - half, belt],
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
    const x = cursor + v.width / 2;
    out.push({
      id: v.kind,
      kind: v.kind,
      label: v.label,
      x,
      z: 0,
      baseY: STAGE_HEIGHT,
      sizeX: v.width,
      sizeY: v.height,
      sizeZ: v.length,
      // Parked side by side, noses pointing at the audience (+z).
      yaw: -Math.PI / 2,
      polygon: vehiclePolygon(x, v),
      color: v.color,
    });
    cursor += v.width + GAP;
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
