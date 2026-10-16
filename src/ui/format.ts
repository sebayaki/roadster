/** Pure text helpers for the HUD (no DOM): numbers, units, result lines and the share link. */
import type {
  CrashReason,
  LandingGrade,
  LandingResult,
  LevelDef,
  SpinAxis,
  Units,
} from "@/core/types";
import { lengthIn, speedIn, wrapAngle } from "@/core/math";

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 12340 → "12,340". */
export function formatScore(points: number): string {
  return INTEGER.format(Math.round(points));
}

export function speedUnit(units: Units): string {
  return units === "metric" ? "KM/H" : "MPH";
}

export function lengthUnit(units: Units): string {
  return units === "metric" ? "m" : "ft";
}

/** m/s → "98 km/h" / "61 mph". */
export function formatSpeed(ms: number, units: Units): string {
  return `${Math.round(speedIn(Math.abs(ms), units))} ${speedUnit(units).toLowerCase()}`;
}

/** Recommended speed window, e.g. "85–105". */
export function formatSpeedRange(
  range: readonly [number, number],
  units: Units
): string {
  return `${Math.round(speedIn(range[0], units))}–${Math.round(speedIn(range[1], units))}`;
}

/** m → "24.6 m" / "80.7 ft". */
export function formatLength(m: number, units: Units, digits = 1): string {
  return `${lengthIn(m, units).toFixed(digits)} ${lengthUnit(units)}`;
}

/** s → "2.4 s". */
export function formatSeconds(s: number): string {
  return `${s.toFixed(1)} s`;
}

/** 1.5 → "×1.5", 2 → "×2". */
export function formatMultiplier(m: number): string {
  return `×${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}`;
}

export const GRADE_LABEL: Record<LandingGrade, string> = {
  perfect: "PERFECT",
  great: "GREAT",
  good: "GOOD",
};

export type ResultKind = "landed" | "short" | "wrecked";

export function resultKind(landing: LandingResult | null): ResultKind {
  if (!landing) return "wrecked";
  return landing.goalMet ? "landed" : "short";
}

/** Car orientation just before a crash (unwrapped radians, like CarSnapshot). */
export interface Attitude {
  pitch: number;
  roll: number;
}

/** Human reason line for a wreck, e.g. "Hit the Semi", "Landed on the roof". */
export function crashReasonLine(
  reason: CrashReason,
  obstacle: string | undefined,
  attitude: Attitude | null
): string {
  switch (reason) {
    case "obstacle":
      if (!obstacle) return "Hit an obstacle";
      return obstacle.toLowerCase() === "stage"
        ? "Clipped the stage"
        : `Hit the ${obstacle}`;
    case "impact":
      return "Landed too hard";
    case "angle":
      return angleLine(attitude);
  }
}

function angleLine(attitude: Attitude | null): string {
  if (!attitude) return "Landed at a bad angle";
  const pitch = wrapAngle(attitude.pitch);
  const roll = wrapAngle(attitude.roll);
  // Car up · world up = cos(pitch)·cos(roll); below ≈ -0.3 the car is mostly inverted.
  if (Math.cos(pitch) * Math.cos(roll) < -0.3) return "Landed on the roof";
  if (Math.abs(roll) > Math.abs(pitch)) return "Landed on its side";
  return pitch > 0 ? "Came down tail first" : "Came down nose first";
}

/** One-line advice shown under the reason line. */
export function crashTip(
  reason: CrashReason,
  axis: SpinAxis,
  obstacle?: string
): string {
  switch (reason) {
    case "impact":
      return "Hold THRUST on the way down to cushion the touchdown.";
    case "angle":
      return axis === "pitch"
        ? "Keep the flip going until the car is level, then let go."
        : "Finish the roll and level out before touchdown.";
    case "obstacle":
      switch (obstacle) {
        case "Curl": // The ramp itself (backflip level).
          return "Launch off the lip of the Curl: hopping into the ramp wrecks the car.";
        case "Semi":
          return "Climb higher before the lineup: the Semi is 4 m tall.";
        default:
          return "Lift off earlier and climb before the lineup.";
      }
  }
}

export const SHORT_LINE = "Touched down before clearing the lineup";
export const SHORT_TIP =
  "Carry more speed or keep thrusting to land past the last car.";

/** "I landed a DOUBLE BACKFLIP in the new Roadster — 12,340 pts. #RDSTRStunts" */
export function shareText(
  level: LevelDef,
  landing: LandingResult | null
): string {
  const tag = "#RDSTRStunts";
  if (!landing) {
    return `I wrecked the new Roadster going for a ${level.title} at ${level.venue}. Can you land it? ${tag}`;
  }
  const points = `${formatScore(landing.score.total)} pts`;
  if (!landing.goalMet) {
    return `I flew the new Roadster at ${level.venue}: ${points}, but landed short. ${tag}`;
  }
  const { name, pitchTurns, rollTurns } = landing.trick;
  if (pitchTurns === 0 && rollTurns === 0 && name === "NO FLIP") {
    return `I took the new Roadster off ${level.venue} — ${points}. ${tag}`;
  }
  return `I landed ${article(name)} ${name} in the new Roadster — ${points}. ${tag}`;
}

function article(word: string): string {
  return /^[AEIOU]/i.test(word) ? "an" : "a";
}

/** The link to share: the page's canonical URL when declared, else this page without query / hash. */
export function sharePageUrl(
  canonical: string | null | undefined,
  page: { origin: string; pathname: string }
): string {
  return canonical || page.origin + page.pathname;
}

/** Twitter / X web intent for `text` linking to `pageUrl`. */
export function shareUrl(text: string, pageUrl: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
}
