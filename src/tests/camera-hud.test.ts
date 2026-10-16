import { afterAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { backflipLevel } from "@/levels/backflip";
import { CarPhysics } from "@/physics/car-physics";
import { CameraRig } from "@/render/camera-rig";

// A phone in landscape: the rig sizes the HUD strip from the window.
vi.stubGlobal("window", { innerWidth: 844, innerHeight: 390 });
afterAll(() => {
  vi.unstubAllGlobals();
});

/** Elevation of the view direction in the backflip ready shot (rad, < 0 looks down). */
function readyElevation(touchHud: boolean): number {
  const camera = new THREE.PerspectiveCamera(55, 844 / 390);
  const rig = new CameraRig(camera, touchHud);
  rig.setLevel(backflipLevel);
  rig.setMode("ready");
  rig.snap(new CarPhysics(backflipLevel).car);
  return Math.asin(camera.getWorldDirection(new THREE.Vector3()).y);
}

describe("camera rig HUD strip", () => {
  it("frames the car above the HUD the App shows", () => {
    // The desktop cluster (160 px) would cover the car, so that shot looks
    // further down; the touch HUD's slim bar (72 px) leaves the framing alone.
    expect(readyElevation(false)).toBeLessThan(readyElevation(true) - 0.02);
  });
});
