import type { CarSnapshot } from "@/core/types";
import { createAudioGraph, MASTER_LEVEL, type AudioGraph } from "./graph";
import { LayerMixer } from "./layers";

export type AudioCue =
  | "launch" // leaving the ramp lip / thrust lift-off
  | "land" // clean touchdown
  | "perfect" // perfect-landing sting
  | "crash" // wreck
  | "impact" // wreck bouncing (scaled by intensity)
  | "flip" // another full rotation completed
  | "gasEmpty" // cold-gas tank ran dry
  | "result" // result card appears
  | "ui"; // menu click / hover

/** Cues start this far ahead of currentTime so their first envelope point is never in the past (s). */
const CUE_LEAD = 0.005;
/** A context that is not running yet accepts cues only this long after unlock() / resume(), so stale cues never burst out later (ms). */
const START_GRACE_MS = 1000;
/** Master glide time constants (s). */
const MUTE_TAU = 0.03;
const PAUSE_TAU = 0.015;
const RESUME_TAU = 0.04;
/** ctx.suspend() waits for the pause fade to settle (ms). */
const SUSPEND_DELAY_MS = 90;

const ignore = (): void => {};

/** Procedural WebAudio sound: no audio files. Silent until unlock() runs inside a user gesture. */
export class AudioEngine {
  private isMuted = false;
  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private readonly mixer = new LayerMixer();
  /** suspend() was called (game paused / tab hidden). */
  private paused = false;
  private disposed = false;
  /** performance.now() of the last request to start the clock. */
  private wokeAt = Number.NEGATIVE_INFINITY;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  /** Create / resume the AudioContext. Must be called from a user gesture; safe to call repeatedly. */
  unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      if (typeof AudioContext === "undefined") return;
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const graph = createAudioGraph(ctx, this.masterTarget());
      graph.layers.start(ctx.currentTime);
      this.ctx = ctx;
      this.graph = graph;
      // iOS Safari only opens the output once a buffer starts inside the gesture.
      const prime = new AudioBufferSourceNode(ctx, {
        buffer: ctx.createBuffer(1, 1, ctx.sampleRate),
      });
      prime.connect(ctx.destination);
      prime.start();
    }
    if (this.paused) this.suspend();
    else this.wake();
  }

  get muted(): boolean {
    return this.isMuted;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (!this.paused) this.glideMaster(this.masterTarget(), MUTE_TAU);
  }

  /** Continuous layers: motor whine, road noise, wind, thruster hiss. Pass null outside a run to fade out. */
  update(dt: number, car: CarSnapshot | null): void {
    const ctx = this.ctx;
    // A stopped clock would pile up automation events at one frozen time.
    if (!ctx || !this.graph || this.paused || ctx.state !== "running") return;
    this.graph.layers.apply(this.mixer.update(dt, car), ctx.currentTime);
  }

  /** One-shot cue. intensity 0..1 (default 1). */
  play(cue: AudioCue, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.graph || this.isMuted || this.paused) return;
    // While the clock (re)starts cues queue up; a context that stays stopped drops them.
    if (
      ctx.state !== "running" &&
      performance.now() - this.wokeAt > START_GRACE_MS
    )
      return;
    this.graph.cues.play(cue, intensity, ctx.currentTime + CUE_LEAD);
  }

  /** Pause / resume everything (game paused, tab hidden). */
  suspend(): void {
    this.paused = true;
    const ctx = this.ctx;
    if (!ctx) return;
    // Fade first so the stream never stops mid-waveform, then free the audio thread.
    this.glideMaster(0, PAUSE_TAU);
    this.clearSuspendTimer();
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (this.paused && ctx.state !== "closed") ctx.suspend().catch(ignore);
    }, SUSPEND_DELAY_MS);
  }

  resume(): void {
    this.paused = false;
    this.clearSuspendTimer();
    if (!this.ctx) return;
    this.wake();
    this.glideMaster(this.masterTarget(), RESUME_TAU);
  }

  dispose(): void {
    this.disposed = true;
    this.clearSuspendTimer();
    const ctx = this.ctx;
    this.ctx = null;
    this.graph = null;
    if (ctx && ctx.state !== "closed") ctx.close().catch(ignore);
  }

  private masterTarget(): number {
    return this.isMuted || this.paused ? 0 : MASTER_LEVEL;
  }

  private glideMaster(level: number, tau: number): void {
    if (this.ctx && this.graph)
      this.graph.master.gain.setTargetAtTime(level, this.ctx.currentTime, tau);
  }

  /**
   * Starts the clock. Always queues resume() (a no-op when running) so it also
   * lands after a ctx.suspend() still in flight: a quick pause + unpause never sticks.
   */
  private wake(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return;
    this.wokeAt = performance.now();
    ctx.resume().catch(ignore);
  }

  private clearSuspendTimer(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }
}
