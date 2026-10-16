import { describe, expect, it } from "vitest";
import type { LandingResult } from "@/core/types";
import { backflipLevel } from "@/levels/backflip";
import { kickflipLevel } from "@/levels/kickflip";
import { buttonKey, cheatSheet, hintSegments } from "@/ui/controls-info";
import {
  crashReasonLine,
  crashTip,
  formatLength,
  formatMultiplier,
  formatScore,
  formatSpeed,
  formatSpeedRange,
  resultKind,
  sharePageUrl,
  shareText,
  shareUrl,
} from "@/ui/format";

function landing(
  name: string,
  total: number,
  goalMet = true,
  turns: [number, number] = [1, 0]
): LandingResult {
  return {
    grade: "perfect",
    angleError: 0.05,
    impactSpeed: 2,
    trick: { name, pitchTurns: turns[0], rollTurns: turns[1] },
    stats: {
      airTime: 3,
      maxHeight: 25,
      distance: 30,
      gasLeft: 0.4,
      topSpeed: 28,
    },
    goalMet,
    score: { trick: 0, air: 0, height: 0, gas: 0, multiplier: 2, total },
  };
}

describe("ui number formatting", () => {
  it("groups score digits and rounds", () => {
    expect(formatScore(12340)).toBe("12,340");
    expect(formatScore(999.6)).toBe("1,000");
    expect(formatScore(0)).toBe("0");
  });

  it("converts speeds and lengths into the chosen units", () => {
    expect(formatSpeed(100 / 3.6, "metric")).toBe("100 km/h");
    expect(formatSpeed(-100 / 3.6, "imperial")).toBe("62 mph");
    expect(formatSpeedRange(backflipLevel.speedHint, "metric")).toBe("85–105");
    expect(formatSpeedRange(backflipLevel.speedHint, "imperial")).toBe("53–65");
    expect(formatLength(24.6, "metric")).toBe("24.6 m");
    expect(formatLength(24.6, "imperial")).toBe("80.7 ft");
    expect(formatLength(30.4, "metric", 0)).toBe("30 m");
  });

  it("prints landing multipliers compactly", () => {
    expect(formatMultiplier(2)).toBe("×2");
    expect(formatMultiplier(1.5)).toBe("×1.5");
    expect(formatMultiplier(1)).toBe("×1");
  });
});

describe("result lines", () => {
  it("classifies the run outcome", () => {
    expect(resultKind(null)).toBe("wrecked");
    expect(resultKind(landing("KICKFLIP", 500, false))).toBe("short");
    expect(resultKind(landing("BACKFLIP", 5000))).toBe("landed");
  });

  it("names what the car hit", () => {
    expect(crashReasonLine("obstacle", "Semi", null)).toBe("Hit the Semi");
    expect(crashReasonLine("obstacle", "stage", null)).toBe(
      "Clipped the stage"
    );
    expect(crashReasonLine("obstacle", undefined, null)).toBe(
      "Hit an obstacle"
    );
    expect(crashReasonLine("impact", undefined, null)).toBe("Landed too hard");
  });

  it("describes bad-angle touchdowns from the last attitude (unwrapped angles)", () => {
    const line = (pitch: number, roll: number) =>
      crashReasonLine("angle", undefined, { pitch, roll });
    expect(line(Math.PI, 0)).toBe("Landed on the roof");
    expect(line(0, Math.PI + 4 * Math.PI)).toBe("Landed on the roof");
    expect(line(2 * Math.PI - 0.8, 0)).toBe("Came down nose first");
    expect(line(2 * Math.PI + 0.8, 0)).toBe("Came down tail first");
    expect(line(0, -1.2)).toBe("Landed on its side");
    expect(crashReasonLine("angle", undefined, null)).toBe(
      "Landed at a bad angle"
    );
  });

  it("gives axis-aware tips", () => {
    expect(crashTip("angle", "pitch")).toMatch(/flip/i);
    expect(crashTip("angle", "roll")).toMatch(/roll/i);
    expect(crashTip("impact", "pitch")).toMatch(/THRUST/);
    expect(crashTip("obstacle", "roll", "Semi")).toMatch(/Semi/);
  });

  it("gives obstacle-aware tips (the Curl is the backflip ramp, not the lineup)", () => {
    expect(crashTip("obstacle", "pitch", "Curl")).toMatch(/lip of the Curl/);
    expect(crashTip("obstacle", "pitch", "Curl")).not.toMatch(/lineup/);
    expect(crashTip("obstacle", "roll", "Model Y")).toMatch(/lineup/);
    expect(crashTip("obstacle", "roll", "stage")).toMatch(/lineup/);
  });
});

