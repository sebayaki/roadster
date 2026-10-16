import type { InputAction } from "@/core/types";

/** Held controls a key, touch button or gamepad input can drive. */
export type HoldControl = "gas" | "brake" | "thrust" | "left" | "right";

export const HOLD_CONTROLS: readonly HoldControl[] = [
  "gas",
  "brake",
  "thrust",
  "left",
  "right",
];

/** Keyboard `code`s (layout independent) for held controls. */
export const KEY_HOLD: Partial<Record<string, HoldControl>> = {
  ArrowUp: "gas",
  KeyW: "gas",
  ArrowDown: "brake",
  KeyS: "brake",
  Space: "thrust",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

/** Keyboard `code`s for edge-triggered actions (Space also confirms on overlays, see Input). */
export const KEY_ACTIONS: Partial<Record<string, InputAction>> = {
  Enter: "confirm",
  NumpadEnter: "confirm",
  KeyR: "restart",
  Escape: "pause",
  KeyP: "pause",
  KeyC: "camera",
  KeyM: "mute",
  KeyU: "units",
};

/** Keys whose browser default (page scroll) is suppressed. */
export const KEY_PREVENT_DEFAULT: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

/** Button indices of the W3C "standard" gamepad mapping. */
export const PAD = {
  A: 0,
  B: 1,
  Y: 3,
  LT: 6,
  RT: 7,
  START: 9,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/** Edge-triggered gamepad buttons (A is handled separately: thrust + confirm). */
export const PAD_ACTIONS: ReadonlyArray<readonly [number, InputAction]> = [
  [PAD.B, "back"],
  [PAD.Y, "restart"],
  [PAD.START, "pause"],
];

/** navigator.getGamepads(), or null where the API is missing or blocked by a permissions policy. */
export function readGamepads(): (Gamepad | null)[] | null {
  try {
    return navigator.getGamepads ? navigator.getGamepads() : null;
  } catch {
    return null;
  }
}

/** Connected gamepads (browsers expose a pad after its first button press). */
export function countGamepads(): number {
  let count = 0;
  for (const pad of readGamepads() ?? []) if (pad?.connected) count += 1;
  return count;
}

export const STICK_DEADZONE = 0.22;
export const TRIGGER_DEADZONE = 0.06;

/** Rescale an analog value so it starts at 0 at the deadzone edge and reaches ±1 at full travel. */
export function applyDeadzone(value: number, deadzone: number): number {
  const a = Math.abs(value);
  if (a <= deadzone) return 0;
  return Math.sign(value) * Math.min(1, (a - deadzone) / (1 - deadzone));
}

/** Left-stick X (-1..1) to spin (-1..1). */
export function stickToSpin(x: number): number {
  return applyDeadzone(x, STICK_DEADZONE);
}

/** Analog trigger (0..1) to throttle / brake (0..1). */
export function triggerToPedal(value: number): number {
  return Math.max(0, applyDeadzone(value, TRIGGER_DEADZONE));
}

/** Elements that handle Enter / Space themselves (native button activation). */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  return (
    target.closest(
      "button, a[href], input, select, textarea, [contenteditable=''], [contenteditable='true']"
    ) !== null
  );
}
