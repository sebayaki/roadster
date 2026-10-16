import type { LevelId } from "@/core/types";
import type { AutopilotStyle } from "@/physics/autopilot";

/** URL switches (`?quality=` is read by the renderer's detectQuality). */
export interface AppParams {
  /** `?level=backflip|kickflip`: skip the menu and start that run. */
  level: LevelId | null;
  /** `?autopilot=1|clean|double`: runs are driven by the autopilot. */
  autopilot: AutopilotStyle | null;
  /** `?demo=0` disables the attract demo behind the menu. */
  demo: boolean;
  /** `?debug=1` draws a wireframe box at the car pose. */
  debug: boolean;
}

export function readParams(search: string = location.search): AppParams {
  const q = new URLSearchParams(search);
  const level = q.get("level");
  const autopilot = q.get("autopilot");
  return {
    level: level === "backflip" || level === "kickflip" ? level : null,
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
