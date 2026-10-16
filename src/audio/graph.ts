import { mulberry32 } from "@/core/math";
import { CuePlayer } from "./cues";
import { createNoiseBank } from "./dsp";
import { ContinuousLayers } from "./layers";

/** Master gain when not muted. */
export const MASTER_LEVEL = 0.8;

/** The engine's whole signal path: layers + cues → master gain → compressor → destination. */
export interface AudioGraph {
  /** Mute and pause ramp this gain; everything else feeds it. */
  master: GainNode;
  compressor: DynamicsCompressorNode;
  /** Continuous layers (not started yet). */
  layers: ContinuousLayers;
  cues: CuePlayer;
}

/**
 * Builds the graph on any context, so the game (AudioContext) and the dev
 * self-check (OfflineAudioContext) render exactly the same sound.
 */
export function createAudioGraph(
  ctx: BaseAudioContext,
  masterLevel: number,
  seed = 0x52445354
): AudioGraph {
  const master = new GainNode(ctx, { gain: masterLevel });
  // Bus glue with a near-limiter ratio: stacked cues stay below full scale.
  const compressor = new DynamicsCompressorNode(ctx, {
    threshold: -16,
    knee: 8,
    ratio: 6,
    attack: 0.002,
    release: 0.2,
  });
  master.connect(compressor);
  compressor.connect(ctx.destination);
  const noise = createNoiseBank(ctx, seed);
  return {
    master,
    compressor,
    layers: new ContinuousLayers(ctx, master, noise),
    cues: new CuePlayer(ctx, master, noise, mulberry32(seed ^ 0x9e3779b9)),
  };
}
