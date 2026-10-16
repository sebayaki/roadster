import { CAR } from "@/core/car-spec";
import { clamp, GRAVITY, TAU } from "@/core/math";
import type {
  CarMode,
  CarSnapshot,
  Controls,
  CrashReason,
  LevelDef,
  PhysicsEvent,
  SpinAxis,
} from "@/core/types";
import { CURL_WIDTH } from "@/levels/backflip";
import {
  CarHull,
  COLLISION_POINTS,
  CORNER_COUNT,
  hullOverlaps,
  POINT_COUNT,
  poseMatrix,
  prepareObstacles,
  type ObstacleShape,
} from "./collision";
import { buildLandingResult, gradeLanding } from "./scoring";
import {
  createFrame,
  createRampHit,
  TrackGeometry,
  type TrackFrame,
} from "./track";
import { TUNING } from "./tuning";
import { WreckBody } from "./wreck";

const T = TUNING;
const SUB = T.substep;
const H = CAR.comHeight;
const SPIN_DECAY = Math.exp(-T.spinDamping * SUB);
const STAB_K = T.stabilizerFreq * T.stabilizerFreq;
const STAB_C = 2 * T.stabilizerFreq;
const WHEEL_DECAY = Math.exp(-T.wheelAirDecay * SUB);
const TILT_DECAY = Math.exp(-T.landingTiltDecay * SUB);
/** Label used in crash events when the car hits the ramp structure. */
const RAMP_LABEL = "Curl";
/** Shared result of drainEvents() when nothing happened (frozen: never push into it). */
const NO_EVENTS = Object.freeze([]) as unknown as PhysicsEvent[];

type Surface = "ground" | "ramp" | "rampBack";

/** Offset of `angle` from the nearest full turn, in (−π, π]. */
function uprightError(angle: number): number {
  return angle - TAU * Math.round(angle / TAU);
}

/**
 * Arcade stunt physics for one level (see the design spec).
 * Grounded: 1D motion along the level profile. Airborne: 2D ballistic flight in
 * the x-y plane with pitch/roll. Crashed: free 3D rigid-body tumble.
 */
export class CarPhysics {
  readonly level: LevelDef;
  /** Updated in place every step; treat as read-only outside physics. */
  readonly car: CarSnapshot;

  private readonly track: TrackGeometry;
  private readonly shapes: ObstacleShape[];
  private readonly wreck: WreckBody;
  private readonly frame: TrackFrame = createFrame();
  private readonly hit = createRampHit();
  private readonly hull = new CarHull();
  private readonly rot = new Float64Array(9);
  private readonly pointX = new Float64Array(POINT_COUNT);
  private readonly pointY = new Float64Array(POINT_COUNT);
  private events: PhysicsEvent[] = [];
  private acc = 0;

  private mode: CarMode = "grounded";
  // Grounded: arc length (or x on the open ground plane), COM speed along the track.
  private s = 0;
  private v = 0;
  private onPlane = false;
  private planeX = 0;
  private reversing = false;
  /** Whole turns carried by pitch / roll while grounded (multiples of 2π). */
  private pitchBase = 0;
  private rollBase = 0;
  // Pose and motion in the stunt plane (kept in sync while grounded).
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private pitch = 0;
  private roll = 0;
  private pitchRate = 0;
  private rollRate = 0;
  /** Upright angle the stabilizer levels the player's axis onto (NaN: none). */
  private catchTarget = NaN;
  /** The spin input was held on the previous airborne sub-step. */
  private spinHeld = false;
  // Thrust.
  private gas = 1;
  private thrusting = false;
  private gasEmptySent = false;
  // Current jump.
  private airTime = 0;
  private fromRamp = false;
  private launchX = 0;
  private maxHeight = 0;
  private height = 0;
  /** Collision points still inside the ground / ramp shell since leaving them (bitmasks). */
  private groundMask = 0;
  private rampMask = 0;
  private topSpeed = 0;
  // Trick counter.
  private trickBasePitch = 0;
  private trickBaseRoll = 0;
  private flatTime = 0;
  /** Seconds since the last touchdown (lift-off cooldown). */
  private groundTime = 0;
  /** Full turns already announced by `flip` events, per axis. */
  private readonly flips: Record<SpinAxis, number> = { pitch: 0, roll: 0 };
  // Run end.
  private runEnded = false;
  private endTime = 0;
  private settledSent = false;
  // Visual extras.
  private wheelSpin = 0;
  private wheelRate = 0;
  private susp = 0;
  private suspRate = 0;
  private tiltPitch = 0;
  private tiltRoll = 0;
  private wreckPitch = 0;
  private wreckRoll = 0;

