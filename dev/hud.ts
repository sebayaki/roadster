/**
 * HUD + input preview: renders every screen of the overlay with fake data on top
 * of the real night venue (or a CSS stand-in), with working buttons and keys.
 *
 * URL params:
 *   ?screen=menu|ready|run|ramp|air|result|crash|short|pause|popup   (default menu)
 *   ?level=backflip|kickflip   ?units=imperial   ?touch=1 (on-screen controls)
 *   ?muted=1      start with the sound toggled off
 *   ?reason=angle|impact|obstacle   crash reason for screen=crash
 *   ?popup=0..3   which callout set screen=popup repeats
 *   ?t=<s>        fake flight time for screen=air (with ?freeze=1 for stable snapshots)
 *   ?bg=css       skip the 3D scenery and use the CSS backdrop
 *
 * `window.__hud` exposes { hud, input, car, setScreen(name) } for scripts/snap.mjs --eval.
 */
import * as THREE from "three";
import type {
  CarSnapshot,
  CrashReason,
  LandingResult,
  LevelDef,
  LevelId,
  Units,
} from "@/core/types";
import { CAR } from "@/core/car-spec";
import { DEG, clamp } from "@/core/math";
import { createCarSnapshot } from "@/core/snapshot";
import { getLevel, LEVEL_ORDER, nextLevel } from "@/levels";
import { Input } from "@/input/input";
import { RoadsterModel } from "@/render/roadster-model";
import { buildScenery } from "@/render/scenery";
import { Hud, type PopupKind } from "@/ui/hud";
import { lineupStartX } from "@/ui/run-view";
import { runHarness, type HarnessContext, type View } from "./harness";

const SCREENS = [
  "ramp",
  "menu",
  "ready",
  "run",
  "air",
  "result",
  "crash",
  "short",
  "pause",
  "popup",
] as const;
type Screen = (typeof SCREENS)[number];

declare global {
  interface Window {
    __hud?: {
      hud: Hud;
      input: Input;
      car: CarSnapshot;
      setScreen(name: Screen): void;
    };
  }
}

const params = new URLSearchParams(location.search);
const requested = params.get("screen") as Screen | null;
let screen: Screen =
  requested && SCREENS.includes(requested) ? requested : "menu";
const levelParam = params.get("level");
let levelId: LevelId =
  levelParam === "backflip" || levelParam === "kickflip"
    ? levelParam
    : screen === "short" || screen === "crash"
      ? "kickflip"
      : "backflip";
let units: Units = params.get("units") === "imperial" ? "imperial" : "metric";
let muted = params.get("muted") === "1";
const frozen = params.get("freeze") === "1";
const best: Partial<Record<LevelId, number>> = { backflip: 8790 };

const root = document.getElementById("ui") as HTMLElement;
const hud = new Hud(root);
const input = new Input(root);
const car = createCarSnapshot();
let paused = false;
/** Fake run time (s): starts at ?t= and runs on the run screens unless frozen. */
let clock = Number(params.get("t") ?? 0);

function level(): LevelDef {
  return getLevel(levelId);
}

/** Fake physics snapshot for the current screen at time t (seconds). */
function fakeCar(t: number): void {
  const l = level();
  const kick = l.spinAxis === "roll";
  const { position, velocity, thrusters } = car;
  Object.assign(car, createCarSnapshot(), { position, velocity, thrusters });
  position.z = 0;
  velocity.z = 0;
  thrusters.fill(0);
  if (screen === "ready") {
    const spawn = l.profile.sample(l.spawnS);
    car.position.x = spawn.x;
    car.position.y = CAR.comHeight;
    car.velocity.x = 0;
    car.velocity.y = 0;
    return;
  }
  if (screen === "air") {
    fakeFlight(t % 4.8, kick);
    return;
  }
  if (screen === "ramp" && !kick) {
    // Climbing the Curl: grounded on the curved section, 70° into the trick.
    car.onRamp = true;
    car.speed = 21;
    car.throttle = 1;
    car.trickPitch = 70 * DEG;
    car.pitch = car.trickPitch;
    const p = l.profile.sample(l.profile.rampStart + 9);
    car.position.x = p.x;
    car.position.y = p.y + CAR.comHeight;
    return;
  }
  // Driving toward the stunt inside the recommended band.
  const target = (l.speedHint[0] + l.speedHint[1]) / 2;
  car.speed = target + Math.sin(t * 0.9) * 1.6;
  car.throttle = 1;
  car.gas = screen === "pause" ? 0.62 : 1;
  car.position.x = kick
    ? lineupStartX(l) - 38 + ((t * 6) % 30)
    : -60 + ((t * 8) % 40);
  car.position.y = CAR.comHeight;
  car.velocity.x = car.speed;
  car.velocity.y = 0;
}

