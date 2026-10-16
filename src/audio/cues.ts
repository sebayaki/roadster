import type { AudioCue } from "./audio-engine";
import { filterStage, gainStage, type NoiseBank, type NoiseKind } from "./dsp";

/** Most one-shot voices sounding at once; the oldest is faded out to make room. */
export const MAX_VOICES = 8;

/** Minimum seconds between two plays of the same cue (debounces event bursts and hover spam). */
const COOLDOWN: Record<AudioCue, number> = {
  launch: 0.25,
  land: 0.15,
  perfect: 0.3,
  crash: 0.3,
  impact: 0.07,
  flip: 0.1,
  gasEmpty: 0.5,
  result: 0.5,
  ui: 0.035,
};

/** Voice gain at intensity 0 (intensity 1 = full level), so weak hits stay audible. */
const FLOOR: Record<AudioCue, number> = {
  launch: 0.45,
  land: 0.4,
  perfect: 0,
  crash: 0.6,
  impact: 0.15,
  flip: 0,
  gasEmpty: 0,
  result: 0,
  ui: 0,
};

/** A major arpeggio (Hz) of the perfect-landing chime. */
const CHIME_NOTES = [880, 1108.73, 1318.51];
/** Cadd9 voicing (Hz) of the result pad. */
const RESULT_CHORD = [261.63, 392.0, 587.33, 659.26];

interface Voice {
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  /** Context time at which every source has stopped. */
  end: number;
}

/**
 * Collects the nodes of one cue into a voice. Envelopes are setTargetAtTime
 * curves (attack time constant → hold → decay time constant), so nothing clicks.
 */
class CueBuilder {
  readonly t: number;
  readonly out: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly bank: NoiseBank;
  private readonly rand: () => number;
  private readonly sources: AudioScheduledSourceNode[] = [];
  /** When the last envelope has decayed below -60 dB. */
  private end: number;

  constructor(
    ctx: BaseAudioContext,
    dest: AudioNode,
    bank: NoiseBank,
    t: number,
    rand: () => number,
    gain: number
  ) {
    this.ctx = ctx;
    this.bank = bank;
    this.t = t;
    this.rand = rand;
    this.end = t;
    this.out = gainStage(ctx, gain, dest);
  }

  /** Gain stage with an attack / hold / decay envelope peaking at `peak`. */
  env(
    at: number,
    peak: number,
    attack: number,
    decay: number,
    hold = 0,
    dest: AudioNode = this.out
  ): GainNode {
    const node = gainStage(this.ctx, 0, dest);
    node.gain.setTargetAtTime(peak, at, attack);
    const release = at + 3 * attack + hold;
    node.gain.setTargetAtTime(0, release, decay);
    this.end = Math.max(this.end, release + 7 * decay);
    return node;
  }

  /** Gain stage firing `count` short bursts at jittered gaps, each weaker by `falloff`. */
  bursts(
    at: number,
    count: number,
    gap: number,
    peak: number,
    decay: number,
    falloff: number
  ): GainNode {
    const node = gainStage(this.ctx, 0, this.out);
    let time = at;
    for (let n = 0; n < count; n++) {
      if (n > 0) time += gap * (0.5 + this.rand());
      const level =
        peak * (1 - (falloff * n) / count) * (0.6 + 0.4 * this.rand());
      node.gain.setTargetAtTime(level, time, 0.0015);
      node.gain.setTargetAtTime(0, time + 0.005, decay);
    }
    this.end = Math.max(this.end, time + 0.005 + 7 * decay);
    return node;
  }

  tone(
    type: OscillatorType,
    frequency: number,
    dest: AudioNode,
    at = this.t,
    detune = 0
  ): OscillatorNode {
    const node = new OscillatorNode(this.ctx, { type, frequency, detune });
    node.connect(dest);
    node.start(at);
    this.sources.push(node);
    return node;
  }

  /** Looping shared noise from a random offset, so repeated cues never sound identical. */
  noise(kind: NoiseKind, dest: AudioNode, at = this.t): AudioBufferSourceNode {
    const buffer = this.bank[kind];
    const node = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    node.connect(dest);
    node.start(at, this.rand() * buffer.duration);
    this.sources.push(node);
    return node;
  }

  filter(
    type: BiquadFilterType,
    frequency: number,
    Q: number,
    dest: AudioNode
  ): BiquadFilterNode {
    return filterStage(this.ctx, type, frequency, Q, dest);
  }

