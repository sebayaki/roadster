import type { AudioEngine } from "@/audio/audio-engine";
import { clamp } from "@/core/math";
import type { LandingGrade, PhysicsEvent } from "@/core/types";
import type { CameraRig } from "@/render/camera-rig";
import type { FxSystem } from "@/render/fx";
import type { Hud } from "@/ui/hud";

/** Everything a physics event can be shown or heard through. */
export interface Presenters {
  hud: Hud;
  fx: FxSystem;
  audio: AudioEngine;
  camera: CameraRig;
}

const GRADE_TEXT: Record<LandingGrade, string> = {
  perfect: "PERFECT LANDING",
  great: "GREAT LANDING",
  good: "GOOD LANDING",
};

/**
 * Turns one physics event into popups, FX bursts, audio cues and camera shake.
 * In the menu attract demo (`demo`) only the FX and a softer shake remain.
 * State changes (landed, wrecked, result) are the App's job.
 */
export function presentEvent(
  e: PhysicsEvent,
  p: Presenters,
  demo: boolean
): void {
  const loud = !demo;
  const shake = demo ? 0.4 : 1;
  switch (e.type) {
    case "launch":
      p.camera.shake((e.fromRamp ? 0.25 : 0.12) * shake);
      if (loud) p.audio.play("launch", e.fromRamp ? 1 : 0.7);
      break;
    case "flip":
      if (loud) {
        p.hud.popup(`${Math.abs(e.turns) * 360}°`, "trick");
        p.audio.play("flip");
      }
      break;
    case "gasEmpty":
      if (loud) {
        p.hud.popup("OUT OF GAS", "warn");
        p.audio.play("gasEmpty");
      }
      break;
    case "land": {
      const r = e.result;
      p.fx.landingBurst(e.position, clamp(0.45 + r.impactSpeed / 10, 0, 1));
      p.camera.shake(clamp(0.2 + r.impactSpeed / 14, 0, 0.7) * shake);
      if (!loud) break;
      p.audio.play("land", clamp(r.impactSpeed / 8, 0.3, 1));
      p.hud.popup(r.trick.name, "trick");
      if (!r.goalMet) {
        p.hud.popup("TOO SHORT", "warn");
      } else {
        p.hud.popup(
          GRADE_TEXT[r.grade],
          r.grade === "perfect" ? "perfect" : "info"
        );
        if (r.grade === "perfect") p.audio.play("perfect");
      }
      break;
    }
    case "crash":
      p.fx.sparks(e.position, clamp(e.impact / 12, 0.4, 1));
      p.fx.crashSmoke(e.position);
      p.camera.shake(0.85 * shake);
      if (loud) {
        p.audio.play("crash", clamp(e.impact / 15, 0.5, 1));
        p.hud.popup("WRECKED", "warn");
      }
      break;
    case "impact":
      p.fx.sparks(e.position, e.intensity);
      p.camera.shake(0.5 * e.intensity * shake);
      if (loud) p.audio.play("impact", e.intensity);
      break;
    // rampEnter / thrustStart / thrustStop: camera, audio and FX read the snapshot.
    // settled: only drives state changes.
  }
}
