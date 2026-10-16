import { clamp, damp } from "@/core/math";
import type { CarSnapshot } from "@/core/types";
import { SmoothParam, type NoiseBank } from "./dsp";

/** Motor whine pitch (Hz) = MOTOR_BASE_HZ + motor speed (m/s) * MOTOR_HZ_PER_MS. */
export const MOTOR_BASE_HZ = 70;
export const MOTOR_HZ_PER_MS = 9;
/** The faint inverter whine rides on this harmonic of the motor tone. */
const INVERTER_HARMONIC = 11;
/** Wheel speed (m/s) the free-spinning motor revs toward at full throttle in the air. */
const AIR_REV_SPEED = 55;
/** Air speed (m/s) at which the wind layer reaches full level. */
const WIND_FULL_SPEED = 32;
/** Ground speed (m/s) at which road noise reaches full level. */
const ROAD_FULL_SPEED = 35;

/** Linear level of each layer at full intensity (before the master gain). */
export const LAYER_LEVEL = {
  motor: 0.05,
  inverter: 0.008,
  road: 0.38,
  wind: 0.9,
  hiss: 0.2,
  roar: 0.45,
} as const;

/** Per-frame targets of the continuous layers (linear gains, Hz). */
export interface LayerTargets {
  /** Fades the whole continuous mix in / out (0 outside a run). */
  bus: number;
  motorHz: number;
  motorCutoff: number;
  motorGain: number;
  inverterGain: number;
  roadGain: number;
  roadHz: number;
  windGain: number;
  windHz: number;
  hissGain: number;
  hissCutoff: number;
  roarGain: number;
}

/** Maps car snapshots onto layer targets. Pure arithmetic, no allocations per frame. */
export class LayerMixer {
  readonly targets: LayerTargets = {
    bus: 0,
    motorHz: MOTOR_BASE_HZ,
    motorCutoff: 400,
    motorGain: 0,
    inverterGain: 0,
    roadGain: 0,
    roadHz: 140,
    windGain: 0,
    windHz: 320,
    hissGain: 0,
    hissCutoff: 1500,
    roarGain: 0,
  };
  /** Wheel surface speed driving the motor pitch (m/s). */
  private motorSpeed = 0;

  /** Updates and returns `targets`. A null car fades the whole mix out. */
  update(dt: number, car: CarSnapshot | null): LayerTargets {
    const out = this.targets;
    if (!car) {
      out.bus = 0;
      return out;
    }
    out.bus = 1;
    const grounded = car.mode === "grounded";
    const airborne = car.mode === "airborne";
    const groundSpeed = Math.abs(car.speed);
    const v = car.velocity;
    const airSpeed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const throttle = clamp(car.throttle, 0, 1);
    const brake = clamp(car.brake, 0, 1);

    // The motor follows the wheels: track speed on the ground; in the air the
    // free wheels rev up with throttle or slowly spin down; a wreck winds down.
    if (grounded) {
      this.motorSpeed = groundSpeed;
    } else if (airborne) {
      const rev = throttle * AIR_REV_SPEED;
      const rate = rev > this.motorSpeed ? 1.6 : 0.35;
      this.motorSpeed = damp(this.motorSpeed, rev, rate, dt);
    } else {
      this.motorSpeed = damp(this.motorSpeed, 0, 3, dt);
    }

    // Load whine from the throttle, a faint cruise whine and regen whine when braking.
    const rolling = Math.min(1, this.motorSpeed / 12);
    let whine =
      car.mode === "crashed"
        ? 0
        : Math.min(1, 0.25 * rolling + 0.75 * throttle + 0.4 * brake * rolling);
    if (airborne) whine *= 0.7;
    out.motorHz = MOTOR_BASE_HZ + this.motorSpeed * MOTOR_HZ_PER_MS;
    out.motorCutoff = out.motorHz * (2 + 3 * throttle) + 300;
    out.motorGain = LAYER_LEVEL.motor * whine;
    out.inverterGain = LAYER_LEVEL.inverter * whine * (0.35 + 0.65 * throttle);

    // Tire / road noise: grounded only, heavier on the Curl (suction + g-load).
    const road = grounded
      ? Math.min(1, groundSpeed / ROAD_FULL_SPEED) ** 0.7 *
        (car.onRamp ? 1.35 : 1)
      : 0;
    out.roadGain = LAYER_LEVEL.road * road;
    out.roadHz = 140 + groundSpeed * 9;

    // Wind grows with speed squared and is loudest in the open air.
    const wind = Math.min(1, (airSpeed / WIND_FULL_SPEED) ** 2);
    out.windGain =
      LAYER_LEVEL.wind * wind * (airborne ? 1 : grounded ? 0.25 : 0.6);
    out.windHz = 320 + airSpeed * 22;

    // Cold-gas jets: summed nozzle intensity; the low roar swells when the
    // jets wash over the ground.
    const th = car.thrusters;
    const jets = Math.min(1, Math.max(0, th[0] + th[1] + th[2] + th[3]) / 4);
    const level = jets ** 0.7;
    const wash = 1 - clamp((car.heightAboveGround - 1) / 5, 0, 1);
    out.hissGain = LAYER_LEVEL.hiss * level;
    out.hissCutoff = 1500 - 500 * level;
    out.roarGain = LAYER_LEVEL.roar * level * (0.55 + 0.45 * wash);
    return out;
  }
}

