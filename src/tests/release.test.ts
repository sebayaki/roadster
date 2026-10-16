import { describe, expect, it } from "vitest";
import { DEG, TAU } from "@/core/math";
import type { LevelDef } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";
import {
  first,
  reactiveHuman,
  simulate,
  speedBand,
  untilRunEnds,
  type HumanPlan,
} from "./sim";

/** Reaction delays (s) of the simulated players. */
const DELAYS = [0.15, 0.2, 0.25];
/** Where they decide to let go, relative to a full turn: from 80° early to 10° late. */
const WINDOW = [-80, -60, -40, -20, 0, 10].map((deg) => deg * DEG);

function play(level: LevelDef, plan: HumanPlan) {
  const { events } = simulate(level, reactiveHuman(level, plan), {
    until: untilRunEnds,
  });
  return {
    launch: first(events, "launch"),
    land: first(events, "land"),
    crash: first(events, "crash"),
  };
}

const label = (plan: HumanPlan) =>
  `${Math.round(plan.kmh)} km/h, ${plan.delay} s late, let go at ${Math.round(plan.release / DEG)}°` +
  (plan.liftX === undefined
    ? ""
    : `, lift-off x ${plan.liftX} for ${plan.liftHeight} m`);

describe("release stabilizer: hold to spin, let go when it's nearly upright", () => {
  it.each(speedBand(backflipLevel))(
    "backflip at %d km/h lands a single across the release window",
    (kmh) => {
      for (const delay of DELAYS)
        for (const release of WINDOW) {
          const plan = { kmh, dir: -1, release, delay };
          const { land } = play(backflipLevel, plan);
          expect(land?.result.trick.name, label(plan)).toBe("BACKFLIP");
        }
    }
  );

  it.each(speedBand(kickflipLevel))(
    "kickflip ◀ and heelflip ▶ at %d km/h land a single across the release window",
    (kmh) => {
      for (const [dir, name] of [
        [-1, "KICKFLIP"],
        [1, "HEELFLIP"],
      ] as const)
        // Lift-off decided at x −38 / −28 happens at x ≈ −35 / −22 after the delay.
        for (const liftX of [-38, -28])
          for (const liftHeight of [2, 3])
            for (const delay of DELAYS)
              for (const release of WINDOW) {
                const plan = { kmh, dir, release, delay, liftX, liftHeight };
                const { launch, land } = play(kickflipLevel, plan);
                expect(launch!.position.x, label(plan)).toBeGreaterThan(-36);
                expect(launch!.position.x, label(plan)).toBeLessThan(-20);
                expect(land?.result.trick.name, label(plan)).toBe(name);
                expect(land!.result.goalMet, label(plan)).toBe(true);
              }
    }
  );

  it("still wrecks when let go half a turn from upright", () => {
    const release = -180 * DEG;
    for (const delay of DELAYS) {
      for (const kmh of speedBand(backflipLevel)) {
        const plan = { kmh, dir: -1, release, delay };
        expect(play(backflipLevel, plan).crash?.reason, label(plan)).toBe(
          "angle"
        );
      }
      for (const dir of [-1, 1]) {
        const plan = {
          kmh: 70,
          dir,
          release,
          delay,
          liftX: -32,
          liftHeight: 3,
        };
        expect(play(kickflipLevel, plan).crash?.reason, label(plan)).toBe(
          "angle"
        );
      }
    }
  });

  it("a double kickflip needs a higher hop and holding through the first upright", () => {
    for (const delay of DELAYS)
      for (const release of WINDOW) {
        const plan = {
          kmh: 70,
          dir: -1,
          release: TAU + release,
          delay,
          liftX: -32,
        };
        const high = play(kickflipLevel, { ...plan, liftHeight: 6 });
        expect(high.land?.result.trick.name, label(plan)).toBe(
          "DOUBLE KICKFLIP"
        );
        expect(
          play(kickflipLevel, { ...plan, liftHeight: 2 }).crash,
          label(plan)
        ).toBeDefined();
      }
  });
});
