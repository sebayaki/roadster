import type { CameraMode } from "@/render/camera-rig";

/**
 * Run flow: menu → ready → running → landed | wrecked → result.
 * Pausing is a separate flag that overlays ready / running / landed / wrecked.
 */
export type RunState =
  | "menu" // title cards over the silent attract demo
  | "ready" // car at spawn, waiting for gas
  | "running" // physics on, player in control
  | "landed" // scored touchdown, auto-braking
  | "wrecked" // crashed, tumbling
  | "result"; // result card

/** What `__game.state()` reports: the run state, or "paused" over it. */
export type GameState = RunState | "paused";

export const CAMERA_MODE: Record<RunState, CameraMode> = {
  menu: "attract",
  ready: "ready",
  running: "follow",
  landed: "follow",
  wrecked: "wreck",
  result: "result",
};

/** States where the in-run HUD and the touch controls are shown. */
export function inRun(state: RunState): boolean {
  return (
    state === "ready" ||
    state === "running" ||
    state === "landed" ||
    state === "wrecked"
  );
}

/** States whose physics keeps stepping (the menu demo is handled separately). */
export function stepsPhysics(state: RunState): boolean {
  return (
    state === "running" ||
    state === "landed" ||
    state === "wrecked" ||
    state === "result"
  );
}
