/**
 * Audio lab (dev/audio.html): play every cue, drive the continuous layers from
 * a fake CarSnapshot, toggle mute / pause, and watch the live output meter.
 *
 * URL params:
 *   ?selfcheck=1   render every cue, a scripted run and a worst-case mix through
 *                  an OfflineAudioContext; log peak / RMS / duration per check,
 *                  draw waveforms + spectrograms, set window.__selfcheck.
 *
 * `window.__audio` is the AudioEngine and `window.__audioLab` exposes the fake
 * car, `set(controls)` and `state()` for `scripts/snap.mjs --eval`.
 * `window.__snapReady` turns true once the page (or the self-check) is ready.
 */
import { AudioEngine, type AudioCue } from "@/audio/audio-engine";
import { AUDIO_CUES } from "@/audio/cues";
import type { AudioGraph } from "@/audio/graph";
import { LAYER_LEVEL, LayerMixer, type LayerTargets } from "@/audio/layers";
import {
  CHECK_RATE,
  createFakeCar,
  driveFakeCar,
  runSelfCheck,
  type CheckResult,
  type LevelStats,
  type SelfCheckReport,
} from "@/audio/selfcheck";
import type { CarMode, CarSnapshot } from "@/core/types";

interface LabControls {
  /** false feeds update(dt, null). */
  feed: boolean;
  mode: CarMode;
  speed: number;
  throttle: number;
  brake: number;
  /** Lift jets, all four nozzles. */
  lift: number;
  /** Extra rotation jets on the front pair. */
  spin: number;
  height: number;
  onRamp: boolean;
  /** Intensity passed to play(). */
  intensity: number;
}

interface LabState {
  context: string;
  time: number;
  muted: boolean;
  paused: boolean;
  /** Live output level after the compressor (analyser on the engine's graph). */
  peak: number;
  rms: number;
}

interface AudioLab {
  car: CarSnapshot;
  cues: readonly AudioCue[];
  set(values: Partial<LabControls>): void;
  state(engine?: AudioEngine): LabState;
}

interface SelfCheckSummary {
  pass: boolean;
  checks: Array<{ name: string; issues: string[] } & LevelStats>;
}

declare global {
  interface Window {
    __audio?: AudioEngine;
    __audioLab?: AudioLab;
    __selfcheck?: SelfCheckSummary;
  }
}

const STYLE = `
:root { color-scheme: dark; --bg: #07080c; --panel: rgba(255,255,255,0.04); --line: rgba(255,255,255,0.12);
  --text: #e9eaec; --dim: #8b8e92; --accent: #ff2a2a; --ok: #3ddc84; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 13px/1.4 Inter, "SF Pro Display", -apple-system, "Segoe UI", Roboto, sans-serif; }
header { padding: 20px 24px 6px; display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
h1 { font-size: 15px; letter-spacing: 0.4em; font-weight: 600; margin: 0; }
h2 { margin: 0 0 10px; font-size: 11px; letter-spacing: 0.25em; color: var(--dim); font-weight: 600; }
a { color: var(--dim); }
.sub { color: var(--dim); letter-spacing: 0.06em; }
.pill { border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; font-size: 11px;
  letter-spacing: 0.15em; text-transform: uppercase; }
.pill.ok { border-color: var(--ok); color: var(--ok); }
.pill.bad { border-color: var(--accent); color: var(--accent); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; padding: 12px 24px 24px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: inherit; color: var(--text); background: rgba(255,255,255,0.06); border: 1px solid var(--line);
  border-radius: 6px; padding: 7px 12px; letter-spacing: 0.08em; cursor: pointer; }
button:hover { border-color: rgba(255,255,255,0.35); }
button.on { border-color: var(--accent); background: rgba(255,42,42,0.18); color: #fff; }
.row { display: grid; grid-template-columns: 96px 1fr 78px; align-items: center; gap: 10px; margin: 7px 0; }
.row span:last-child { text-align: right; font-variant-numeric: tabular-nums; color: var(--dim); }
input[type=range] { width: 100%; accent-color: var(--accent); }
.bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
.bar > i { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left;
  transform: scaleX(0); }
canvas { display: block; width: 100%; background: #000; border: 1px solid var(--line); border-radius: 6px; }
.checks { padding: 4px 24px 24px; display: grid; gap: 8px; }
.check { display: grid; grid-template-columns: 250px 1fr 1fr 40px; gap: 10px; align-items: center; }
.check b { letter-spacing: 0.12em; }
.stats { color: var(--dim); font-variant-numeric: tabular-nums; font-size: 12px; }
.issues { color: var(--accent); font-size: 12px; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
td, th { padding: 3px 14px 3px 0; text-align: left; color: var(--dim); font-weight: 400; }
`;

