/** Device-aware control names for the menu cheat sheet, hints and button keycaps. */
import type { SpinAxis } from "@/core/types";
import { countGamepads } from "@/input/mapping";

export type ControlScheme = "keyboard" | "touch" | "gamepad";

/** Text, or a key / button chip (`icon` draws the touch spin glyph instead of text). */
export type HintSegment = string | { key: string; icon?: "ccw" | "cw" };

export type HintId = "go" | "flipBack" | "roll" | "landSoft" | "liftOff";

export interface CheatRow {
  label: string;
  keys: HintSegment[];
}

export function detectScheme(isTouch: boolean): ControlScheme {
  if (isTouch) return "touch";
  return countGamepads() > 0 ? "gamepad" : "keyboard";
}

const CCW: HintSegment = { key: "◀", icon: "ccw" };
const CW: HintSegment = { key: "▶", icon: "cw" };

/** Name of the gas / thrust / spin inputs per scheme. */
const NAMES: Record<
  ControlScheme,
  {
    gas: HintSegment;
    thrust: HintSegment;
    left: HintSegment;
    right: HintSegment;
  }
> = {
  keyboard: {
    gas: { key: "↑" },
    thrust: { key: "SPACE" },
    left: { key: "←" },
    right: { key: "→" },
  },
  touch: {
    gas: { key: "GAS" },
    thrust: { key: "THRUST" },
    left: CCW,
    right: CW,
  },
  gamepad: {
    gas: { key: "RT" },
    thrust: { key: "A" },
    left: { key: "◀" },
    right: { key: "▶" },
  },
};

/** Contextual coaching line, e.g. ["Hold", {key: "↑"}, "to go"]. */
export function hintSegments(id: HintId, scheme: ControlScheme): HintSegment[] {
  const n = NAMES[scheme];
  switch (id) {
    case "go":
      return ["Hold", n.gas, "to go"];
    case "flipBack":
      return ["Hold", n.left, "to flip back"];
    case "roll":
      return ["Hold", n.left, "or", n.right, "to roll"];
    case "landSoft":
      return ["Hold", n.thrust, "to land soft"];
    case "liftOff":
      return ["Hold", n.thrust, "to lift off"];
  }
}

/** Rows of the menu's controls cheat sheet. */
export function cheatSheet(scheme: ControlScheme): CheatRow[] {
  switch (scheme) {
    case "keyboard":
      return [
        { label: "Gas", keys: [{ key: "↑" }, { key: "W" }] },
        { label: "Brake · reverse", keys: [{ key: "↓" }, { key: "S" }] },
        { label: "Thrusters", keys: [{ key: "SPACE" }] },
        {
          label: "Flip · roll",
          keys: [{ key: "←" }, { key: "→" }, { key: "A" }, { key: "D" }],
        },
        { label: "Restart · pause", keys: [{ key: "R" }, { key: "ESC" }] },
        {
          label: "Camera · mute · units",
          keys: [{ key: "C" }, { key: "M" }, { key: "U" }],
        },
      ];
    case "touch":
      return [
        { label: "Gas · brake", keys: [{ key: "GAS" }, { key: "BRAKE" }] },
        { label: "Thrusters", keys: [{ key: "THRUST" }] },
        { label: "Flip · roll", keys: [CCW, CW] },
        { label: "Pause · restart", keys: [{ key: "❚❚" }] },
      ];
    case "gamepad":
      return [
        { label: "Gas · brake", keys: [{ key: "RT" }, { key: "LT" }] },
        { label: "Thrusters", keys: [{ key: "A" }] },
        { label: "Flip · roll", keys: [{ key: "L-STICK" }, { key: "D-PAD" }] },
        { label: "Restart · pause", keys: [{ key: "Y" }, { key: "START" }] },
      ];
  }
}

export const SCHEME_LABEL: Record<ControlScheme, string> = {
  keyboard: "Keyboard",
  touch: "Touch",
  gamepad: "Gamepad",
};

/** Keycap shown on overlay buttons (none on touch). */
export function buttonKey(
  scheme: ControlScheme,
  button: "retry" | "resume" | "restart" | "play"
): string | null {
  if (scheme === "touch") return null;
  const keyboard = { retry: "R", resume: "ESC", restart: "R", play: "ENTER" };
  const gamepad = { retry: "Y", resume: "START", restart: "Y", play: "A" };
  return (scheme === "keyboard" ? keyboard : gamepad)[button];
}

/** Caption of the spin axis on the rotation dial and over the touch spin buttons. */
export function axisLabel(axis: SpinAxis): string {
  return axis === "pitch" ? "FLIP" : "ROLL";
}
