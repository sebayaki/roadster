/**
 * Objective audio checks for the dev page (dev/audio.html?selfcheck=1): renders
 * every cue, a scripted run through the continuous layers and a worst-case mix
 * through the engine's real graph in an OfflineAudioContext, then measures them.
 * Dev tooling only; the game never imports it.
 */
import type { CarSnapshot } from "@/core/types";
import type { AudioCue } from "./audio-engine";
import { AUDIO_CUES, MAX_VOICES } from "./cues";
import { createAudioGraph, MASTER_LEVEL, type AudioGraph } from "./graph";
import { LayerMixer } from "./layers";

/** Sample rate of every offline render. */
export const CHECK_RATE = 44100;
/** Cues start this late in their render so the leading silence can be verified (s). */
const CUE_START = 0.05;
/** Frame step used to drive the continuous layers offline, like the game loop (s). */
const FRAME = 1 / 60;
/** Quietest acceptable RMS of an audible part (-40 dBFS). */
const MIN_AUDIBLE_RMS = 0.01;

/** Audible length (s) each cue must fall into. */
const EXPECTED_DURATION: Record<AudioCue, [number, number]> = {
  launch: [0.5, 2.0],
  land: [0.2, 1.0],
  perfect: [0.6, 2.0],
  crash: [0.7, 2.5],
  impact: [0.15, 0.9],
  flip: [0.12, 0.6],
  gasEmpty: [0.5, 1.5],
  result: [1.5, 4.5],
  ui: [0.02, 0.2],
};

export interface LevelStats {
  /** Largest |sample| (1.0 = full scale, i.e. clipping). */
  peak: number;
  /** RMS of the whole span. */
  rms: number;
  /** RMS of the audible part (10 ms windows within 40 dB of the loudest one). */
  activeRms: number;
  /** Start of the audible part, relative to the span start (s). */
  onset: number;
  /** Length of the audible part (s). */
  duration: number;
}

export interface CheckResult {
  name: string;
  stats: LevelStats;
  /** Rendered mono output (for drawing / listening). */
  samples: Float32Array;
  /** Empty when the check passed. */
  issues: string[];
}

export interface SceneSegment {
  label: string;
  start: number;
  end: number;
  /** Measured over the settled part of the segment. */
  stats: LevelStats;
  issues: string[];
}

export interface SelfCheckReport {
  pass: boolean;
  sampleRate: number;
  cues: CheckResult[];
  /** impact at intensity 1 vs 0.2: active RMS ratio. */
  impactScale: number;
  scene: CheckResult & { segments: SceneSegment[] };
  stress: CheckResult & { maxVoices: number };
}

/** Peak, RMS and audible extent of `samples[from, to)`. */
function analyze(
  samples: Float32Array,
  rate: number,
  from = 0,
  to = samples.length
): LevelStats {
  const win = Math.max(1, Math.round(rate * 0.01));
  const windows: number[] = [];
  let peak = 0;
  let sum = 0;
  for (let i = from; i < to; i += win) {
    const end = Math.min(to, i + win);
    let s = 0;
    for (let j = i; j < end; j++) {
      const v = samples[j];
      s += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    sum += s;
    windows.push(Math.sqrt(s / (end - i)));
  }
  const loudest = windows.reduce((m, w) => Math.max(m, w), 0);
  const floor = Math.max(loudest * 0.01, 1e-5);
  const first = windows.findIndex((w) => w > floor);
  let last = first;
  for (let n = windows.length - 1; n > first; n--) {
    if (windows[n] > floor) {
      last = n;
      break;
    }
  }
  let active = 0;
  for (let n = first; first >= 0 && n <= last; n++) active += windows[n] ** 2;
  const count = first >= 0 ? last - first + 1 : 0;
  return {
    peak,
    rms: Math.sqrt(sum / Math.max(1, to - from)),
    activeRms: count > 0 ? Math.sqrt(active / count) : 0,
    onset: first >= 0 ? (first * win) / rate : 0,
    duration: (count * win) / rate,
  };
}

function offline(seconds: number): OfflineAudioContext {
  return new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.ceil(seconds * CHECK_RATE),
    sampleRate: CHECK_RATE,
  });
}

async function render(ctx: OfflineAudioContext): Promise<Float32Array> {
  return (await ctx.startRendering()).getChannelData(0);
}

