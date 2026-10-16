import { describe, expect, it } from "vitest";
import { DEG, TAU } from "@/core/math";
import type { RunStats, TrickResult } from "@/core/types";
import {
  buildLandingResult,
  evaluateTrick,
  gradeLanding,
  scoreLanding,
  trickName,
  trickPoints,
  turnsFrom,
} from "@/physics/scoring";

const stats: RunStats = {
  airTime: 3,
  maxHeight: 20,
  distance: 50,
  gasLeft: 0.5,
  topSpeed: 27,
};

function trick(pitchTurns: number, rollTurns = 0): TrickResult {
  return { name: "", pitchTurns, rollTurns };
}

describe("turn counting", () => {
  it("rounds the accumulated rotation to the nearest full turn", () => {
    expect(turnsFrom(0)).toBe(0);
    expect(turnsFrom(TAU * 0.49)).toBe(0);
    expect(turnsFrom(TAU * 0.51)).toBe(1);
    expect(turnsFrom(TAU + 25 * DEG)).toBe(1);
    expect(turnsFrom(2 * TAU - 30 * DEG)).toBe(2);
    expect(turnsFrom(-TAU - 10 * DEG)).toBe(-1);
    expect(Object.is(turnsFrom(-0.1), -0)).toBe(false);
  });
});

describe("trick names", () => {
  it("names pitch tricks (+ = backflip)", () => {
    expect(trickName(1, 0, "backflip")).toBe("BACKFLIP");
    expect(trickName(2, 0, "backflip")).toBe("DOUBLE BACKFLIP");
    expect(trickName(3, 0, "backflip")).toBe("TRIPLE BACKFLIP");
    expect(trickName(4, 0, "backflip")).toBe("4× BACKFLIP");
    expect(trickName(-1, 0, "backflip")).toBe("FRONTFLIP");
    expect(trickName(-2, 0, "backflip")).toBe("DOUBLE FRONTFLIP");
  });

  it("names roll tricks (− = kickflip, + = heelflip)", () => {
    expect(trickName(0, -1, "kickflip")).toBe("KICKFLIP");
    expect(trickName(0, 1, "kickflip")).toBe("HEELFLIP");
    expect(trickName(0, -2, "kickflip")).toBe("DOUBLE KICKFLIP");
    expect(trickName(0, 2, "kickflip")).toBe("DOUBLE HEELFLIP");
    expect(trickName(0, -3, "kickflip")).toBe("TRIPLE KICKFLIP");
    expect(trickName(0, 5, "kickflip")).toBe("5× HEELFLIP");
  });

  it("names zero-turn jumps per level and combines axes", () => {
    expect(trickName(0, 0, "backflip")).toBe("NO FLIP");
    expect(trickName(0, 0, "kickflip")).toBe("OLLIE");
    expect(trickName(1, -1, "kickflip")).toBe("BACKFLIP + KICKFLIP");
  });

  it("evaluates a trick from accumulated angles", () => {
    expect(evaluateTrick(TAU + 0.2, 0, "backflip")).toEqual({
      name: "BACKFLIP",
      pitchTurns: 1,
      rollTurns: 0,
    });
    expect(evaluateTrick(0, -2 * TAU + 0.3, "kickflip")).toEqual({
      name: "DOUBLE KICKFLIP",
      pitchTurns: 0,
      rollTurns: -2,
    });
  });
});

describe("landing grades", () => {
  it("uses the angle and impact thresholds", () => {
    expect(gradeLanding(0, 0)).toEqual({ ok: true, grade: "perfect" });
    expect(gradeLanding(10 * DEG, 4)).toEqual({ ok: true, grade: "perfect" });
    expect(gradeLanding(10.5 * DEG, 4)).toEqual({ ok: true, grade: "great" });
    expect(gradeLanding(5 * DEG, 4.1)).toEqual({ ok: true, grade: "great" });
    expect(gradeLanding(20 * DEG, 7)).toEqual({ ok: true, grade: "great" });
    expect(gradeLanding(21 * DEG, 2)).toEqual({ ok: true, grade: "good" });
    expect(gradeLanding(35 * DEG, 11)).toEqual({ ok: true, grade: "good" });
  });

  it("wrecks over 35° (angle) or over 11 m/s (impact)", () => {
    expect(gradeLanding(36 * DEG, 1)).toEqual({ ok: false, reason: "angle" });
    expect(gradeLanding(170 * DEG, 30)).toEqual({ ok: false, reason: "angle" });
    expect(gradeLanding(5 * DEG, 11.5)).toEqual({
      ok: false,
      reason: "impact",
    });
  });
});

describe("score", () => {
  it("values tricks per axis with a bonus for multiples", () => {
    expect(trickPoints(trick(1))).toBe(1000);
    expect(trickPoints(trick(2))).toBe(3000);
    expect(trickPoints(trick(3))).toBe(6000);
    expect(trickPoints(trick(-1))).toBe(1000);
    expect(trickPoints(trick(0, -1))).toBe(800);
    expect(trickPoints(trick(0, 2))).toBe(2400);
    expect(trickPoints(trick(0, 0))).toBe(150);
  });

  it("adds air, height and gas, then applies the grade multiplier", () => {
    const s = scoreLanding(trick(1), "great", stats, true);
    expect(s).toEqual({
      trick: 1000,
      air: 450,
      height: 500,
      gas: 250,
      multiplier: 1.5,
      total: 3300,
    });
    expect(scoreLanding(trick(1), "perfect", stats, true).total).toBe(4400);
    expect(scoreLanding(trick(1), "good", stats, true).total).toBe(2200);
  });

  it("voids the trick and the multiplier when the goal was missed", () => {
    const s = scoreLanding(trick(0, -1), "perfect", stats, false);
    expect(s.trick).toBe(0);
    expect(s.multiplier).toBe(1);
    expect(s.total).toBe(450 + 500 + 250);
  });

  it("returns integers", () => {
    const odd: RunStats = {
      airTime: 2.3456,
      maxHeight: 7.77,
      distance: 1,
      gasLeft: 0.333,
      topSpeed: 1,
    };
    const s = scoreLanding(trick(2), "great", odd, true);
    for (const v of [s.trick, s.air, s.height, s.gas, s.total])
      expect(Number.isInteger(v)).toBe(true);
  });

  it("builds a full landing result", () => {
    const r = buildLandingResult({
      level: "backflip",
      grade: "perfect",
      angleError: 0.05,
      impactSpeed: 2,
      trickPitch: 2 * TAU - 0.1,
      trickRoll: 0,
      stats,
      goalMet: true,
    });
    expect(r.trick.name).toBe("DOUBLE BACKFLIP");
    expect(r.score.total).toBe(Math.round((3000 + 450 + 500 + 250) * 2));
    expect(r.goalMet).toBe(true);
  });
});
