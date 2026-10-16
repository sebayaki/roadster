import { AudioEngine } from "@/audio/audio-engine";
import { clamp } from "@/core/math";
import {
  loadBestScores,
  loadSettings,
  saveSettings,
  submitScore,
  type Settings,
} from "@/core/storage";
import type {
  CarSnapshot,
  Controls,
  CrashReason,
  InputAction,
  LandingResult,
  LevelDef,
  LevelId,
  PhysicsEvent,
} from "@/core/types";
import { Input } from "@/input/input";
import { getLevel, LEVEL_ORDER, nextLevel } from "@/levels";
import { createAutopilot } from "@/physics/autopilot";
import { CarPhysics } from "@/physics/car-physics";
import { CameraRig } from "@/render/camera-rig";
import { FxSystem } from "@/render/fx";
import { Renderer } from "@/render/renderer";
import { RoadsterModel } from "@/render/roadster-model";
import { buildScenery, type Scenery } from "@/render/scenery";
import { Hud } from "@/ui/hud";
import { AttractDemo } from "./attract-demo";
import { bindBrowserEvents } from "./browser-events";
import {
  installDebugHooks,
  mergePose,
  type DebugDriver,
  type GameStateInfo,
} from "./debug-hooks";
import { DebugOverlay } from "./debug-overlay";
import { presentEvent, type Presenters } from "./event-presenter";
import { readParams } from "./params";
import { CAMERA_MODE, inRun, stepsPhysics, type RunState } from "./run-state";

/** Longest simulated frame (s); slower frames play in slow motion. */
const MAX_DT = 1 / 20;
/** Fixed frame of `__game.advance` (s). */
const DEBUG_DT = 1 / 60;
/** Pause between `settled` and the result card (s) so the landing callouts can play. */
const RESULT_DELAY = 0.5;
/** Autopiloted runs leave the start line after this long (s). */
const AUTOPILOT_START = 0.5;

type Driver = (car: CarSnapshot, dt: number) => Controls;

const NEUTRAL: Readonly<Controls> = Object.freeze({
  throttle: 0,
  brake: 0,
  thrust: false,
  spin: 0,
});

/**
 * Game director: owns the renderer, level loading, the run state machine
 * (menu → ready → running → result, plus pause) and the frame loop that feeds
 * physics events to the HUD, FX, audio and camera.
 */
export class App {
  private readonly params = readParams();
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input: Input;
  private readonly audio = new AudioEngine();
  private readonly cameraRig: CameraRig;
  private readonly roadster: RoadsterModel;
  private readonly fx: FxSystem;
  private readonly presenters: Presenters;
  private readonly debugOverlay: DebugOverlay | null;
  /** Built once per level and kept, so menu demo cuts and level switches do not rebuild. */
  private readonly sceneries = new Map<LevelId, Scenery>();
  private readonly demo = new AttractDemo();

  private settings: Settings = loadSettings();
  private best = loadBestScores();
  private level: LevelDef;
  private physics: CarPhysics;
  private scenery: Scenery | null = null;
  private state: RunState = "menu";
  private paused = false;
  /** Drives the menu demo or an autopiloted run; null while the player drives. */
  private autopilot: Driver | null = null;
  private lastPlayed: LevelId | null = null;

  // Current run.
  private landing: LandingResult | null = null;
  private crash: { reason: CrashReason; obstacle?: string } | null = null;
  private newBest = false;
  private launched = false;
  private rollbackWarned = false;
  private resultDelay = -1;

  private time = 0;
  private stateTime = 0;
  private lastFrameTime = -1;
  private frames = 0;
  private needsRender = true;
  /** Debug: game logic only advances through `__game.advance`. */
  private manual = false;
  private poseOverride: CarSnapshot | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    const { scene, camera, quality } = this.renderer;
    this.hud = new Hud(uiRoot);
    this.input = new Input(uiRoot);
    this.cameraRig = new CameraRig(camera);
    this.roadster = new RoadsterModel(quality);
    scene.add(this.roadster.root);
    this.fx = new FxSystem(scene, quality);
    this.presenters = {
      hud: this.hud,
      fx: this.fx,
      audio: this.audio,
      camera: this.cameraRig,
    };
    this.debugOverlay = this.params.debug ? new DebugOverlay() : null;
    if (this.debugOverlay) scene.add(this.debugOverlay.root);