function levelIssues(stats: LevelStats, minRms = MIN_AUDIBLE_RMS): string[] {
  const issues: string[] = [];
  if (stats.peak >= 1) issues.push(`clips (peak ${stats.peak.toFixed(3)})`);
  if (stats.activeRms < minRms)
    issues.push(`too quiet (rms ${stats.activeRms.toFixed(4)})`);
  return issues;
}

async function checkCue(cue: AudioCue, intensity = 1): Promise<CheckResult> {
  const [minDur, maxDur] = EXPECTED_DURATION[cue];
  const ctx = offline(CUE_START + maxDur + 0.6);
  createAudioGraph(ctx, MASTER_LEVEL).cues.play(cue, intensity, CUE_START);
  const samples = await render(ctx);
  const lead = Math.round(CUE_START * CHECK_RATE);
  const stats = analyze(samples, CHECK_RATE, lead);
  const issues = levelIssues(stats);
  if (analyze(samples, CHECK_RATE, 0, lead).peak > 1e-5)
    issues.push("sound before the cue started");
  if (stats.duration < minDur || stats.duration > maxDur)
    issues.push(
      `duration ${stats.duration.toFixed(2)} s outside ${minDur}-${maxDur} s`
    );
  return { name: cue, stats, samples, issues };
}

/** A mutable snapshot the scripts below drive like the physics would. */
export function createFakeCar(): CarSnapshot {
  return {
    mode: "grounded",
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    brake: 0,
    gas: 1,
    thrusters: [0, 0, 0, 0],
    wheelSpin: 0,
    suspension: 0,
    onRamp: false,
    heightAboveGround: 0,
    airTime: 0,
    trickPitch: 0,
    trickRoll: 0,
  };
}

/** Puts the fake car in a simple state: on the runway along +x, or flying back over it. */
export function driveFakeCar(
  car: CarSnapshot,
  mode: CarSnapshot["mode"],
  speed: number,
  throttle: number,
  brake: number,
  thrust: number,
  height: number
): void {
  car.mode = mode;
  car.speed = speed;
  // Ground: along +x; air: falling back over the runway.
  car.velocity.x = mode === "grounded" ? speed : -0.8 * speed;
  car.velocity.y = mode === "grounded" ? 0 : -0.6 * speed;
  car.throttle = throttle;
  car.brake = brake;
  car.thrusters.fill(thrust);
  car.heightAboveGround = height;
  car.onRamp = false;
}

interface SceneStep {
  label: string;
  end: number;
  /** null feeds update(dt, null). u = 0..1 progress through the step. */
  set: ((car: CarSnapshot, u: number) => void) | null;
}

/** A compressed backflip run: idle, run-up, ramp, flight, thrust landing, fade-out. */
const SCENE: SceneStep[] = [
  { label: "null (silent)", end: 0.6, set: null },
  {
    label: "accelerate",
    end: 3,
    set: (c, u) => driveFakeCar(c, "grounded", 32 * u, 1, 0, 0, 0),
  },
  {
    label: "ramp",
    end: 4,
    set: (c, u) => {
      driveFakeCar(c, "grounded", 32 - 12 * u, 0.6, 0, 0, 0);
      c.onRamp = true;
    },
  },
  {
    label: "air",
    end: 5.2,
    set: (c, u) => driveFakeCar(c, "airborne", 20 - 4 * u, 0, 0, 0, 15),
  },
  {
    label: "air + thrust",
    end: 6.4,
    set: (c, u) => driveFakeCar(c, "airborne", 12, 0, 0, 1, 6 - 5 * u),
  },
  {
    label: "landed, braking",
    end: 7.4,
    set: (c, u) => driveFakeCar(c, "grounded", 10 - 7 * u, 0, 0.8, 0, 0),
  },
  { label: "null (fade out)", end: 9, set: null },
];

/** Feeds `layers` like the game loop: one mixer update + apply per frame. */
function scheduleLayers(
  graph: AudioGraph,
  seconds: number,
  car: CarSnapshot,
  script: (car: CarSnapshot, t: number) => boolean
): void {
  const mixer = new LayerMixer();
  graph.layers.start(0);
  for (let frame = 0; frame * FRAME < seconds; frame++) {
    const t = frame * FRAME;
    const live = script(car, t);
    graph.layers.apply(mixer.update(FRAME, live ? car : null), t);
  }
}

