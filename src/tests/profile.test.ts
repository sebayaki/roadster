import { describe, expect, it } from "vitest";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";

describe("track profiles", () => {
  it("the Curl rises ~24 m and curls past vertical back over the runway", () => {
    const { profile } = backflipLevel;
    const base = profile.sample(profile.rampStart);
    const lip = profile.sample(profile.length);
    expect(base.x).toBeCloseTo(0, 1);
    expect(base.y).toBeCloseTo(0, 5);
    expect(lip.y).toBeGreaterThan(22);
    expect(lip.y).toBeLessThan(27);
    const lipDeg = (lip.angle * 180) / Math.PI;
    expect(lipDeg).toBeGreaterThan(160);
    expect(lipDeg).toBeLessThan(175);
    // The widest point of the ramp is where it turns vertical.
    const pts = profile.samples(0.1, profile.rampStart, profile.length);
    const bulge = pts.reduce((m, p) => (p.x > m.x ? p : m));
    expect(bulge.x).toBeGreaterThan(7);
    expect(bulge.x).toBeLessThan(12);
    expect((bulge.angle * 180) / Math.PI).toBeCloseTo(90, -1);
  });

  it("samples stay continuous along the ramp", () => {
    const { profile } = backflipLevel;
    const pts = profile.samples(0.05, profile.rampStart - 2, profile.length);
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      expect(d).toBeCloseTo(pts[i].s - pts[i - 1].s, 2);
    }
  });

  it("the kickflip runway is flat and the lineup sits around x = 0", () => {
    const { profile, obstacles, goal } = kickflipLevel;
    expect(profile.rampStart).toBe(profile.length);
    expect(profile.sample(123).y).toBe(0);
    const vehicles = obstacles.filter((o) => o.kind !== "stage");
    expect(vehicles.map((v) => v.kind)).toEqual([
      "model3",
      "modelY",
      "semi",
      "cybertruck",
      "cybercab",
    ]);
    const semi = vehicles.find((v) => v.kind === "semi")!;
    expect(Math.max(...semi.polygon.map(([, y]) => y))).toBeGreaterThan(4);
    expect(goal.minTouchdownX).toBeGreaterThan(
      Math.max(...vehicles.map((v) => v.x))
    );
  });
});
