import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Quality } from "@/core/types";
import { PALETTE } from "./palette";

/** `?quality=low|high` overrides; otherwise phones/tablets get "low". */
export function detectQuality(): Quality {
  const forced = new URLSearchParams(location.search).get("quality");
  if (forced === "low" || forced === "high") return forced;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 900;
  return coarse && small ? "low" : "high";
}

/**
 * WebGL renderer + post-processing shared by the game and the dev preview pages,
 * so every module is judged under the same tone mapping, bloom and reflections.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  readonly quality: Quality;
  private readonly composer: EffectComposer;
  /** PMREM render target holding scene.environment. */
  private readonly envTarget: THREE.WebGLRenderTarget;

  constructor(canvas: HTMLCanvasElement, quality: Quality = detectQuality()) {
    this.quality = quality;
    const high = quality === "high";
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = high;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(PALETTE.sky);
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.35;
    room.dispose();
    pmrem.dispose();

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: high ? 4 : 0,
    });
    this.composer = new EffectComposer(this.gl, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Strength, radius and threshold: bloom picks up linear luminance above
    // 0.82 in the HDR image, before OutputPass tone-maps it.
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.5, 0.82)
    );
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  /** Match the canvas' CSS size; call on window resize / orientation change. */
  resize(): void {
    const canvas = this.gl.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      this.quality === "high" ? 2 : 1.25
    );
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.composer.render();
  }

  /** Frees the GPU resources created here (not the scene's content). */
  dispose(): void {
    // EffectComposer.dispose() frees only its own buffers, not the passes'.
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.envTarget.dispose();
    this.gl.dispose();
  }
}