async function checkScene(): Promise<SelfCheckReport["scene"]> {
  const total = SCENE[SCENE.length - 1].end;
  const ctx = offline(total);
  const graph = createAudioGraph(ctx, MASTER_LEVEL);
  scheduleLayers(graph, total, createFakeCar(), (car, t) => {
    let start = 0;
    for (const step of SCENE) {
      if (t < step.end) {
        step.set?.(car, (t - start) / (step.end - start));
        return step.set !== null;
      }
      start = step.end;
    }
    return false;
  });
  const samples = await render(ctx);

  const segments: SceneSegment[] = [];
  let start = 0;
  for (const step of SCENE) {
    const len = step.end - start;
    // Settled part: skip the glide into the step; the fade-out is judged on its tail.
    const fade = step.label.includes("fade");
    const from = fade ? step.end - 0.4 : start + 0.3 * len;
    const stats = analyze(
      samples,
      CHECK_RATE,
      Math.round(from * CHECK_RATE),
      Math.round((step.end - 0.02) * CHECK_RATE)
    );
    segments.push({
      label: step.label,
      start,
      end: step.end,
      stats,
      issues: [],
    });
    start = step.end;
  }
  const [idle, , , air, thrust, landed, tail] = segments;
  for (const seg of segments.slice(1, -1)) seg.issues = levelIssues(seg.stats);
  if (idle.stats.peak > 1e-5) idle.issues.push("not silent before the run");
  if (tail.stats.rms > Math.min(2e-3, landed.stats.rms * 0.01))
    tail.issues.push(`did not fade out (rms ${tail.stats.rms.toFixed(4)})`);
  if (thrust.stats.rms < air.stats.rms * 1.2)
    thrust.issues.push("thrusters barely audible over the wind");

  const stats = analyze(samples, CHECK_RATE);
  const issues = levelIssues(stats).concat(
    segments.flatMap((s) => s.issues.map((i) => `${s.label}: ${i}`))
  );
  return { name: "layers scene", stats, samples, issues, segments };
}

/** Loudest layers + every cue at once + a burst of crashes and impacts. */
async function checkStress(): Promise<SelfCheckReport["stress"]> {
  const seconds = 3.5;
  const ctx = offline(seconds);
  const graph = createAudioGraph(ctx, MASTER_LEVEL);
  scheduleLayers(graph, seconds, createFakeCar(), (car) => {
    driveFakeCar(car, "airborne", 45, 1, 0, 1, 1);
    return true;
  });
  let maxVoices = 0;
  for (const cue of AUDIO_CUES) {
    graph.cues.play(cue, 1, 0.5);
    maxVoices = Math.max(maxVoices, graph.cues.active(0.5));
  }
  for (let n = 0; n < 20; n++) {
    const t = 0.6 + n * 0.05;
    graph.cues.play("impact", 1, t);
    graph.cues.play("crash", 1, t);
    maxVoices = Math.max(maxVoices, graph.cues.active(t));
  }
  const samples = await render(ctx);
  const stats = analyze(samples, CHECK_RATE);
  const issues = levelIssues(stats);
  if (maxVoices > MAX_VOICES)
    issues.push(`voice cap exceeded (${maxVoices} > ${MAX_VOICES})`);
  return { name: "stress mix", stats, samples, issues, maxVoices };
}

/** Runs every check; `pass` is true when no check reported an issue. */
export async function runSelfCheck(): Promise<SelfCheckReport> {
  const cues: CheckResult[] = [];
  for (const cue of AUDIO_CUES) cues.push(await checkCue(cue));
  const weak = await checkCue("impact", 0.2);
  const strong = cues.find((c) => c.name === "impact");
  const impactScale = strong
    ? strong.stats.activeRms / Math.max(1e-9, weak.stats.activeRms)
    : 0;
  if (strong && impactScale < 2)
    strong.issues.push(
      `intensity barely matters (x${impactScale.toFixed(2)} for 0.2 -> 1)`
    );
  const scene = await checkScene();
  const stress = await checkStress();
  const pass = [...cues, scene, stress].every((c) => c.issues.length === 0);
  return {
    pass,
    sampleRate: CHECK_RATE,
    cues,
    impactScale,
    scene,
    stress,
  };
}