    this.audio.setMuted(this.settings.muted);
    this.hud.setMuted(this.settings.muted);
    this.level = getLevel(this.params.level ?? LEVEL_ORDER[0]);
    this.physics = new CarPhysics(this.level);
    installDebugHooks({
      play: (id) => this.startRun(id),
      advance: (seconds, driver) => this.advance(seconds, driver ?? null),
      state: () => this.stateInfo(),
      car: () => structuredClone(this.viewCar()),
      realtime: (on) => {
        this.manual = !on;
      },
      level: () => this.level,
      pose: (fields) => {
        this.poseOverride = fields ? mergePose(this.viewCar(), fields) : null;
      },
    });
  }

  start(): void {
    bindBrowserEvents({
      gesture: () => this.audio.unlock(),
      visibility: (hidden) => this.onVisibility(hidden),
      resize: () => {
        this.renderer.resize();
        this.needsRender = true;
      },
    });
    if (this.params.level) this.startRun(this.params.level);
    else this.enterMenu();
    this.renderer.gl.setAnimationLoop(this.frame);
  }

  // ---------------------------------------------------------------- frame loop

  private readonly frame = (now: number): void => {
    const dt =
      this.lastFrameTime < 0
        ? 0
        : clamp((now - this.lastFrameTime) / 1000, 0, MAX_DT);
    this.lastFrameTime = now;
    if (!this.manual) {
      this.input.update();
      for (const action of this.input.drainActions()) this.onAction(action);
      if (!this.paused) {
        this.tick(dt, null);
        this.needsRender = true;
      }
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render();
      if (++this.frames === 3) {
        window.__snapReady = true;
        this.prebuildSceneries();
      }
    }
  };

  /** One frame of game logic: controls → physics → events → visuals. */
  private tick(dt: number, driver: DebugDriver | null): void {
    this.time += dt;
    this.stateTime += dt;
    if (this.state === "menu") {
      // Attract demo; with ?demo=0 there is no autopilot and the car stays parked.
      if (this.autopilot) {
        this.physics.step(dt, this.autopilot(this.physics.car, dt));
      }
    } else if (this.state === "ready") {
      if (this.readyToGo(driver)) {
        this.enterState("running");
        this.physics.step(dt, this.runControls(dt, driver));
      }
    } else if (stepsPhysics(this.state)) {
      const controls =
        this.state === "result" ? NEUTRAL : this.runControls(dt, driver);
      this.physics.step(dt, controls);
    }
    for (const event of this.physics.drainEvents()) this.onPhysicsEvent(event);
    this.watchRollback();
    this.updateTimers(dt);
    this.present(dt);
  }

  private readyToGo(driver: DebugDriver | null): boolean {
    if (driver === "autopilot" || (driver === null && this.autopilot)) {
      return this.stateTime >= AUTOPILOT_START;
    }
    const c = driver ?? this.input.controls;
    return c.throttle > 0.05 || c.brake > 0.05 || c.thrust;
  }

  private runControls(dt: number, driver: DebugDriver | null): Controls {
    const car = this.physics.car;
    if (driver === "autopilot") {
      this.autopilot ??= createAutopilot(this.level, "clean");
      return this.autopilot(car, dt);
    }
    if (driver) return driver;
    return this.autopilot ? this.autopilot(car, dt) : this.input.controls;
  }

  /** Model pose → model → FX → audio → camera → scenery → HUD. */
  private present(dt: number): void {
    const car = this.viewCar();
    const { position: p, quaternion: q } = car;
    const root = this.roadster.root;
    root.position.set(p.x, p.y, p.z);
    root.quaternion.set(q.x, q.y, q.z, q.w);
    root.updateMatrixWorld(true);
    this.roadster.update(dt, car);
    this.debugOverlay?.update(car);
    this.fx.update(dt, car, this.roadster, this.renderer.camera);
    const running = inRun(this.state);
    this.audio.update(dt, running ? car : null);
    this.cameraRig.update(dt, car);
    this.scenery?.update(dt, this.time, p);
    if (running) this.hud.update(car, this.level, this.settings.units);
  }

  private viewCar(): CarSnapshot {
    return this.poseOverride ?? this.physics.car;
  }

  // ------------------------------------------------------------ state machine

  private enterState(next: RunState): void {
    this.state = next;
    this.stateTime = 0;
    this.cameraRig.setMode(CAMERA_MODE[next]);
    this.input.setTouchControlsVisible(inRun(next) && !this.paused);
  }

  private loadLevel(id: LevelId): void {
    this.level = getLevel(id);
    const scenery = this.sceneryFor(this.level);
    if (scenery !== this.scenery) {
      const scene = this.renderer.scene;
      if (this.scenery) scene.remove(this.scenery.root);
      scene.add(scenery.root);
      scene.fog = scenery.fog;
      this.scenery = scenery;
    }
    this.physics = new CarPhysics(this.level);
    this.poseOverride = null;
    this.cameraRig.setLevel(this.level);
    this.input.setSpinAxis(this.level.spinAxis);
    this.fx.clear();
  }

  /** The level's scenery, built on first use and then kept. */
  private sceneryFor(level: LevelDef): Scenery {
    let scenery = this.sceneries.get(level.id);
    if (!scenery) {
      scenery = buildScenery(level, this.renderer.quality);
      this.sceneries.set(level.id, scenery);
    }
    return scenery;
  }

  /**
   * Builds the other levels' scenery once, in idle time after the first
   * frames, so the first demo cut or level switch skips the build. A level
   * loaded before the callback runs is already cached and is skipped.
   */
  private prebuildSceneries(): void {
    const build = (): void => {
      for (const id of LEVEL_ORDER) this.sceneryFor(getLevel(id));
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(build, { timeout: 1000 });
    } else {
      setTimeout(build, 300);
    }
  }

  private startRun(id: LevelId): void {
    this.setPaused(false);
    this.loadLevel(id);
    this.lastPlayed = id;
    const style = this.params.autopilot;
    this.autopilot = style ? createAutopilot(this.level, style) : null;
    this.landing = null;
    this.crash = null;
    this.newBest = false;
    this.launched = false;
    this.rollbackWarned = false;
    this.resultDelay = -1;
    this.hud.showRun(this.level, this.input.isTouch);
    this.enterState("ready");
    this.cameraRig.snap(this.physics.car);
  }

  private enterMenu(): void {
    this.setPaused(false);
    this.resultDelay = -1;
    this.startDemo();
    this.enterState("menu");
    this.cameraRig.snap(this.physics.car);
    this.showMenu();
  }

  /** Loads the current attract entry; with `?demo=0` the car just waits at the start. */
  private startDemo(): void {
    const entry = this.demo.entry;
    this.loadLevel(entry.level);
    this.autopilot = this.params.demo
      ? createAutopilot(this.level, entry.style)
      : null;
    this.demo.restart();
  }

  private showMenu(): void {
    this.hud.showMenu({
      levels: LEVEL_ORDER.map(getLevel),
      best: this.best,
      muted: this.settings.muted,
      units: this.settings.units,
      isTouch: this.input.isTouch,
      onPlay: (id) => this.fromUi(() => this.startRun(id)),
      onToggleMute: () => this.fromUi(() => this.toggleMute()),
      onToggleUnits: () => this.fromUi(() => this.toggleUnits()),
    });
  }

  private showResult(): void {
    this.resultDelay = -1;
    this.enterState("result");
    this.audio.play("result");
    const id = this.level.id;
    this.hud.showResult({
      level: this.level,
      landing: this.landing,
      crash: this.crash,
      best: this.best[id] ?? 0,
      isNewBest: this.newBest,
      units: this.settings.units,
      onRetry: () => this.fromUi(() => this.startRun(id)),
      onNext: () => this.fromUi(() => this.startRun(nextLevel(id))),
      onMenu: () => this.fromUi(() => this.enterMenu()),
    });
  }

  private setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.needsRender = true;
    if (paused) {
      this.audio.suspend();
      this.input.setTouchControlsVisible(false);
      this.hud.showPause({
        onResume: () => this.fromUi(() => this.setPaused(false)),
        onRestart: () => this.fromUi(() => this.startRun(this.level.id)),
        onMenu: () => this.fromUi(() => this.enterMenu()),
      });
    } else {
      this.hud.hidePause();
      if (!document.hidden) this.audio.resume();
      this.input.setTouchControlsVisible(inRun(this.state));
    }
  }

  private onPhysicsEvent(e: PhysicsEvent): void {
    const demo = this.state === "menu";
    presentEvent(e, this.presenters, demo);
    if (demo) {
      if (e.type === "settled") this.demo.settled();
      return;
    }
    switch (e.type) {
      case "launch":
        this.launched = true;
        break;
      case "land":
        this.landing = e.result;
        // Autopiloted runs (?autopilot=, advance(…, "autopilot")) never set a best.
        if (!this.autopilot) {
          this.newBest = submitScore(this.level.id, e.result.score.total);
          this.best = loadBestScores();
        }
        if (this.state === "running") this.enterState("landed");
        break;
      case "crash":
        this.landing = null;
        this.crash = { reason: e.reason, obstacle: e.obstacle };
        if (this.state === "running" || this.state === "landed") {
          this.enterState("wrecked");
        }
        break;
      case "settled":
        if (this.state === "landed" || this.state === "wrecked") {
          this.resultDelay = RESULT_DELAY;
        }
        break;
    }
  }

  /** Backflip: tell the player when the car runs out of speed on the Curl and rolls back. */
  private watchRollback(): void {
    if (this.state !== "running" || this.launched) return;
    if (!this.level.goal.requireRampLaunch) return;
    const car = this.physics.car;
    if (!car.onRamp) {
      this.rollbackWarned = false;
    } else if (car.speed < -0.5 && !this.rollbackWarned) {
      this.rollbackWarned = true;
      this.hud.popup("NOT ENOUGH SPEED", "warn");
    }
  }

  private updateTimers(dt: number): void {
    if (this.state === "menu" && this.params.demo && this.demo.update(dt)) {
      this.demo.next();
      this.startDemo();
      this.cameraRig.snap(this.physics.car);
    }
    if (this.resultDelay >= 0) {
      this.resultDelay -= dt;
      if (this.resultDelay < 0) this.showResult();
    }
  }

  // ------------------------------------------------------------------- input

  private onAction(action: InputAction): void {
    switch (action) {
      case "mute":
        this.toggleMute();
        break;
      case "units":
        this.toggleUnits();
        break;
      case "camera":
        this.cameraRig.cycleFraming();
        break;
      case "restart":
        if (this.state !== "menu") this.startRun(this.level.id);
        break;
      case "pause":
      case "back":
        if (this.paused) this.setPaused(false);
        else if (inRun(this.state)) this.setPaused(true);
        else if (this.state === "result" && action === "back") {
          this.enterMenu();
        }
        break;
      case "confirm":
        if (this.paused) this.setPaused(false);
        else if (this.state === "result") this.startRun(this.level.id);
        else if (this.state === "menu") {
          this.startRun(this.lastPlayed ?? LEVEL_ORDER[0]);
        }
        break;
    }
  }

  /** HUD button callbacks run inside a user gesture: unlock audio and click. */
  private fromUi(action: () => void): void {
    this.audio.unlock();
    action();
    this.audio.play("ui");
  }

  private toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.audio.setMuted(this.settings.muted);
    this.hud.setMuted(this.settings.muted);
    saveSettings(this.settings);
  }

  private toggleUnits(): void {
    this.settings.units =
      this.settings.units === "metric" ? "imperial" : "metric";
    saveSettings(this.settings);
    // The HUD switches its own run / result / pause views; the menu takes a refresh.
    if (this.state === "menu") this.showMenu();
  }

  private onVisibility(hidden: boolean): void {
    this.lastFrameTime = -1;
    if (hidden) {
      if (inRun(this.state)) this.setPaused(true);
      this.audio.suspend();
    } else if (!this.paused) {
      this.audio.resume();
    }
  }

  // ------------------------------------------------------------------- debug

  private advance(seconds: number, driver: DebugDriver | null): GameStateInfo {
    this.manual = true;
    const frames = Math.max(0, Math.round(seconds / DEBUG_DT));
    for (let i = 0; i < frames && !this.paused; i++)
      this.tick(DEBUG_DT, driver);
    this.renderer.render();
    return this.stateInfo();
  }

  private stateInfo(): GameStateInfo {
    const cam = this.renderer.camera;
    const menu = this.state === "menu";
    return {
      state: this.paused ? "paused" : this.state,
      level: this.level.id,
      demo: menu && this.params.demo ? { ...this.demo.entry } : null,
      autopilot: !menu && this.autopilot !== null,
      manual: this.manual,
      time: this.time,
      stateTime: this.stateTime,
      camera: {
        position: [cam.position.x, cam.position.y, cam.position.z],
        fov: cam.fov,
      },
      landing: this.landing,
      crash: this.crash,
      best: { ...this.best },
      settings: { ...this.settings },
    };
  }
}
