import type { InputAction } from "@/core/types";

/**
 * Window event that injects an action into Input's queue (detail: InputAction).
 * The HUD's on-screen buttons (pause, mute, units) use it, so the App sees
 * them exactly like the matching keys.
 */
export const ACTION_EVENT = "rdstr:action";

/**
 * Cancelable window event Input dispatches for each keyboard / gamepad action
 * before queueing it (detail: InputAction). An overlay that handles the action
 * itself (menu, pause or result card) calls preventDefault() to claim it, and
 * the action is then not queued for the App.
 */
export const INPUT_EVENT = "rdstr:input";

const ACTIONS: ReadonlySet<string> = new Set<InputAction>([
  "confirm",
  "back",
  "restart",
  "pause",
  "camera",
  "mute",
  "units",
]);

export function isInputAction(value: unknown): value is InputAction {
  return typeof value === "string" && ACTIONS.has(value);
}

/** Queue `action` in Input as if its key had been pressed (used by on-screen HUD buttons). */
export function dispatchAction(action: InputAction): void {
  window.dispatchEvent(
    new CustomEvent<InputAction>(ACTION_EVENT, { detail: action })
  );
}

/** Announce an action to overlays; returns true when one of them claimed it. */
export function announceAction(action: InputAction): boolean {
  const event = new CustomEvent<InputAction>(INPUT_EVENT, {
    detail: action,
    cancelable: true,
  });
  return !window.dispatchEvent(event);
}