  /** Schedules every source to stop after the envelopes died out; the voice disconnects itself. */
  finish(): Voice {
    const end = this.end + 0.02;
    for (const source of this.sources) source.stop(end);
    const out = this.out;
    const last = this.sources[this.sources.length - 1];
    if (last) last.onended = () => out.disconnect();
    return { out, sources: this.sources, end };
  }
}

type CueFn = (b: CueBuilder, intensity: number) => void;

const CUES: Record<AudioCue, CueFn> = {
  launch(b) {
    const t = b.t;
    // Rising band-passed whoosh of air over the body.
    const swell = b.env(t, 1.3, 0.06, 0.2, 0.1);
    const band = b.filter("bandpass", 220, 1.8, swell);
    band.frequency.setTargetAtTime(2600, t, 0.22);
    b.noise("pink", band);
    // Airy top end.
    const air = b.env(t + 0.03, 0.16, 0.04, 0.14, 0.05);
    b.noise("white", b.filter("highpass", 3200, 0.7, air));
    // Low clunk of the suspension unloading.
    const thump = b.env(t, 0.32, 0.002, 0.08);
    b.tone("sine", 62, thump).frequency.setTargetAtTime(38, t, 0.06);
  },

  land(b, k) {
    const t = b.t;
    // Body thud: a falling sine.
    const body = b.env(t, 0.9, 0.0015, 0.1 + 0.05 * k);
    b.tone("sine", 105, body).frequency.setTargetAtTime(42, t, 0.05);
    // Tire / chassis slap: low-passed noise closing down.
    const slap = b.env(t, 0.6, 0.0015, 0.06);
    const lowpass = b.filter("lowpass", 1400, 0.8, slap);
    lowpass.frequency.setTargetAtTime(240, t, 0.05);
    b.noise("pink", lowpass);
    // Suspension knock.
    const at = t + 0.012;
    b.tone("triangle", 240, b.env(at, 0.16, 0.001, 0.03), at);
  },

  perfect(b) {
    // Bright rising arpeggio with octave overtones; the last note rings longest.
    CHIME_NOTES.forEach((f, n) => {
      const at = b.t + n * 0.075;
      const ring = n === CHIME_NOTES.length - 1 ? 0.34 : 0.2;
      b.tone("sine", f, b.env(at, 0.26, 0.002, ring), at);
      b.tone("sine", f * 2, b.env(at, 0.08, 0.002, ring * 0.5), at, 4);
    });
  },

  crash(b) {
    const t = b.t;
    // Heavy body hit.
    const body = b.env(t, 1, 0.0015, 0.16);
    b.tone("sine", 88, body).frequency.setTargetAtTime(32, t, 0.09);
    // Crunch: broadband noise closing down.
    const crunch = b.env(t, 0.9, 0.0015, 0.2, 0.06);
    const lowpass = b.filter("lowpass", 5200, 0.9, crunch);
    lowpass.frequency.setTargetAtTime(300, t + 0.02, 0.18);
    b.noise("pink", lowpass);
    // Debris crackle.
    const crackle = b.bursts(t + 0.01, 8, 0.05, 0.7, 0.012, 0.6);
    b.noise("white", b.filter("bandpass", 2600, 0.8, crackle));
    // Bent metal: two inharmonic squares through a resonant band.
    const metal = b.env(t + 0.008, 0.22, 0.002, 0.13);
    const ring = b.filter("bandpass", 1900, 2.5, metal);
    b.tone("square", 317, ring).frequency.setTargetAtTime(280, t, 0.3);
    b.tone("square", 449, ring);
  },

  impact(b, k) {
    const t = b.t;
    // A small crash: short thud, crunch and a panel clank. Heavier hits are
    // longer and brighter and shed debris.
    const body = b.env(t, 0.7, 0.0015, 0.04 + 0.06 * k);
    b.tone("sine", 70 + 30 * k, body).frequency.setTargetAtTime(36, t, 0.04);
    const crunch = b.env(t, 0.6, 0.0015, 0.04 + 0.05 * k);
    const lowpass = b.filter("lowpass", 1200 + 4000 * k, 0.9, crunch);
    lowpass.frequency.setTargetAtTime(400, t, 0.08);
    b.noise("pink", lowpass);
    const clank = b.env(t + 0.004, 0.1 + 0.12 * k, 0.001, 0.035 + 0.04 * k);
    const ring = b.filter("bandpass", 1500 + 900 * k, 4, clank);
    b.tone("square", 389, ring);
    b.tone("square", 563, ring);
    if (k > 0.5) {
      const rattle = b.bursts(t + 0.02, 4, 0.04, 0.4 * k, 0.01, 0.5);
      b.noise("white", b.filter("bandpass", 3000, 1, rattle));
    }
  },

  flip(b) {
    const t = b.t;
    // Quick upward blip that cuts through the jet hiss.
    const blip = b.env(t, 0.28, 0.002, 0.07, 0.04);
    b.tone("triangle", 620, blip).frequency.setTargetAtTime(1560, t, 0.035);
    const at = t + 0.02;
    const sparkle = b.env(at, 0.1, 0.002, 0.06, 0.02);
    b.tone("sine", 1240, sparkle, at).frequency.setTargetAtTime(
      3120,
      at,
      0.035
    );
  },

  gasEmpty(b) {
    const t = b.t;
    // Valve sputter: irregular chuffs, weaker and weaker, below the jet hiss band.
    const puffs = b.bursts(t, 6, 0.08, 1.4, 0.03, 0.75);
    b.noise("pink", b.filter("bandpass", 950, 1.2, puffs));
    // Falling sigh of the last gas.
    const sigh = b.env(t, 0.45, 0.01, 0.14, 0.05);
    const band = b.filter("bandpass", 1400, 1.1, sigh);
    band.frequency.setTargetAtTime(320, t, 0.15);
    b.noise("pink", band);
    // Dry clunk as the valve closes.
    const at = t + 0.46;
    const clunk = b.env(at, 0.45, 0.0015, 0.04);
    b.tone("sine", 150, clunk, at).frequency.setTargetAtTime(80, at, 0.03);
  },

  result(b) {
    const t = b.t;
    // Warm pad: detuned saws through an opening lowpass, plus a soft bell on top.
    const pad = b.env(t, 0.11, 0.06, 0.55, 0.6);
    const lowpass = b.filter("lowpass", 700, 0.7, pad);
    lowpass.frequency.setTargetAtTime(2600, t, 0.25);
    for (const f of RESULT_CHORD) {
      b.tone("sawtooth", f, lowpass, t, -7);
      b.tone("sawtooth", f, lowpass, t, 7);
    }
    const at = t + 0.04;
    b.tone("sine", 1318.51, b.env(at, 0.05, 0.002, 0.5), at);
  },

  ui(b) {
    const t = b.t;
    const click = b.env(t, 0.3, 0.001, 0.014);
    b.tone("sine", 2300, click).frequency.setTargetAtTime(1500, t, 0.02);
    const tick = b.env(t, 0.12, 0.0005, 0.004);
    b.noise("white", b.filter("highpass", 3500, 0.7, tick));
  },
};