/**
 * The always-running part of the mix (17 nodes): EV motor whine (detuned saw +
 * square through a resonant lowpass, plus a faint inverter harmonic), road
 * rumble, wind, and the cold-gas hiss + roar. Driven only through apply().
 */
export class ContinuousLayers {
  private readonly sources: AudioScheduledSourceNode[];
  private readonly bus: SmoothParam;
  private readonly sawHz: SmoothParam;
  private readonly squareHz: SmoothParam;
  private readonly inverterHz: SmoothParam;
  private readonly motorCutoff: SmoothParam;
  private readonly motorGain: SmoothParam;
  private readonly inverterGain: SmoothParam;
  private readonly roadGain: SmoothParam;
  private readonly roadHz: SmoothParam;
  private readonly windGain: SmoothParam;
  private readonly windHz: SmoothParam;
  private readonly hissGain: SmoothParam;
  private readonly hissCutoff: SmoothParam;
  private readonly roarGain: SmoothParam;

  constructor(ctx: BaseAudioContext, destination: AudioNode, noise: NoiseBank) {
    const fader = (dest: AudioNode): GainNode => {
      const node = new GainNode(ctx, { gain: 0 });
      node.connect(dest);
      return node;
    };
    const filter = (
      type: BiquadFilterType,
      frequency: number,
      Q: number,
      dest: AudioNode
    ): BiquadFilterNode => {
      const node = new BiquadFilterNode(ctx, { type, frequency, Q });
      node.connect(dest);
      return node;
    };
    const bus = fader(destination);

    const motor = fader(bus);
    const motorLowpass = filter("lowpass", 400, 2.5, motor);
    const saw = new OscillatorNode(ctx, {
      type: "sawtooth",
      frequency: MOTOR_BASE_HZ,
      detune: -6,
    });
    const square = new OscillatorNode(ctx, {
      type: "square",
      frequency: MOTOR_BASE_HZ,
      detune: 7,
    });
    saw.connect(motorLowpass);
    square.connect(motorLowpass);
    const inverterOut = fader(bus);
    const inverter = new OscillatorNode(ctx, {
      type: "sine",
      frequency: MOTOR_BASE_HZ * INVERTER_HARMONIC,
    });
    inverter.connect(inverterOut);

    // One pink loop feeds road, wind and the jet roar; the white loop feeds the hiss.
    const pink = new AudioBufferSourceNode(ctx, {
      buffer: noise.pink,
      loop: true,
    });
    const white = new AudioBufferSourceNode(ctx, {
      buffer: noise.white,
      loop: true,
    });
    const road = fader(bus);
    const roadBand = filter("bandpass", 140, 0.6, road);
    const wind = fader(bus);
    const windBand = filter("bandpass", 320, 0.8, wind);
    const roar = fader(bus);
    const roarBand = filter("bandpass", 260, 0.7, roar);
    pink.connect(roadBand);
    pink.connect(windBand);
    pink.connect(roarBand);
    const hiss = fader(bus);
    const hissHighpass = filter("highpass", 1500, 0.7, hiss);
    white.connect(hissHighpass);

    this.sources = [saw, square, inverter, pink, white];
    this.bus = new SmoothParam(bus.gain, 0.08, 0.25);
    this.sawHz = new SmoothParam(saw.frequency, 0.05, 0.05, 0.3);
    this.squareHz = new SmoothParam(square.frequency, 0.05, 0.05, 0.3);
    this.inverterHz = new SmoothParam(inverter.frequency, 0.05, 0.05, 3);
    this.motorCutoff = new SmoothParam(motorLowpass.frequency, 0.08, 0.08, 2);
    this.motorGain = new SmoothParam(motor.gain, 0.05, 0.12);
    this.inverterGain = new SmoothParam(inverterOut.gain, 0.08, 0.12, 1e-5);
    this.roadGain = new SmoothParam(road.gain, 0.08, 0.12);
    this.roadHz = new SmoothParam(roadBand.frequency, 0.1, 0.1, 1);
    this.windGain = new SmoothParam(wind.gain, 0.12, 0.15);
    this.windHz = new SmoothParam(windBand.frequency, 0.12, 0.12, 2);
    // Jets: ~20 ms attack, ~80 ms release (3 time constants).
    this.hissGain = new SmoothParam(hiss.gain, 0.007, 0.027);
    this.hissCutoff = new SmoothParam(hissHighpass.frequency, 0.03, 0.03, 5);
    this.roarGain = new SmoothParam(roar.gain, 0.01, 0.035);
  }

  /** Starts the oscillators and noise loops (silent until apply() raises the gains). */
  start(when: number): void {
    for (const source of this.sources) source.start(when);
  }

  /** Glides every parameter toward `t`, starting at context time `time`. */
  apply(t: LayerTargets, time: number): void {
    this.bus.set(t.bus, time);
    this.sawHz.set(t.motorHz, time);
    this.squareHz.set(t.motorHz, time);
    this.inverterHz.set(t.motorHz * INVERTER_HARMONIC, time);
    this.motorCutoff.set(t.motorCutoff, time);
    this.motorGain.set(t.motorGain, time);
    this.inverterGain.set(t.inverterGain, time);
    this.roadGain.set(t.roadGain, time);
    this.roadHz.set(t.roadHz, time);
    this.windGain.set(t.windGain, time);
    this.windHz.set(t.windHz, time);
    this.hissGain.set(t.hissGain, time);
    this.hissCutoff.set(t.hissCutoff, time);
    this.roarGain.set(t.roarGain, time);
  }
}
