import * as THREE from "three";
import type { Settings } from "@/core/storage";
import type {
  CarSnapshot,
  Controls,
  CrashReason,
  LandingResult,
  LevelDef,
  LevelId,
} from "@/core/types";
import type { DemoEntry } from "./attract-demo";
import type { GameState } from "./run-state";

/** Who drives during `advance`: the level autopilot or fixed controls. */
export type DebugDriver = "autopilot" | Controls;

/** JSON-friendly summary returned by `__game.state()`. */
export interface GameStateInfo {
  state: GameState;
  level: LevelId;
  /** The attract demo entry while the menu is up. */
  demo: DemoEntry | null;
  /** The run is driven by the autopilot. */
  autopilot: boolean;
  /** Real-time stepping is frozen (after `advance`). */
  manual: boolean;
  time: number;
  stateTime: number;
  camera: { position: [number, number, number]; fov: number };
  landing: LandingResult | null;
  crash: { reason: CrashReason; obstacle?: string } | null;
  best: Partial<Record<LevelId, number>>;
  settings: Settings;
}

/** Hooks on `window.__game` for headless snapshots and debugging (always installed). */
export interface GameDebugApi {
  /** Start a run of that level, like PLAY on the menu. */
  play(id: LevelId): void;
  /**
   * Step the whole game logic in fixed 1/60 s frames, then render once.
   * Freezes real-time stepping so a later screenshot shows exactly this frame.
   */
  advance(seconds: number, driver?: DebugDriver): GameStateInfo;
  state(): GameStateInfo;
  /** Copy of the car snapshot being rendered. */
  car(): CarSnapshot;
  /** Resume (true) or freeze (false) real-time stepping. */
  realtime(on: boolean): void;
  /** The current level definition (profile, obstacles) for eval scripts. */
  level(): LevelDef;
  /**
   * Render the car with these snapshot fields instead of the physics state
   * (merged over the previous override); `pitch` / `roll` without a
   * `quaternion` derive it. `null` hands the car back to physics.
   */
  pose(fields: Partial<CarSnapshot> | null): void;
}

declare global {
  interface Window {
    __game?: GameDebugApi;
    __snapReady?: boolean;
  }
}

export function installDebugHooks(api: GameDebugApi): void {
  window.__game = api;
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();

/** Merges a debug pose override over `base` (a physics snapshot or a previous override). */
export function mergePose(
  base: CarSnapshot,
  fields: Partial<CarSnapshot>
): CarSnapshot {
  const out: CarSnapshot = { ...structuredClone(base), ...fields };
  if (
    fields.quaternion === undefined &&
    (fields.pitch !== undefined || fields.roll !== undefined)
  ) {
    // Orientation = qZ(pitch) * qX(roll), see core/types.ts.
    quat.setFromEuler(euler.set(out.roll, 0, out.pitch, "ZXY"));
    out.quaternion = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
  }
  return out;
}