describe("share on X", () => {
  it("matches the spec wording for a landed trick", () => {
    expect(
      shareText(backflipLevel, landing("DOUBLE BACKFLIP", 12340, true, [2, 0]))
    ).toBe(
      "I landed a DOUBLE BACKFLIP in the new Roadster — 12,340 pts. #RDSTRStunts"
    );
    expect(
      shareText(kickflipLevel, landing("OLLIE", 450, true, [0, 0]))
    ).toMatch(/^I landed an OLLIE/);
    expect(
      shareText(backflipLevel, landing("NO FLIP", 450, true, [0, 0]))
    ).toMatch(/off The Curl/);
  });

  it("covers short landings and wrecks", () => {
    expect(shareText(kickflipLevel, landing("KICKFLIP", 580, false))).toMatch(
      /landed short/
    );
    expect(shareText(kickflipLevel, null)).toMatch(
      /wrecked the new Roadster.*KICKFLIP/
    );
  });

  it("shares the canonical page, else this page without query / hash", () => {
    const page = { origin: "http://localhost:5173", pathname: "/rdstr/" };
    expect(sharePageUrl("https://roadster.sebayaki.com/", page)).toBe(
      "https://roadster.sebayaki.com/"
    );
    expect(sharePageUrl(undefined, page)).toBe("http://localhost:5173/rdstr/");
    expect(sharePageUrl("", page)).toBe("http://localhost:5173/rdstr/");
  });

  it("builds an encoded tweet intent link", () => {
    const text = "I landed a BACKFLIP — 1,000 pts. #RDSTRStunts";
    const url = shareUrl(text, "https://roadster.sebayaki.com/?a=1&b=2");
    expect(url.startsWith("https://twitter.com/intent/tweet?text=")).toBe(true);
    // The hashtag must not turn into a fragment, nor the page's & into intent params.
    expect(url).toContain("%23RDSTRStunts");
    expect(new URL(url).hash).toBe("");
    const params = new URL(url).searchParams;
    expect([...params.keys()]).toEqual(["text", "url"]);
    expect(params.get("text")).toBe(text);
    expect(params.get("url")).toBe("https://roadster.sebayaki.com/?a=1&b=2");
  });
});

describe("device-aware control wording", () => {
  it("uses the scheme's names in hints", () => {
    expect(hintSegments("go", "keyboard")).toContainEqual({ key: "↑" });
    expect(hintSegments("go", "touch")).toContainEqual({ key: "GAS" });
    expect(hintSegments("landSoft", "keyboard")).toContainEqual({
      key: "SPACE",
    });
    expect(hintSegments("landSoft", "touch")).toContainEqual({ key: "THRUST" });
    expect(hintSegments("liftOff", "gamepad")).toContainEqual({ key: "A" });
    expect(hintSegments("flipBack", "touch")).toContainEqual({
      key: "◀",
      icon: "ccw",
    });
  });

  it("lists every control in each cheat sheet", () => {
    const keys = (scheme: "keyboard" | "touch" | "gamepad") =>
      cheatSheet(scheme).flatMap((row) =>
        row.keys.map((k) => (typeof k === "string" ? k : k.key))
      );
    expect(keys("keyboard")).toEqual(
      expect.arrayContaining(["↑", "↓", "SPACE", "←", "→", "R", "ESC"])
    );
    expect(keys("touch")).toEqual(
      expect.arrayContaining(["GAS", "BRAKE", "THRUST", "◀", "▶"])
    );
    expect(keys("gamepad")).toEqual(
      expect.arrayContaining(["RT", "LT", "A", "Y", "START"])
    );
  });

  it("shows keycaps on overlay buttons except on touch", () => {
    expect(buttonKey("keyboard", "retry")).toBe("R");
    expect(buttonKey("gamepad", "retry")).toBe("Y");
    expect(buttonKey("touch", "retry")).toBeNull();
  });
});