/** A launch → flip → thrust → touchdown arc, looping every 4.8 s. */
function fakeFlight(u: number, kick: boolean): void {
  const landAt = 3.2;
  if (u >= landAt) {
    car.mode = "grounded";
    car.speed = 7;
    car.gas = 0.16;
    car.trickPitch = kick ? 0 : 2 * Math.PI;
    car.trickRoll = kick ? -2 * Math.PI : 0;
    car.pitch = car.trickPitch;
    car.roll = car.trickRoll;
    return;
  }
  car.mode = "airborne";
  car.airTime = u;
  const thrusting = u > 1.9;
  car.gas = thrusting ? clamp(1 - (u - 1.9) / 1.6, 0, 1) : 1;
  car.thrusters.fill(thrusting ? 1 : 0);
  if (kick) {
    car.heightAboveGround = Math.max(0, 6.4 * u - 2.1 * u * u);
    car.velocity.y = 6.4 - 4.2 * u;
    car.trickRoll = -Math.min(2 * Math.PI, u * 3.6);
    car.roll = car.trickRoll;
    car.speed = 19;
  } else {
    car.heightAboveGround = Math.max(0, 23.5 + 4 * u - 4.9 * u * u);
    car.velocity.y = 4 - 9.8 * u;
    car.trickPitch = (168 + Math.min(212, u * 150)) * DEG;
    car.pitch = car.trickPitch;
    car.speed = Math.hypot(9, car.velocity.y);
  }
  car.position.y = car.heightAboveGround + CAR.comHeight;
}

const LANDED: LandingResult = {
  grade: "perfect",
  angleError: 3 * DEG,
  impactSpeed: 2.1,
  trick: { name: "DOUBLE BACKFLIP", pitchTurns: 2, rollTurns: 0 },
  stats: {
    airTime: 3.4,
    maxHeight: 27.8,
    distance: 31.2,
    gasLeft: 0.38,
    topSpeed: 28.6,
  },
  goalMet: true,
  score: {
    trick: 3000,
    air: 510,
    height: 695,
    gas: 190,
    multiplier: 2,
    total: 8790,
  },
};

const SHORT: LandingResult = {
  grade: "great",
  angleError: 12 * DEG,
  impactSpeed: 5.2,
  trick: { name: "KICKFLIP", pitchTurns: 0, rollTurns: -1 },
  stats: {
    airTime: 2.1,
    maxHeight: 6.2,
    distance: 14.6,
    gasLeft: 0.22,
    topSpeed: 21.4,
  },
  goalMet: false,
  score: {
    trick: 0,
    air: 315,
    height: 155,
    gas: 110,
    multiplier: 1,
    total: 580,
  },
};

const POPUP_SETS: Array<Array<[string, PopupKind]>> = [
  [["360°", "info"]],
  [
    ["DOUBLE BACKFLIP", "trick"],
    ["PERFECT LANDING", "perfect"],
  ],
  [["OUT OF GAS", "warn"]],
  [["WRECKED", "warn"]],
];

function firePopups(): void {
  const index = Number(params.get("popup") ?? 1);
  for (const [text, kind] of POPUP_SETS[index] ?? POPUP_SETS[1])
    hud.popup(text, kind);
}

function showMenu(): void {
  paused = false;
  input.setTouchControlsVisible(false);
  hud.showMenu({
    levels: LEVEL_ORDER.map(getLevel),
    best,
    muted,
    units,
    isTouch: input.isTouch,
    onPlay: (id) => {
      console.log(`[hud-dev] play ${id}`);
      levelId = id;
      setScreen("ready");
    },
  });
}

function startRun(): void {
  paused = false;
  const l = level();
  input.setSpinAxis(l.spinAxis);
  input.setTouchControlsVisible(true);
  hud.showRun(l, input.isTouch);
}

function showResult(kind: "result" | "crash" | "short"): void {
  const l = level();
  input.setTouchControlsVisible(false);
  const reason =
    (params.get("reason") as CrashReason | null) ??
    (levelId === "kickflip" ? "obstacle" : "angle");
  if (kind === "crash") {
    // Seed the crash attitude (upside down) like a real run would.
    car.mode = "airborne";
    car.pitch = 172 * DEG;
    car.roll = 0;
    hud.update(car, l, units);
  }
  hud.showResult({
    level: l,
    landing: kind === "result" ? LANDED : kind === "short" ? SHORT : null,
    crash:
      kind === "crash"
        ? { reason, obstacle: reason === "obstacle" ? "Semi" : undefined }
        : null,
    best: kind === "result" ? 8790 : (best[levelId] ?? 0),
    isNewBest: kind === "result",
    units,
    onRetry: () => setScreen("ready"),
    onNext: () => {
      levelId = nextLevel(levelId);
      setScreen("ready");
    },
    onMenu: () => setScreen("menu"),
  });
}