  constructor(level: LevelDef) {
    this.level = level;
    this.car = {
      mode: "grounded",
      position: { x: 0, y: 0, z: 0 },
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
    this.track = new TrackGeometry(level.profile);
    this.shapes = prepareObstacles(level.obstacles);
    this.wreck = new WreckBody(this.track, this.shapes, CURL_WIDTH / 2);
    this.reset();
  }

  /** Back to the level spawn at rest with a full tank. Clears pending events. */
  reset(): void {
    this.events = [];
    this.acc = 0;
    this.mode = "grounded";
    this.s = clamp(this.level.spawnS, 0, this.track.length);
    this.v = 0;
    this.onPlane = false;
    this.planeX = 0;
    this.reversing = false;
    this.pitchBase = 0;
    this.rollBase = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.catchTarget = NaN;
    this.spinHeld = false;
    this.gas = 1;
    this.thrusting = false;
    this.gasEmptySent = false;
    this.airTime = 0;
    this.fromRamp = false;
    this.launchX = 0;
    this.maxHeight = 0;
    this.height = 0;
    this.groundMask = 0;
    this.rampMask = 0;
    this.topSpeed = 0;
    this.trickBasePitch = 0;
    this.trickBaseRoll = 0;
    this.flatTime = T.trickResetDelay;
    this.groundTime = T.liftOffCooldown;
    this.flips.pitch = 0;
    this.flips.roll = 0;
    this.runEnded = false;
    this.endTime = 0;
    this.settledSent = false;
    this.wheelSpin = 0;
    this.wheelRate = 0;
    this.susp = 0;
    this.suspRate = 0;
    this.tiltPitch = 0;
    this.tiltRoll = 0;
    this.car.thrusters.fill(0);
    this.syncGroundPose(this.groundFrame());
    this.writeSnapshot(0, 0);
  }

  /** Advance by dt seconds of game time (uses fixed sub-steps internally). */
  step(dt: number, controls: Controls): void {
    const frameDt = dt > 0 ? Math.min(dt, T.maxFrame) : 0;
    this.acc += frameDt;
    const steps = Math.floor((this.acc + 1e-9) / SUB);
    this.acc = Math.max(0, this.acc - steps * SUB);
    const throttle = clamp(controls.throttle || 0, 0, 1);
    const brake = clamp(controls.brake || 0, 0, 1);
    const spin = clamp(controls.spin || 0, -1, 1);
    for (let i = 0; i < steps; i++) {
      // Controls are ignored once the run is over (scored landing or wreck).
      const live = !this.runEnded;
      const thrust = live && controls.thrust;
      if (this.mode === "grounded")
        this.stepGrounded(live ? throttle : 0, live ? brake : 0, thrust);
      else if (this.mode === "airborne")
        this.stepAirborne(thrust, live ? spin : 0);
      else this.stepWreck();
    }
    this.writeSnapshot(this.runEnded ? 0 : throttle, this.runEnded ? 0 : brake);
  }

  /** Events emitted since the previous call, oldest first. */
  drainEvents(): PhysicsEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------------ grounded

  private groundFrame(): TrackFrame {
    const f = this.frame;
    if (!this.onPlane) return this.track.frameAt(this.s, f);
    f.x = this.planeX;
    f.y = 0;
    f.angle = 0;
    f.curvature = 0;
    f.tx = 1;
    f.ty = 0;
    return f;
  }

  /** COM pose and plane velocity from the grounded state. */
  private syncGroundPose(f: TrackFrame): void {
    const along = 1 - f.curvature * H;
    this.px = f.x - f.ty * H;
    this.py = f.y + f.tx * H;
    this.vx = this.v * f.tx;
    this.vy = this.v * f.ty;
    this.pitch = this.pitchBase + f.angle;
    this.roll = this.rollBase;
    this.pitchRate = (this.v / along) * f.curvature;
    this.rollRate = 0;
  }

  private stepGrounded(throttle: number, brake: number, thrust: boolean): void {
    let f = this.groundFrame();
    this.groundTime += SUB;

    if (
      thrust &&
      this.gas > 0 &&
      Math.abs(f.angle) < T.liftOffMaxAngle &&
      this.groundTime >= T.liftOffCooldown
    ) {
      this.launch(false);
      return;
    }

    // Accelerations along the track: drive terms, then resistances that only oppose motion.
    let v = this.v;
    const cosA = f.tx;
    let drive = -GRAVITY * f.ty - T.drag * v * Math.abs(v);
    let resist = T.rollingResistance;
    if (this.runEnded) {
      resist += T.autoBrakeDecel;
    } else {
      const motorFalloff = Math.max(0, 1 - (v / T.motorTopSpeed) ** 2);
      drive += throttle * T.motorAccel * motorFalloff * Math.max(0, cosA);
      if (brake > 0 && throttle === 0) {
        if (!this.reversing && Math.abs(v) < T.reverseEngageSpeed)
          this.reversing = true;
      } else {
        this.reversing = false;
      }
      if (this.reversing) {
        // Reverse motor, never pushing past the reverse speed limit.
        const room = (v + T.reverseMaxSpeed) / SUB;
        if (room > 0) drive -= Math.min(T.reverseAccel * brake, room);
      } else if (brake > 0) {
        resist += T.brakeDecel * brake;
      }
    }
    v += drive * SUB;
    const r = resist * SUB;
    v = v > r ? v - r : v < -r ? v + r : 0;

    const prevS = this.s;
    const prevPlaneX = this.planeX;
    const wasOnRamp = this.isOnRamp();
    const along = 1 - f.curvature * H;
    if (this.onPlane) this.planeX += v * SUB;
    else this.s += (v / along) * SUB;
    this.v = v;

    // Profile ends: launch off a ramp lip, otherwise stop.
    if (!this.onPlane) {
      if (this.s >= this.track.length) {
        this.s = this.track.length;
        if (this.track.hasRamp && v > 0 && !this.runEnded) {
          f = this.groundFrame();
          this.syncGroundPose(f);
          this.launch(true);
          return;
        }
        this.v = Math.min(this.v, 0);
      } else if (this.s <= 0) {
        this.s = 0;
        this.v = Math.max(this.v, 0);
      }
    }

    f = this.groundFrame();
    this.syncGroundPose(f);
    if (!wasOnRamp && this.isOnRamp() && v > 0)
      this.events.push({ type: "rampEnter" });

    // Driving into an obstacle (or the back of the ramp from the open ground).
    const obstacle = this.groundedHit();
    if (obstacle !== null) {
      if (this.runEnded) {
        // The run is already scored: just stop against it.
        this.s = prevS;
        this.planeX = prevPlaneX;
        this.v = 0;
        this.syncGroundPose(this.groundFrame());
      } else {
        this.crash("obstacle", Math.abs(v), obstacle);
        return;
      }
    }

    this.updateTrickGrounded(f);
    const speed = Math.abs(this.v);
    if (speed > this.topSpeed) this.topSpeed = speed;
    this.wheelRate = this.v / along / CAR.wheelRadius;
    const load = (GRAVITY * f.tx + this.v * this.v * f.curvature) / GRAVITY - 1;
    this.stepVisuals(clamp(load * T.suspensionLoadScale, -1, 1));

    if (this.runEnded)
      this.checkSettled(
        Math.abs(this.v) < T.landSettleSpeed,
        T.landSettleTimeout
      );
  }

  private isOnRamp(): boolean {
    return !this.onPlane && this.track.isRamp(this.s);
  }

  /** Obstacle (or ramp-back) contact while driving: its label, or null. */
  private groundedHit(): string | null {
    const rampBack = this.onPlane && this.track.hasRamp;
    if (this.shapes.length === 0 && !rampBack) return null;
    poseMatrix(this.pitch, this.roll, this.rot);
    const obstacle = this.obstacleHit();
    if (obstacle !== null) return obstacle;
    if (rampBack) {
      this.computePoints();
      for (let i = 0; i < POINT_COUNT; i++)
        if (this.pointInRamp(i)) return RAMP_LABEL;
    }
    return null;
  }

  /** Label of the first obstacle the car's body box overlaps (rot must hold the pose). */
  private obstacleHit(): string | null {
    if (this.shapes.length === 0) return null;
    this.hull.set(this.px, this.py, this.rot);
    for (const o of this.shapes)
      if (hullOverlaps(this.hull, o, null)) return o.label;
    return null;
  }

  private updateTrickGrounded(f: TrackFrame): void {
    const flat = f.angle === 0 && f.curvature === 0;
    if (flat) {
      this.flatTime += SUB;
      if (this.flatTime >= T.trickResetDelay) {
        this.trickBasePitch = this.pitch;
        this.trickBaseRoll = this.roll;
        this.flips.pitch = 0;
        this.flips.roll = 0;
      }
    } else {
      this.flatTime = 0;
    }
  }

  /** Leaves the ground: off the ramp lip (fromRamp) or by thrust lift-off. */
  private launch(fromRamp: boolean): void {
    this.mode = "airborne";
    this.fromRamp = fromRamp;
    this.launchX = this.px;
    this.airTime = 0;
    this.maxHeight = 0;
    this.catchTarget = NaN;
    this.spinHeld = false;
    // A rigid car resting on a curved surface (the concave ramp, or straddling the
    // ramp base) has a few points slightly inside it: ignore those until they come out.
    this.groundMask = 0;
    this.rampMask = 0;
    poseMatrix(this.pitch, this.roll, this.rot);
    this.computePoints();
    for (let i = 0; i < POINT_COUNT; i++) {
      if (this.pointY[i] < 0) this.groundMask |= 1 << i;
      if (this.track.hasRamp && this.pointInRamp(i)) this.rampMask |= 1 << i;
    }
    this.events.push({
      type: "launch",
      position: { x: this.px, y: this.py, z: 0 },
      speed: Math.abs(this.v),
      fromRamp,
    });
  }

  // ------------------------------------------------------------------ airborne

  private stepAirborne(thrust: boolean, spin: number): void {
    const jets = this.car.thrusters;
    // Thrust along the car's up axis projected onto the stunt plane.
    const active = thrust && this.gas > 0;
    this.setThrusting(active);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cr = Math.cos(this.roll);
    let ax = 0;
    let ay = -GRAVITY;
    if (active) {
      ax += -sp * cr * T.thrustAccel;
      ay += cp * cr * T.thrustAccel;
      this.gas -= SUB / this.level.gasCapacity;
      if (this.gas <= 0) {
        this.gas = 0;
        if (!this.gasEmptySent) {
          this.gasEmptySent = true;
          this.events.push({ type: "gasEmpty" });
        }
      }
    }
    const speed = Math.hypot(this.vx, this.vy);
    ax -= T.drag * speed * this.vx;
    ay -= T.drag * speed * this.vy;
    this.vx += ax * SUB;
    this.vy += ay * SUB;
    this.px += this.vx * SUB;
    this.py += this.vy * SUB;

    // Rotation: the player's axis spins, the other axis is held level.
    const lift = active ? 1 : 0;
    jets[0] = jets[1] = jets[2] = jets[3] = lift;
    if (this.level.spinAxis === "pitch") {
      // ◀ (spin −1) pitches the nose up.
      const alpha = this.spinAxis(-spin, this.pitch, true);
      this.addJets(alpha, 0, 1, 2, 3);
    } else {
      const alpha = this.spinAxis(spin, this.roll, false);
      this.addJets(alpha, 0, 2, 1, 3);
      const err = uprightError(this.pitch);
      const hold = -T.holdStiffness * err - T.holdDamping * this.pitchRate;
      this.pitchRate += hold * SUB;
      this.addJets(
        clamp(hold / T.stabilizerAccel, -1, 1) * T.assistJetLevel,
        0,
        1,
        2,
        3
      );
    }
    this.pitch += this.pitchRate * SUB;
    this.roll += this.rollRate * SUB;
    for (let i = 0; i < 4; i++) if (jets[i] > 1) jets[i] = 1;

    this.airTime += SUB;
    const vel = Math.hypot(this.vx, this.vy);
    if (vel > this.topSpeed) this.topSpeed = vel;
    this.wheelRate *= WHEEL_DECAY;
    this.stepVisuals(0);
    this.updateTrickAirborne();

    this.collideAirborne();
  }

  /**
   * Player spin on one axis (input +1 increases the angle). Returns the applied angular
   * acceleration as a jet level: ±(spin level), or the stabilizer's share.
   */
  private spinAxis(input: number, angle: number, isPitch: boolean): number {
    let rate = isPitch ? this.pitchRate : this.rollRate;
    let jet = 0;
    if (input !== 0) {
      const max = T.spinMaxRate[isPitch ? "pitch" : "roll"];
      rate = clamp(rate + input * T.spinAccel * SUB, -max, max);
      jet = input * T.spinJetLevel;
      this.catchTarget = NaN;
    } else {
      if (this.spinHeld) {
        // Just let go: catch the release if it was close enough to an upright.
        const judged = angle - rate * T.catchReaction;
        const err = uprightError(judged);
        this.catchTarget = Math.abs(err) <= T.catchWindow ? judged - err : NaN;
      }
      if (Number.isNaN(this.catchTarget)) {
        rate *= SPIN_DECAY;
      } else {
        // Critically damped settle onto the caught upright, thruster-limited.
        const alpha = clamp(
          -STAB_K * (angle - this.catchTarget) - STAB_C * rate,
          -T.stabilizerAccel,
          T.stabilizerAccel
        );
        rate += alpha * SUB;
        jet = (alpha / T.stabilizerAccel) * T.assistJetLevel;
      }
    }
    this.spinHeld = input !== 0;
    if (isPitch) this.pitchRate = rate;
    else this.rollRate = rate;
    return jet;
  }

  /**
   * Adds a rotation jet level: positive feeds nozzles a and b (front pair for pitch,
   * left pair for roll), negative feeds c and d.
   */
  private addJets(level: number, a: number, b: number, c: number, d: number) {
    const jets = this.car.thrusters;
    if (level > 0) {
      jets[a] += level;
      jets[b] += level;
    } else if (level < 0) {
      jets[c] -= level;
      jets[d] -= level;
    }
  }

  private updateTrickAirborne(): void {
    this.countFlips("pitch", this.pitch - this.trickBasePitch);
    this.countFlips("roll", this.roll - this.trickBaseRoll);
  }

  /** Emits `flip` when the trick angle on `axis` completes another full turn. */
  private countFlips(axis: SpinAxis, angle: number): void {
    const turns = Math.floor((Math.abs(angle) + T.flipTolerance) / TAU);
    if (turns <= this.flips[axis]) return;
    this.flips[axis] = turns;
    this.events.push({ type: "flip", axis, turns: angle > 0 ? turns : -turns });
  }

  /** World x-y of every collision point for the current pose (rot must be set). */
  private computePoints(): void {
    const m = this.rot;
    for (let i = 0; i < POINT_COUNT; i++) {
      const lx = COLLISION_POINTS[i * 3];
      const ly = COLLISION_POINTS[i * 3 + 1];
      const lz = COLLISION_POINTS[i * 3 + 2];
      this.pointX[i] = this.px + m[0] * lx + m[1] * ly + m[2] * lz;
      this.pointY[i] = this.py + m[3] * lx + m[4] * ly + m[5] * lz;
    }
  }

  private pointInRamp(i: number): boolean {
    return (
      this.track.closestOnRamp(this.pointX[i], this.pointY[i], this.hit) &&
      TrackGeometry.inShell(this.hit, T.rampShellThickness)
    );
  }

  private collideAirborne(): void {
    poseMatrix(this.pitch, this.roll, this.rot);
    this.computePoints();

    // Height of the lowest point above the surface below it.
    let low = 0;
    for (let i = 1; i < CORNER_COUNT; i++)
      if (this.pointY[i] < this.pointY[low]) low = i;
    const lowY = this.pointY[low];
    this.height = Math.max(
      0,
      lowY - this.track.surfaceBelow(this.pointX[low], lowY)
    );
    if (this.height > this.maxHeight) this.maxHeight = this.height;

    const obstacle = this.obstacleHit();
    if (obstacle !== null) {
      this.crash("obstacle", Math.hypot(this.vx, this.vy), obstacle);
      return;
    }

    // Deepest penetration of the ground plane or the ramp shell.
    let depth = 0;
    let surface: Surface | null = null;
    let nx = 0;
    let ny = 1;
    let rampS = 0;
    for (let i = 0; i < POINT_COUNT; i++) {
      const bit = 1 << i;
      const d = -this.pointY[i];
      if (d <= 0) {
        this.groundMask &= ~bit;
        continue;
      }
      if (this.groundMask & bit) {
        if (d < T.leaveTolerance) continue;
        this.groundMask &= ~bit;
      }
      if (d > depth) {
        depth = d;
        surface = "ground";
      }
    }
    if (this.track.hasRamp) {
      const thickness = T.rampShellThickness;
      for (let i = 0; i < POINT_COUNT; i++) {
        const bit = 1 << i;
        if (!this.pointInRamp(i)) {
          this.rampMask &= ~bit;
          continue;
        }
        const hit = this.hit;
        const front = hit.dist > -thickness / 2;
        const d = front ? -hit.dist : thickness + hit.dist;
        if (this.rampMask & bit) {
          if (d < T.leaveTolerance) continue;
          this.rampMask &= ~bit;
        }
        if (d > depth) {
          depth = d;
          surface = front ? "ramp" : "rampBack";
          nx = front ? hit.nx : -hit.nx;
          ny = front ? hit.ny : -hit.ny;
          rampS = hit.s;
        }
      }
    }
    if (surface) this.touchdown(surface, nx, ny, rampS);
  }

  private touchdown(surface: Surface, nx: number, ny: number, rampS: number) {
    const impact = Math.max(0, -(this.vx * nx + this.vy * ny));
    if (surface === "rampBack") {
      this.crash("obstacle", impact, RAMP_LABEL);
      return;
    }
    // Angle between the car's 3D up axis and the (planar) surface normal.
    const cr = Math.cos(this.roll);
    const upX = -Math.sin(this.pitch) * cr;
    const upY = Math.cos(this.pitch) * cr;
    const angleError = Math.acos(clamp(upX * nx + upY * ny, -1, 1));
    const verdict = gradeLanding(angleError, impact);
    if (!verdict.ok) {
      this.crash(verdict.reason, impact);
      return;
    }

    // Snapshot the jump before switching to the grounded state.
    const trickPitch = this.pitch - this.trickBasePitch;
    const trickRoll = this.roll - this.trickBaseRoll;
    const touchX = this.px;
    const touchY = this.py;
    const airTime = this.airTime;

    if (surface === "ramp") {
      this.onPlane = false;
      if (this.track.closestOnRamp(this.px, this.py, this.hit, 10))
        this.s = this.hit.s;
      else this.s = rampS;
    } else {
      // On the runway, or on the open ground plane beyond the profile (behind the ramp).
      const t = this.track;
      const maxX = t.hasRamp ? t.runwayEndX + 1 : t.runwayEndX;
      this.onPlane = this.px < t.runwayStartX || this.px > maxX;
      this.planeX = this.px;
      if (!this.onPlane) this.s = clamp(this.px - t.runwayStartX, 0, t.length);
    }
    const f = this.groundFrame();
    this.v = (this.vx * f.tx + this.vy * f.ty) * T.landingSpeedKeep;
    const pitch = this.pitch;
    const roll = this.roll;
    this.pitchBase = TAU * Math.round((pitch - f.angle) / TAU);
    this.rollBase = TAU * Math.round(roll / TAU);
    this.mode = "grounded";
    this.reversing = false;
    this.setThrusting(false);
    this.car.thrusters.fill(0);
    this.syncGroundPose(f);
    this.tiltPitch = pitch - this.pitch;
    this.tiltRoll = roll - this.roll;
    this.susp = Math.max(this.susp, Math.min(1, impact / T.landingKickSpeed));
    this.wheelRate = this.v / CAR.wheelRadius;
    this.flatTime = 0;
    this.groundTime = 0;

    const runEnding =
      !this.runEnded &&
      (!this.level.goal.requireRampLaunch || this.fromRamp) &&
      this.maxHeight >= T.minScoredJumpHeight;
    if (!runEnding) return;
    this.runEnded = true;
    this.endTime = 0;
    const minX = this.level.goal.minTouchdownX;
    const result = buildLandingResult({
      level: this.level.id,
      grade: verdict.grade,
      angleError,
      impactSpeed: impact,
      trickPitch,
      trickRoll,
      stats: {
        airTime,
        maxHeight: this.maxHeight,
        distance: Math.abs(touchX - this.launchX),
        gasLeft: this.gas,
        topSpeed: this.topSpeed,
      },
      goalMet: minX === null || touchX >= minX,
    });
    this.events.push({
      type: "land",
      position: { x: touchX, y: touchY, z: 0 },
      result,
    });
  }

  private crash(reason: CrashReason, impact: number, obstacle?: string): void {
    this.mode = "crashed";
    this.runEnded = true;
    this.endTime = 0;
    this.settledSent = false;
    this.setThrusting(false);
    this.car.thrusters.fill(0);
    this.events.push({
      type: "crash",
      position: { x: this.px, y: this.py, z: 0 },
      impact,
      reason,
      ...(obstacle !== undefined ? { obstacle } : {}),
    });
    this.wreckPitch = this.pitch;
    this.wreckRoll = this.roll;
    this.wreck.start(
      this.px,
      this.py,
      this.vx,
      this.vy,
      this.pitch,
      this.roll,
      this.pitchRate,
      this.rollRate,
      impact
    );
  }

  // ------------------------------------------------------------------ crashed

  private readonly onImpact = (
    x: number,
    y: number,
    z: number,
    intensity: number
  ): void => {
    this.events.push({
      type: "impact",
      position: { x, y, z },
      intensity,
    });
  };

  private stepWreck(): void {
    const w = this.wreck;
    w.step(SUB, this.onImpact);
    this.wheelRate *= WHEEL_DECAY;
    this.stepVisuals(0);
    this.checkSettled(w.restTime >= T.wreck.restTime, T.wreck.timeout);
  }

  // ------------------------------------------------------------------ shared

  /** Emits `settled` once, when the car is at rest or `timeout` s after the run ended. */
  private checkSettled(atRest: boolean, timeout: number): void {
    if (this.settledSent) return;
    this.endTime += SUB;
    if (atRest || this.endTime >= timeout) {
      this.settledSent = true;
      this.events.push({ type: "settled" });
    }
  }

  private setThrusting(on: boolean): void {
    if (on === this.thrusting) return;
    this.thrusting = on;
    this.events.push({ type: on ? "thrustStart" : "thrustStop" });
  }

  /**
   * How far the lowest box corner of a grounded car posed at (pitch, roll) would sink
   * below its tire contact plane, whose normal is (nx, ny).
   */
  private cornerDepth(
    pitch: number,
    roll: number,
    nx: number,
    ny: number
  ): number {
    const m = this.rot;
    poseMatrix(pitch, roll, m);
    let depth = 0;
    for (let i = 0; i < CORNER_COUNT; i++) {
      const lx = COLLISION_POINTS[i * 3];
      const ly = COLLISION_POINTS[i * 3 + 1];
      const lz = COLLISION_POINTS[i * 3 + 2];
      const along =
        (m[0] * lx + m[1] * ly + m[2] * lz) * nx +
        (m[3] * lx + m[4] * ly + m[5] * lz) * ny;
      depth = Math.max(depth, -(H + along));
    }
    return depth;
  }

  /** Wheel rotation, suspension spring toward `target` and decay of the touchdown tilt. */
  private stepVisuals(target: number): void {
    this.wheelSpin += this.wheelRate * SUB;
    const w = T.suspensionFreq;
    const accel =
      -w * w * (this.susp - target) -
      2 * T.suspensionDampingRatio * w * this.suspRate;
    this.suspRate += accel * SUB;
    this.susp = clamp(this.susp + this.suspRate * SUB, -1, 1);
    this.tiltPitch *= TILT_DECAY;
    this.tiltRoll *= TILT_DECAY;
    if (Math.abs(this.tiltPitch) < 1e-4) this.tiltPitch = 0;
    if (Math.abs(this.tiltRoll) < 1e-4) this.tiltRoll = 0;
  }

  /** Publishes the state to `car`, with the effective throttle and brake inputs. */
  private writeSnapshot(throttle: number, brake: number): void {
    const c = this.car;
    c.mode = this.mode;
    c.gas = this.gas;
    c.wheelSpin = this.wheelSpin;
    c.suspension = this.susp;
    c.throttle = throttle;
    c.brake = brake;
    if (this.mode === "crashed") {
      const w = this.wreck;
      c.position.x = w.px;
      c.position.y = w.py;
      c.position.z = w.pz;
      c.velocity.x = w.vx;
      c.velocity.y = w.vy;
      c.velocity.z = w.vz;
      c.quaternion.x = w.qx;
      c.quaternion.y = w.qy;
      c.quaternion.z = w.qz;
      c.quaternion.w = w.qw;
      // ZXY Euler angles of the tumbling body, kept continuous.
      const m = w.m;
      const roll = Math.asin(clamp(m[7], -1, 1));
      const pitch = Math.atan2(-m[1], m[4]);
      this.wreckRoll += uprightError(roll - this.wreckRoll);
      this.wreckPitch += uprightError(pitch - this.wreckPitch);
      c.pitch = this.wreckPitch;
      c.roll = this.wreckRoll;
      c.speed = w.speed;
      c.onRamp = false;
      c.heightAboveGround = w.lowest;
      c.airTime = 0;
      return;
    }
    const grounded = this.mode === "grounded";
    const pitch = this.pitch + (grounded ? this.tiltPitch : 0);
    const roll = this.roll + (grounded ? this.tiltRoll : 0);
    c.position.x = this.px;
    c.position.y = this.py;
    c.position.z = 0;
    if (grounded && (this.tiltPitch !== 0 || this.tiltRoll !== 0)) {
      // The touchdown tilt pivots on the lowest corner instead of sinking into the ground.
      const f = this.groundFrame();
      const lift = this.cornerDepth(pitch, roll, -f.ty, f.tx);
      c.position.x -= f.ty * lift;
      c.position.y += f.tx * lift;
    }
    c.velocity.x = this.vx;
    c.velocity.y = this.vy;
    c.velocity.z = 0;
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    const cr = Math.cos(roll / 2);
    const sr = Math.sin(roll / 2);
    c.quaternion.x = cp * sr;
    c.quaternion.y = sp * sr;
    c.quaternion.z = sp * cr;
    c.quaternion.w = cp * cr;
    c.pitch = pitch;
    c.roll = roll;
    c.speed = grounded ? this.v : Math.hypot(this.vx, this.vy);
    c.onRamp = grounded && this.isOnRamp();
    c.heightAboveGround = grounded ? 0 : this.height;
    c.airTime = grounded ? 0 : this.airTime;
    c.trickPitch = this.pitch - this.trickBasePitch;
    c.trickRoll = this.roll - this.trickBaseRoll;
  }
}