/** Every cue, in declaration order. */
export const AUDIO_CUES = Object.keys(CUES) as AudioCue[];

/** Fades a stolen voice out quickly and stops its sources. */
function release(voice: Voice, time: number): void {
  voice.out.gain.setTargetAtTime(0, time, 0.01);
  const stop = Math.min(voice.end, time + 0.06);
  for (const source of voice.sources) {
    try {
      source.stop(stop);
    } catch {
      // Older engines reject a second stop(); the fade already silenced it.
    }
  }
}

/** Plays one-shot cues on a context with per-cue cooldowns and a voice cap (oldest voice stolen). */
export class CuePlayer {
  private readonly ctx: BaseAudioContext;
  private readonly dest: AudioNode;
  private readonly noise: NoiseBank;
  private readonly rand: () => number;
  private readonly voices: Voice[] = [];
  private readonly lastPlayed = new Map<AudioCue, number>();

  constructor(
    ctx: BaseAudioContext,
    dest: AudioNode,
    noise: NoiseBank,
    rand: () => number
  ) {
    this.ctx = ctx;
    this.dest = dest;
    this.noise = noise;
    this.rand = rand;
  }

  /** Schedules `cue` at context time `when` (intensity 0..1); false when debounced. */
  play(cue: AudioCue, intensity: number, when: number): boolean {
    const last = this.lastPlayed.get(cue);
    if (last !== undefined && when - last < COOLDOWN[cue]) return false;
    this.lastPlayed.set(cue, when);
    this.prune(when);
    while (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      if (oldest) release(oldest, when);
    }
    // NaN-safe clamp.
    const k = intensity > 0 ? Math.min(intensity, 1) : 0;
    const floor = FLOOR[cue];
    const b = new CueBuilder(
      this.ctx,
      this.dest,
      this.noise,
      when,
      this.rand,
      floor + (1 - floor) * k
    );
    CUES[cue](b, k);
    this.voices.push(b.finish());
    return true;
  }

  /** Number of voices still sounding at context time `time`. */
  active(time: number): number {
    this.prune(time);
    return this.voices.length;
  }

  private prune(time: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end <= time) this.voices.splice(i, 1);
    }
  }
}