function showPause(): void {
  paused = true;
  hud.showPause({
    onResume: () => {
      paused = false;
      hud.hidePause();
    },
    onRestart: () => setScreen("ready"),
    onMenu: () => setScreen("menu"),
  });
}

function setScreen(next: Screen): void {
  screen = next;
  console.log(`[hud-dev] screen ${screen} (${levelId})`);
  switch (screen) {
    case "menu":
      showMenu();
      break;
    case "result":
    case "crash":
    case "short":
      startRun();
      showResult(screen);
      break;
    case "pause":
      startRun();
      fakeCar(clock);
      hud.update(car, level(), units);
      showPause();
      break;
    default:
      startRun();
      fakeCar(clock);
      hud.update(car, level(), units);
  }
}

/** One frame of the fake App: input → actions → fake physics → HUD. */
function tick(dt: number): void {
  input.update();
  for (const action of input.drainActions()) {
    console.log(`[hud-dev] action ${action}`);
    if (action === "mute") {
      muted = !muted;
      hud.setMuted(muted);
    } else if (action === "units") {
      units = units === "metric" ? "imperial" : "metric";
      hud.setUnits(units);
    } else if (action === "pause" && screen !== "menu") {
      if (paused) {
        paused = false;
        hud.hidePause();
      } else showPause();
    } else if (action === "restart" && screen !== "menu") {
      setScreen("ready");
    }
  }
  const inRun =
    screen !== "menu" &&
    screen !== "result" &&
    screen !== "crash" &&
    screen !== "short";
  if (!inRun || paused) return;
  if (!frozen) clock += dt;
  fakeCar(clock);
  // Let the keyboard / touch controls drive the ready screen so the input wiring can be felt.
  const c = input.controls;
  if (screen === "ready" && (c.throttle > 0 || c.thrust)) {
    car.speed = 4 + c.throttle * 6;
    car.thrusters.fill(c.thrust ? 1 : 0);
  }
  hud.update(car, level(), units);
}

// Callouts repeat so a snapshot at any moment catches one (also while ?freeze=1).
window.setInterval(() => {
  if (screen === "popup" && !paused) firePopups();
}, 3000);

const VIEWS: Record<string, View> = {
  chase: { position: [-72, 3.4, 1.2], target: [-40, 2.2, 0], fov: 55 },
  side: { position: [-8, 13, 52], target: [-8, 13, 0], fov: 55 },
  attract: { position: [-48, 14, 46], target: [0, 11, 0], fov: 50 },
  lineup: { position: [-34, 3.6, 1.5], target: [0, 2.5, 0], fov: 55 },
};

function viewFor(): string {
  if (screen === "menu") return "attract";
  if (levelId === "kickflip") return "lineup";
  return screen === "air" || screen === "ramp" ? "side" : "chase";
}

/** The level's venue behind the HUD, with a still Roadster posed like the fake car. */
function setupScene(ctx: HarnessContext): void {
  const scenery = buildScenery(level(), ctx.quality);
  ctx.scene.add(scenery.root);
  ctx.scene.fog = scenery.fog;
  const roadster = new RoadsterModel(ctx.quality);
  fakeCar(clock);
  roadster.root.position.set(car.position.x, car.position.y, 0);
  roadster.root.quaternion.setFromEuler(
    new THREE.Euler(car.roll, 0, car.pitch, "ZXY")
  );
  ctx.scene.add(roadster.root);
}

function startCssLoop(): void {
  document.body.classList.add("bg-css");
  if (screen === "popup") firePopups();
  let last = performance.now();
  let frames = 0;
  const loop = (now: number) => {
    tick(Math.min((now - last) / 1000, 1 / 20));
    last = now;
    if (++frames === 3) window.__snapReady = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.__hud = { hud, input, car, setScreen };
setScreen(screen);

if (params.get("bg") === "css") {
  startCssLoop();
} else {
  // The clock already starts at ?t=: hold it through the harness's own ?t=
  // pre-step, which would count that time twice.
  let running = false;
  await runHarness({
    views: { [viewFor()]: VIEWS[viewFor()], ...VIEWS },
    setup: setupScene,
    update: (dt) => tick(running ? dt : 0),
  });
  running = true;
  if (screen === "popup") firePopups();
}
