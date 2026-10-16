import { TAU } from "@/core/math";
import type {
  CrashReason,
  LandingGrade,
  LandingResult,
  LevelId,
  RunStats,
  ScoreBreakdown,
  TrickResult,
} from "@/core/types";
import { SCORING, TUNING } from "./tuning";

/** Completed turns in an accumulated rotation (rad), rounded to the nearest full turn. */
export function turnsFrom(angle: number): number {
  const turns = Math.round(angle / TAU);
  return turns === 0 ? 0 : turns; // never -0
}

const MULTIPLE_PREFIX = ["", "", "DOUBLE ", "TRIPLE "];

function flipName(turns: number, positive: string, negative: string): string {
  const n = Math.abs(turns);
  const base = turns > 0 ? positive : negative;
  return n < MULTIPLE_PREFIX.length
    ? MULTIPLE_PREFIX[n] + base
    : `${n}× ${base}`;
}

/**
 * Display name of a trick from signed turn counts. Pitch + is a backflip, roll − (◀) a
 * kickflip and roll + (▶) a heelflip. Zero turns is "NO FLIP" on the backflip level and
 * "OLLIE" on the kickflip level.
 */
export function trickName(
  pitchTurns: number,
  rollTurns: number,
  level: LevelId
): string {
  const parts: string[] = [];
  if (pitchTurns !== 0)
    parts.push(flipName(pitchTurns, "BACKFLIP", "FRONTFLIP"));
  if (rollTurns !== 0) parts.push(flipName(rollTurns, "HEELFLIP", "KICKFLIP"));
  if (parts.length === 0) return level === "backflip" ? "NO FLIP" : "OLLIE";
  return parts.join(" + ");
}

/** Trick from the rotation accumulated since leaving flat ground (rad, signed). */
export function evaluateTrick(
  trickPitch: number,
  trickRoll: number,
  level: LevelId
): TrickResult {
  const pitchTurns = turnsFrom(trickPitch);
  const rollTurns = turnsFrom(trickRoll);
  return {
    name: trickName(pitchTurns, rollTurns, level),
    pitchTurns,
    rollTurns,
  };
}

/** Outcome of a touchdown: a landing grade, or the reason it wrecks the car. */
export type LandingVerdict =
  | { ok: true; grade: LandingGrade }
  | { ok: false; reason: Exclude<CrashReason, "obstacle"> };

/**
 * Grades a touchdown from the angle between the car's up axis and the surface normal
 * (rad) and the speed into the surface (m/s). Over 35° is an "angle" wreck, otherwise
 * too fast is an "impact" wreck.
 */
export function gradeLanding(
  angleError: number,
  impactSpeed: number
): LandingVerdict {
  const { perfect, great, good } = TUNING.grades;
  if (angleError <= perfect.angle && impactSpeed <= perfect.impact)
    return { ok: true, grade: "perfect" };
  if (angleError <= great.angle && impactSpeed <= great.impact)
    return { ok: true, grade: "great" };
  if (angleError <= good.angle && impactSpeed <= good.impact)
    return { ok: true, grade: "good" };
  return { ok: false, reason: angleError > good.angle ? "angle" : "impact" };
}

function axisPoints(turns: number, perTurn: number): number {
  const n = Math.abs(turns);
  return n === 0 ? 0 : perTurn * n * (1 + SCORING.multipleBonus * (n - 1));
}

/** Trick points before the landing multiplier. */
export function trickPoints(trick: TrickResult): number {
  const points =
    axisPoints(trick.pitchTurns, SCORING.pitchTurn) +
    axisPoints(trick.rollTurns, SCORING.rollTurn);
  return points === 0 ? SCORING.noFlip : points;
}

/**
 * Score of a clean landing. Components are integers before the multiplier; the total
 * is (trick + air + height + gas) × multiplier, rounded. Missing the goal ("TOO SHORT")
 * voids the trick points and the multiplier.
 */
export function scoreLanding(
  trick: TrickResult,
  grade: LandingGrade,
  stats: RunStats,
  goalMet: boolean
): ScoreBreakdown {
  const trickPts = goalMet ? Math.round(trickPoints(trick)) : 0;
  const air = Math.round(SCORING.perAirSecond * Math.max(0, stats.airTime));
  const height = Math.round(
    SCORING.perMeterHeight * Math.max(0, stats.maxHeight)
  );
  const gas = Math.round(
    SCORING.fullGas * Math.min(1, Math.max(0, stats.gasLeft))
  );
  const multiplier = goalMet ? SCORING.multiplier[grade] : 1;
  return {
    trick: trickPts,
    air,
    height,
    gas,
    multiplier,
    total: Math.round((trickPts + air + height + gas) * multiplier),
  };
}

/** Assembles the full result of a run-ending clean touchdown. */
export function buildLandingResult(opts: {
  level: LevelId;
  grade: LandingGrade;
  angleError: number;
  impactSpeed: number;
  trickPitch: number;
  trickRoll: number;
  stats: RunStats;
  goalMet: boolean;
}): LandingResult {
  const trick = evaluateTrick(opts.trickPitch, opts.trickRoll, opts.level);
  return {
    grade: opts.grade,
    angleError: opts.angleError,
    impactSpeed: opts.impactSpeed,
    trick,
    stats: opts.stats,
    goalMet: opts.goalMet,
    score: scoreLanding(trick, opts.grade, opts.stats, opts.goalMet),
  };
}
