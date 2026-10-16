/**
 * Low-level WebAudio helpers shared by the continuous layers and the one-shot
 * cues. Everything takes a BaseAudioContext, so the same code renders in real
 * time (AudioContext) and offline (OfflineAudioContext, dev self-check).
 */

import { mulberry32 } from "@/core/math";

/** Loopable, peak-normalized mono noise, created once per context and shared by every layer and cue. */
export interface NoiseBank {
  /** Flat spectrum: thruster hiss, crackle, air. */
  white: AudioBuffer;
  /** -3 dB/octave: road rumble, wind, whooshes, thuds. */
  pink: AudioBuffer;
}

export type NoiseKind = keyof NoiseBank;

export function createNoiseBank(
  ctx: BaseAudioContext,
  seed: number
): NoiseBank {
  const rand = mulberry32(seed);
  // Different lengths so the two loops never line up.
  return {
    white: loopedNoise(ctx, 3.1, rand, false),
    pink: loopedNoise(ctx, 4.3, rand, true),
  };
}

/** Overhang crossfaded into the head of a noise buffer so its loop point is seamless (s). */
const LOOP_FADE = 0.05;

function loopedNoise(
  ctx: BaseAudioContext,
  seconds: number,
  rand: () => number,
  pink: boolean
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.round(seconds * rate);
  const fade = Math.round(LOOP_FADE * rate);
  const raw = new Float32Array(length + fade);
  // Paul Kellet's pink filter state.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rand() * 2 - 1;
    if (!pink) {
      raw[i] = w;
      continue;
    }
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }

  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    let v = raw[i];
    if (i < fade) {
      // Equal-power crossfade: the sample after the loop end continues raw[length].
      const x = (i / fade) * (Math.PI / 2);
      v = raw[i] * Math.sin(x) + raw[length + i] * Math.cos(x);
    }
    data[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const scale = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < length; i++) data[i] *= scale;
  return buffer;
}

/** A gain stage at `gain` feeding `dest`. */
export function gainStage(
  ctx: BaseAudioContext,
  gain: number,
  dest: AudioNode
): GainNode {
  const node = new GainNode(ctx, { gain });
  node.connect(dest);
  return node;
}

/** A biquad filter feeding `dest`. */
export function filterStage(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  Q: number,
  dest: AudioNode
): BiquadFilterNode {
  const node = new BiquadFilterNode(ctx, { type, frequency, Q });
  node.connect(dest);
  return node;
}

/**
 * Click-free control of an AudioParam from per-frame code: every change is a
 * setTargetAtTime glide (separate rise / fall time constants), and targets that
 * did not move are skipped so the automation timeline stays short.
 */
export class SmoothParam {
  private readonly param: AudioParam;
  private readonly rise: number;
  private readonly fall: number;
  private readonly epsilon: number;
  private last = Number.NaN;

  /**
   * @param rise time constant (s) when the target goes up
   * @param fall time constant (s) when the target goes down
   * @param epsilon smallest change (param units) worth a new glide
   */
  constructor(param: AudioParam, rise: number, fall = rise, epsilon = 1e-4) {
    this.param = param;
    this.rise = rise;
    this.fall = fall;
    this.epsilon = epsilon;
  }

  set(target: number, time: number): void {
    const last = this.last;
    // Tiny moves are skipped, except a final move to exactly 0 (true silence).
    if (Math.abs(target - last) <= this.epsilon && (target !== 0 || last === 0))
      return;
    this.param.setTargetAtTime(
      target,
      time,
      target > last ? this.rise : this.fall
    );
    this.last = target;
  }
}
