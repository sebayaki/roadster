import type { LevelId } from "@/core/types";
import { LEVEL_ORDER } from "@/levels";
import type { AutopilotStyle } from "@/physics/autopilot";

/**
 * URL switches read by the App. Two more are read where they apply:
 * `?quality=low|high` forces a render tier (the renderer's detectQuality) and
 * `?touch=1|0` forces the on-screen touch controls and touch HUD on or off (Input).
 */
export interface AppParams {
  /** `?level=backflip|kickflip`: skip the menu and start that run. */
  level: LevelId | null;
  /** `?autopilot=1|clean|double`: runs are driven by the autopilot. */
  autopilot: AutopilotStyle | null;
  /** `?demo=0` disables the attract demo behind the menu. */
  demo: boolean;
  /** `?debug=1` draws the car's collision box and local axes (DebugOverlay). */
  debug: boolean;
}

export function readParams(search: string = location.search): AppParams {
  const q = new URLSearchParams(search);
  const level = q.get("level");
  const autopilot = q.get("autopilot");
  return {
    level: LEVEL_ORDER.find((id) => id === level) ?? null,
    autopilot:
      autopilot === "double"
        ? "double"
        : autopilot === "1" || autopilot === "clean" || autopilot === "true"
          ? "clean"
          : null,
    demo: q.get("demo") !== "0",
    debug: q.get("debug") === "1",
  };
}
