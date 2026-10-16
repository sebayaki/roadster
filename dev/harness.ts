/**
 * Shared harness for dev preview pages (dev/*.html). Renders with the game's
 * Renderer so materials, bloom and tone mapping match the real game.
 *
 * URL params:
 *   ?view=<name>     camera preset (first preset is the default)
 *   ?t=<seconds>     advance update() by this much game time before the first frame
 *   ?quality=low     render with the low quality tier
 *   ?freeze=1        stop advancing time after the first frame (stable snapshots)
 *
 * `window.__harness` exposes { scene, camera, renderer, setView(name), step(seconds) }
 * for `scripts/snap.mjs --eval`. `window.__snapReady` turns true after the first frames.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Renderer } from "@/render/renderer";
import type { Quality } from "@/core/types";

export interface View {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface HarnessContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  params: URLSearchParams;
  quality: Quality;
}

export interface HarnessOptions {
  /** Named camera presets selectable with ?view=name. */
  views: Record<string, View>;
  setup(ctx: HarnessContext): void | Promise<void>;
  update?(dt: number, time: number, ctx: HarnessContext): void;
}

declare global {
  interface Window {
    __snapReady?: boolean;
    __harness?: {
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      renderer: Renderer;
      setView(name: string): void;
      step(seconds: number): void;
    };
  }
}

export async function runHarness(opts: HarnessOptions): Promise<void> {
  document.body.style.cssText =
    "margin:0;height:100vh;overflow:hidden;background:#000";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100vw;height:100vh";
  document.body.appendChild(canvas);

  const params = new URLSearchParams(location.search);
  const quality: Quality = params.get("quality") === "low" ? "low" : "high";
  const renderer = new Renderer(canvas, quality);
  const { scene, camera } = renderer;
  const ctx: HarnessContext = { scene, camera, renderer, params, quality };
  await opts.setup(ctx);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const setView = (name: string) => {
    const view = opts.views[name] ?? Object.values(opts.views)[0];
    if (!view) return;
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    camera.fov = view.fov ?? 45;
    camera.updateProjectionMatrix();
    controls.update();
  };
  setView(params.get("view") ?? "");

  let time = 0;
  const step = (seconds: number) => {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      time += dt;
      opts.update?.(dt, time, ctx);
    }
  };
  step(Number(params.get("t") ?? 0));

  window.__harness = { scene, camera, renderer, setView, step };
  window.addEventListener("resize", () => renderer.resize());

  const freeze = params.get("freeze") === "1";
  const timer = new THREE.Timer();
  let frames = 0;
  renderer.gl.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    if (!freeze) {
      time += dt;
      opts.update?.(dt, time, ctx);
    }
    controls.update();
    renderer.render();
    if (++frames === 3) window.__snapReady = true;
  });
}