/** Dev-only peek at the engine's private state; not part of its API. */
function internals(engine: AudioEngine): {
  ctx: AudioContext | null;
  graph: AudioGraph | null;
  paused: boolean;
} {
  return engine as unknown as {
    ctx: AudioContext | null;
    graph: AudioGraph | null;
    paused: boolean;
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
  text = "",
  className = ""
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

function header(title: string, sub: string): HTMLElement {
  const head = el("header", document.body);
  el("h1", head, title);
  el("span", head, sub, "sub");
  return head;
}

const dbfs = (v: number): string =>
  v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dBFS` : "-inf dBFS";

// ---------------------------------------------------------------------------
// Interactive lab

function labPage(): void {
  const engine = new AudioEngine();
  const mirror = new LayerMixer();
  const car = createFakeCar();
  const ctl: LabControls = {
    feed: true,
    mode: "grounded",
    speed: 0,
    throttle: 0,
    brake: 0,
    lift: 0,
    spin: 0,
    height: 4,
    onRamp: false,
    intensity: 1,
  };
  const refreshers: Array<() => void> = [];

  // Any gesture unlocks, like the game's first tap.
  const unlock = () => engine.unlock();
  addEventListener("pointerdown", unlock, { capture: true });
  addEventListener("keydown", unlock, { capture: true });

  const head = header("RDSTR STUNTS · AUDIO LAB", "procedural WebAudio");
  const status = el("span", head, "no context", "pill");
  const link = el("a", head, "offline self-check →");
  link.href = "?selfcheck=1";
  const grid = el("div", document.body, "", "grid");

  const toggle = (
    parent: HTMLElement,
    label: string,
    get: () => boolean,
    set: (on: boolean) => void
  ) => {
    const button = el("button", parent, label);
    const refresh = () => button.classList.toggle("on", get());
    button.onclick = () => {
      set(!get());
      refresh();
    };
    refreshers.push(refresh);
    refresh();
  };
  const slider = (
    parent: HTMLElement,
    label: string,
    key:
      "speed" | "throttle" | "brake" | "lift" | "spin" | "height" | "intensity",
    max: number,
    format: (v: number) => string
  ) => {
    const row = el("label", parent, "", "row");
    el("span", row, label);
    const input = el("input", row);
    input.type = "range";
    input.min = "0";
    input.max = String(max);
    input.step = String(max / 200);
    const value = el("span", row);
    const refresh = () => {
      input.value = String(ctl[key]);
      value.textContent = format(ctl[key]);
    };
    input.oninput = () => {
      ctl[key] = Number(input.value);
      refresh();
    };
    refreshers.push(refresh);
    refresh();
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Engine panel.
  const enginePanel = el("div", grid, "", "panel");
  el("h2", enginePanel, "ENGINE");
  const engineButtons = el("div", enginePanel, "", "buttons");
  el("button", engineButtons, "UNLOCK").onclick = unlock;
  toggle(
    engineButtons,
    "MUTE",
    () => engine.muted,
    (on) => engine.setMuted(on)
  );
  toggle(
    engineButtons,
    "PAUSE (SUSPEND)",
    () => internals(engine).paused,
    (on) => (on ? engine.suspend() : engine.resume())
  );
  el("h2", enginePanel, "OUTPUT").style.marginTop = "14px";
  const scopeCanvas = el("canvas", enginePanel);
  scopeCanvas.width = 600;
  scopeCanvas.height = 90;
  const meterRow = (label: string) => {
    const row = el("div", enginePanel, "", "row");
    el("span", row, label);
    const bar = el("i", el("div", row, "", "bar"));
    return { bar, value: el("span", row) };
  };
  const peakMeter = meterRow("peak");
  const rmsMeter = meterRow("rms");

  // Cue panel.
  const cuePanel = el("div", grid, "", "panel");
  el("h2", cuePanel, "ONE-SHOT CUES");
  const cueButtons = el("div", cuePanel, "", "buttons");
  for (const cue of AUDIO_CUES) {
    el("button", cueButtons, cue).onclick = () =>
      engine.play(cue, ctl.intensity);
  }
  slider(cuePanel, "intensity", "intensity", 1, pct);

  // Car panel.
  const carPanel = el("div", grid, "", "panel");
  el("h2", carPanel, "CAR SNAPSHOT → UPDATE()");
  const carButtons = el("div", carPanel, "", "buttons");
  toggle(
    carButtons,
    "FEED CAR",
    () => ctl.feed,
    (on) => (ctl.feed = on)
  );
  for (const mode of ["grounded", "airborne", "crashed"] as const) {
    toggle(
      carButtons,
      mode.toUpperCase(),
      () => ctl.mode === mode,
      (on) => {
        if (on) ctl.mode = mode;
        refreshAll();
      }
    );
  }
  toggle(
    carButtons,
    "ON RAMP",
    () => ctl.onRamp,
    (on) => (ctl.onRamp = on)
  );
  slider(carPanel, "speed", "speed", 70, (v) => `${Math.round(v * 3.6)} km/h`);
  slider(carPanel, "throttle", "throttle", 1, pct);
  slider(carPanel, "brake", "brake", 1, pct);
  slider(carPanel, "lift jets", "lift", 1, pct);
  slider(carPanel, "spin jets", "spin", 1, pct);
  slider(carPanel, "height", "height", 20, (v) => `${v.toFixed(1)} m`);

  // Mixer panel: what update() asks of each layer this frame.
  const mixPanel = el("div", grid, "", "panel");
  el("h2", mixPanel, "LAYER TARGETS");
  // Bars are relative to each layer's full level.
  const gains: Array<[keyof LayerTargets, number]> = [
    ["bus", 1],
    ["motorGain", LAYER_LEVEL.motor],
    ["inverterGain", LAYER_LEVEL.inverter],
    ["roadGain", LAYER_LEVEL.road],
    ["windGain", LAYER_LEVEL.wind],
    ["hissGain", LAYER_LEVEL.hiss],
    ["roarGain", LAYER_LEVEL.roar],
  ];
  const gainRows = gains.map(([key]) => {
    const row = el("div", mixPanel, "", "row");
    el("span", row, key);
    const bar = el("i", el("div", row, "", "bar"));
    return { bar, value: el("span", row) };
  });
  const hzLine = el("div", mixPanel, "", "stats");

  function refreshAll(): void {
    for (const refresh of refreshers) refresh();
  }

  let analyser: AnalyserNode | null = null;
  const scope = new Float32Array(2048);
  const level = { peak: 0, rms: 0 };
  function measure(): void {
    const { ctx, graph } = internals(engine);
    if (!ctx || !graph) {
      analyser = null;
      level.peak = level.rms = 0;
      return;
    }
    if (!analyser) {
      analyser = new AnalyserNode(ctx, { fftSize: scope.length });
      graph.compressor.connect(analyser);
    }
    analyser.getFloatTimeDomainData(scope);
    let peak = 0;
    let sum = 0;
    for (const v of scope) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    level.peak = peak;
    level.rms = Math.sqrt(sum / scope.length);
  }

  function syncCar(): void {
    driveFakeCar(
      car,
      ctl.mode,
      ctl.speed,
      ctl.throttle,
      ctl.brake,
      ctl.lift,
      ctl.mode === "grounded" ? 0 : ctl.height
    );
    car.thrusters[0] = car.thrusters[1] = Math.min(1, ctl.lift + ctl.spin);
    car.onRamp = ctl.onRamp && ctl.mode === "grounded";
  }

  function draw(targets: LayerTargets): void {
    const { ctx } = internals(engine);
    status.textContent = ctx
      ? `${ctx.state} · ${ctx.currentTime.toFixed(1)} s`
      : "no context (tap to unlock)";
    status.className = `pill ${ctx?.state === "running" ? "ok" : "bad"}`;
    peakMeter.bar.style.transform = `scaleX(${Math.min(1, level.peak)})`;
    peakMeter.value.textContent = dbfs(level.peak);
    rmsMeter.bar.style.transform = `scaleX(${Math.min(1, level.rms * 4)})`;
    rmsMeter.value.textContent = dbfs(level.rms);
    gains.forEach(([key, full], n) => {
      const v = targets[key];
      gainRows[n].bar.style.transform = `scaleX(${Math.min(1, v / full)})`;
      gainRows[n].value.textContent = v.toFixed(3);
    });
    hzLine.textContent = `motor ${targets.motorHz.toFixed(0)} Hz · cutoff ${targets.motorCutoff.toFixed(0)} Hz · road ${targets.roadHz.toFixed(0)} Hz · wind ${targets.windHz.toFixed(0)} Hz · hiss hp ${targets.hissCutoff.toFixed(0)} Hz`;
    drawWave(scopeCanvas, scope, 0, scope.length);
  }

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    syncCar();
    const fed = ctl.feed ? car : null;
    engine.update(dt, fed);
    measure();
    draw(mirror.update(dt, fed));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.__audio = engine;
  window.__audioLab = {
    car,
    cues: AUDIO_CUES,
    set(values) {
      Object.assign(ctl, values);
      refreshAll();
    },
    state(target = engine) {
      const { ctx, paused } = internals(target);
      if (target === engine) measure();
      return {
        context: ctx ? ctx.state : "none",
        time: ctx ? Number(ctx.currentTime.toFixed(3)) : 0,
        muted: target.muted,
        paused,
        peak: target === engine ? level.peak : 0,
        rms: target === engine ? level.rms : 0,
      };
    },
  };
  window.__snapReady = true;
}

// ---------------------------------------------------------------------------
// Offline self-check

function drawWave(
  canvas: HTMLCanvasElement,
  samples: Float32Array,
  from: number,
  to: number
): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const { width: w, height: h } = canvas;
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  // Full-scale (clipping) lines.
  g.fillStyle = "rgba(255,42,42,0.6)";
  g.fillRect(0, 0, w, 1);
  g.fillRect(0, h - 1, w, 1);
  g.fillStyle = "#cfd3d8";
  const per = (to - from) / w;
  for (let x = 0; x < w; x++) {
    const a = from + Math.floor(x * per);
    const b = Math.min(to, from + Math.max(1, Math.floor((x + 1) * per)));
    let min = 0;
    let max = 0;
    for (let i = a; i < b; i++) {
      min = Math.min(min, samples[i]);
      max = Math.max(max, samples[i]);
    }
    const y0 = ((1 - max) * h) / 2;
    const y1 = ((1 - min) * h) / 2;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = i + k;
        const b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
      }
    }
  }
}

/** Inferno-like color ramp, t in 0..1. */
const RAMP = [
  [0, 0, 4],
  [60, 9, 101],
  [187, 55, 84],
  [249, 142, 9],
  [252, 255, 164],
];

/** Log-frequency spectrogram (30 Hz – 16 kHz, -90..-10 dB). */
function drawSpectrogram(
  canvas: HTMLCanvasElement,
  samples: Float32Array,
  size: number
): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const { width: w, height: h } = canvas;
  const image = g.createImageData(w, h);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const hzPerBin = CHECK_RATE / size;
  const binAt = (y: number) => (30 * (16000 / 30) ** ((h - y) / h)) / hzPerBin;
  for (let x = 0; x < w; x++) {
    const center = Math.floor(((x + 0.5) * samples.length) / w);
    for (let i = 0; i < size; i++) {
      const j = center - size / 2 + i;
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = j >= 0 && j < samples.length ? samples[j] * hann : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < h; y++) {
      // Loudest bin inside this pixel row's frequency band.
      const lo = Math.floor(binAt(y + 1));
      const hi = Math.min(size / 2 - 1, Math.max(lo, Math.floor(binAt(y))));
      let mag = 0;
      for (let k = lo; k <= hi; k++)
        mag = Math.max(mag, Math.hypot(re[k], im[k]));
      const db = 20 * Math.log10(mag / (size / 4) + 1e-12);
      const t = Math.min(1, Math.max(0, (db + 90) / 80)) * (RAMP.length - 1);
      const n = Math.min(RAMP.length - 2, Math.floor(t));
      const f = t - n;
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++)
        image.data[p + c] = RAMP[n][c] + (RAMP[n + 1][c] - RAMP[n][c]) * f;
      image.data[p + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
}

let previewCtx: AudioContext | null = null;
/** Plays a rendered check so a human can audition exactly what was measured. */
function audition(samples: Float32Array): void {
  previewCtx ??= new AudioContext();
  const buffer = previewCtx.createBuffer(1, samples.length, CHECK_RATE);
  buffer.getChannelData(0).set(samples);
  const source = new AudioBufferSourceNode(previewCtx, { buffer });
  source.connect(previewCtx.destination);
  source.start();
}

function statsText(s: LevelStats): string {
  return `peak ${s.peak.toFixed(3)} (${dbfs(s.peak)}) · rms ${s.activeRms.toFixed(4)} (${dbfs(s.activeRms)}) · ${s.duration.toFixed(2)} s`;
}

function logCheck(c: CheckResult): void {
  const verdict = c.issues.length ? `FAIL: ${c.issues.join("; ")}` : "OK";
  console.log(
    `[selfcheck] ${c.name.padEnd(13)} ${statsText(c.stats)} · ${verdict}`
  );
}

function checkRow(parent: HTMLElement, c: CheckResult, fftSize = 1024): void {
  const row = el("div", parent, "", "check panel");
  const info = el("div", row);
  el("b", info, c.name.toUpperCase());
  el("div", info, statsText(c.stats), "stats");
  el("div", info, c.issues.join("; "), "issues");
  const wave = el("canvas", row);
  const spec = el("canvas", row);
  wave.width = spec.width = 440;
  wave.height = spec.height = 64;
  drawWave(wave, c.samples, 0, c.samples.length);
  drawSpectrogram(spec, c.samples, fftSize);
  el("button", row, "▶").onclick = () => audition(c.samples);
}

function sceneBlock(parent: HTMLElement, report: SelfCheckReport): void {
  const { scene } = report;
  const block = el("div", parent, "", "panel");
  el("h2", block, `LAYERS SCENE — ${statsText(scene.stats)}`);
  const wave = el("canvas", block);
  const spec = el("canvas", block);
  wave.width = spec.width = 1180;
  wave.height = 70;
  spec.height = 170;
  spec.style.marginTop = "6px";
  drawWave(wave, scene.samples, 0, scene.samples.length);
  drawSpectrogram(spec, scene.samples, 4096);
  // Segment boundaries and labels.
  const g = spec.getContext("2d");
  const total = scene.samples.length / CHECK_RATE;
  if (g) {
    g.font = "11px sans-serif";
    for (const seg of scene.segments) {
      const x = (seg.start / total) * spec.width;
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(x, 0, 1, spec.height);
      g.fillStyle = "#fff";
      g.fillText(seg.label, x + 4, 12);
    }
  }
  const table = el("table", block);
  table.style.marginTop = "8px";
  for (const seg of scene.segments) {
    const tr = el("tr", table);
    el("td", tr, seg.label);
    el("td", tr, `${seg.start.toFixed(1)}–${seg.end.toFixed(1)} s`);
    el("td", tr, `rms ${seg.stats.rms.toFixed(4)} (${dbfs(seg.stats.rms)})`);
    el("td", tr, `peak ${seg.stats.peak.toFixed(3)}`);
    el("td", tr, seg.issues.join("; ") || "OK");
  }
  el("button", block, "▶ scene").onclick = () => audition(scene.samples);
}

async function selfCheckPage(): Promise<void> {
  const head = header(
    "RDSTR STUNTS · AUDIO SELF-CHECK",
    `offline render @ ${CHECK_RATE} Hz through the engine graph`
  );
  const verdict = el("span", head, "rendering…", "pill");
  el("a", head, "← lab").href = "?";
  const report = await runSelfCheck();

  const list = el("div", document.body, "", "checks");
  for (const c of report.cues) {
    logCheck(c);
    checkRow(list, c);
  }
  console.log(
    `[selfcheck] impact intensity 0.2 -> 1: active rms x${report.impactScale.toFixed(2)}`
  );
  for (const seg of report.scene.segments) {
    console.log(
      `[selfcheck]   scene ${seg.label.padEnd(16)} rms ${seg.stats.rms.toFixed(4)} (${dbfs(seg.stats.rms)}) peak ${seg.stats.peak.toFixed(3)} ${seg.issues.join("; ") || "OK"}`
    );
  }
  logCheck(report.scene);
  logCheck(report.stress);
  console.log(`[selfcheck] stress max voices ${report.stress.maxVoices}`);
  sceneBlock(list, report);
  checkRow(list, report.stress, 2048);

  verdict.textContent = report.pass ? "all checks pass" : "failures";
  verdict.className = `pill ${report.pass ? "ok" : "bad"}`;
  console.log(`[selfcheck] ${report.pass ? "PASS" : "FAIL"}`);
  window.__selfcheck = {
    pass: report.pass,
    checks: [...report.cues, report.scene, report.stress].map((c) => ({
      name: c.name,
      issues: c.issues,
      ...c.stats,
    })),
  };
  window.__snapReady = true;
}

const style = document.createElement("style");
style.textContent = STYLE;
document.head.appendChild(style);
if (new URLSearchParams(location.search).get("selfcheck") === "1") {
  void selfCheckPage();
} else {
  labPage();
}
