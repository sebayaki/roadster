import * as THREE from "three";
import { clamp, damp, DEG, lerp, smoothstep } from "@/core/math";
import type { CarSnapshot, LevelDef, LevelId, Obstacle } from "@/core/types";
import { CURL_WIDTH } from "@/levels/backflip";

export type CameraMode =
  | "attract" // slow cinematic orbit behind the menu
  | "ready" // framing the car at the start line
  | "follow" // the run: chase, then the level's air view
  | "wreck" // orbit the tumbling car
  | "result"; // slow orbit while the result card is up

/** Base vertical field of view (degrees). */
const BASE_FOV = 55;
const TAN_HALF_FOV = Math.tan((BASE_FOV * DEG) / 2);
/** Extra field of view at chase speed (degrees), ramped in between these speeds (m/s). */
const SPEED_FOV = 8;
const FOV_SPEED_MIN = 16;
const FOV_SPEED_MAX = 34;

/** Trauma lost per second; the shake amplitude is trauma². */
const TRAUMA_DECAY = 1.5;
const SHAKE_YAW = 2.4 * DEG;
const SHAKE_PITCH = 2.0 * DEG;
const SHAKE_ROLL = 3.0 * DEG;

/** Seconds to blend from the previous framing into a new mode. */
const MODE_BLEND: Record<CameraMode, number> = {
  attract: 1.5,
  ready: 0.9,
  follow: 1.1,
  wreck: 0.7,
  result: 1.6,
};

/** Side views: room around the car along the stunt plane, so it never hugs the frame edge (m). */
const CAR_MARGIN = 8;
/** Side views: extra room ahead of the car, in seconds of its horizontal travel (capped, m). */
const LEAD_TIME = 0.7;
const LEAD_MAX = 18;
/**
 * In-run side views (m from the stunt plane). Width fits and panning stay in
 * front of the near-side props: floodlight towers from z ≈ 44 along the
 * backflip runway, stage light rigs at z ≈ 30 beside the lineup. Only the
 * Curl's height may push the backflip camera further out, while it frames the
 * lip, where those towers are far off to the side.
 */
const BACKFLIP_SIDE_DISTANCE = 42;
const BACKFLIP_SIDE_MAX = 58;
const LINEUP_SIDE_MAX = 28;
/** In-run side views keep the stunt below the HUD's top-center hint (NDC). */
const SIDE_TOP_NDC = 0.6;
/**
 * Highest ground line a side view accepts to clear the HUD (NDC). While the
 * Curl's lip must stay in frame, short screens let the HUD overlap the ground;
 * otherwise the ground may rise to the relaxed limit.
 */
const MAX_SIDE_GROUND_NDC = -0.4;
const MAX_SIDE_GROUND_NDC_RELAXED = -0.15;
/** Side-view dolly rates (1/s): out quickly to keep the car in frame, back in slowly. */
const DOLLY_OUT_RATE = 5;
const DOLLY_IN_RATE = 1.2;
/** Side views reserve headroom for this many seconds of the car's climb. */
const CLIMB_LOOKAHEAD = 0.4;

/** Menu hero shots fit between the title (top) and the stunt cards (bottom), in NDC. */
const ATTRACT_TOP_NDC = 0.55;
const ATTRACT_GROUND_NDC = -0.14;
/** Menu Curl shot: far enough to fit the whole flight square on (m). */
const ATTRACT_MAX_DISTANCE = 95;
/** Menu lineup shot: stays in front of the stage lights (depth, m); a high flight may pass under the subtitle. */
const LINEUP_ATTRACT_DEPTH = LINEUP_SIDE_MAX;
const ATTRACT_TOP_NDC_LINEUP = 0.7;
/** Result orbit: the car sits beside the centered result card on landscape screens (NDC x). */
const RESULT_SCREEN_X = 0.7;

/**
 * Bottom strip the in-run HUD covers under the car (px). In-run shots keep the
 * car and the ground line above it, which matters on short screens. Desktop:
 * the speed / gas cluster. Touch portrait: the thumb controls (the slim speed
 * bar moves to the top). Touch landscape: only the slim bar between the thumbs.
 */
const HUD_BOTTOM_PX = 160;
const HUD_BOTTOM_PX_TOUCH_PORTRAIT = 150;
const HUD_BOTTOM_PX_TOUCH_LANDSCAPE = 72;
/** Where the bottom of the car sits in the chase / ready shots (NDC y). */
const CHASE_CAR_BOTTOM_NDC = -0.37;
/** Gap kept between the HUD strip and the car or the ground line (NDC). */
const HUD_CLEARANCE = 0.06;

/** The camera never dips below this height (m). */
const MIN_CAMERA_Y = 0.6;
/** Clearance kept around parked vehicles (m). */
const OBSTACLE_MARGIN = 2;

/** Camera placement: eye position, look-at point and vertical FOV (degrees). */
interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

function createPose(): Pose {
  return {
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: BASE_FOV,
  };
}

function copyPose(out: Pose, a: Pose): void {
  out.pos.copy(a.pos);
  out.target.copy(a.target);
  out.fov = a.fov;
}

/** out = a + (b - a) * t; `out` may alias `a` or `b`. */
function lerpPose(out: Pose, a: Pose, b: Pose, t: number): void {
  out.pos.lerpVectors(a.pos, b.pos, t);
  out.target.lerpVectors(a.target, b.target, t);
  out.fov = lerp(a.fov, b.fov, t);
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Cheap smooth pseudo-noise in [-1, 1] for camera shake. */
function shakeNoise(t: number, seed: number): number {
  return (
    0.6 * Math.sin(t * 21.7 + seed) + 0.4 * Math.sin(t * 34.3 + seed * 2.3)
  );
}

/** A 0..1 switch that ramps linearly toward its goal over `duration` seconds and reads eased. */
class EasedSwitch {
  duration: number;
  private u = 0;

  constructor(duration: number) {
    this.duration = duration;
  }

  update(goal: boolean, dt: number): number {
    this.u = clamp(this.u + (goal ? dt : -dt) / this.duration, 0, 1);
    return this.value;
  }

  reset(goal: boolean): void {
    this.u = goal ? 1 : 0;
  }

  get value(): number {
    return smoothstep(0, 1, this.u);
  }
}

/** A region of the stunt plane (z = 0) to frame from the audience side (+z). */
interface SideShot {
  minX: number;
  maxX: number;
  /** Highest point that must stay in frame (m). */
  topY: number;
  /** Span around the car that always stays in frame (m); a subset of [minX, maxX]. */
  keepMin: number;
  keepMax: number;
  baseDistance: number;
  minDistance: number;
  maxDistance: number;
  /** Dolly-out limit for fitting the width: beyond it the frame pans with the car instead. */
  maxWidthDistance: number;
  camHeight: number;
  /** Screen height of the ground line under the stunt (NDC, -1 bottom .. 1 top). */
  groundNdc: number;
  /** Highest screen height `topY` may reach (NDC). */
  topNdc: number;
  /** Swing of the camera around the framed center (rad, + toward +x). */
  yaw: number;
}

/** Angle (rad) between the view axis and screen height `ndc` at the base FOV. */
function ndcAngle(ndc: number): number {
  return Math.atan(ndc * TAN_HALF_FOV);
}

/** Angle subtended between the ground and height `top` seen from height `eye` at distance `d`. */
function angularSpan(top: number, eye: number, d: number): number {
  return Math.atan((top - eye) / d) + Math.atan(eye / d);
}

const sideFit = { distance: 0, centerX: 0 };

/**
 * Distance and center for a side shot: the ground line sits at `groundNdc`,
 * `topY` stays under `topNdc`, and [minX, maxX] fits the width when the
 * distance allows; otherwise the frame slides just enough to keep
 * [keepMin, keepMax] in view (a no-op while the region fits, so it is continuous).
 */
function fitSide(shot: SideShot, aspect: number): void {
  const eye = shot.camHeight;
  const allowed = ndcAngle(shot.topNdc) + ndcAngle(-shot.groundNdc);
  let lo = shot.minDistance;
  let hi = shot.maxDistance;
  if (angularSpan(shot.topY, eye, lo) > allowed) {
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (angularSpan(shot.topY, eye, mid) > allowed) lo = mid;
      else hi = mid;
    }
    lo = hi;
  }
  // The tilt shortens the view depth at ground level a little: keep some slack.
  const widthPerMeter = aspect * TAN_HALF_FOV * 0.94;
  const halfWidth = (shot.maxX - shot.minX) / 2;
  const fitWidth = Math.min(halfWidth / widthPerMeter, shot.maxWidthDistance);
  const distance = clamp(
    Math.max(shot.baseDistance, lo, fitWidth),
    shot.minDistance,
    shot.maxDistance
  );
  const visible = widthPerMeter * distance;
  sideFit.distance = distance;
  sideFit.centerX = clamp(
    (shot.minX + shot.maxX) / 2,
    shot.keepMax - visible,
    shot.keepMin + visible
  );
}

/** Drives the perspective camera for every phase of a run. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private mode: CameraMode = "attract";
  private alt = false;
  private time = 0;
  private trauma = 0;

  // Level layout in the stunt plane, for framing and keep-out volumes.
  private levelId: LevelId | null = null;
  private sideAir = true;
  private focusX = 0;
  private hasRamp = false;
  private rampBaseX = Infinity;
  private rampMaxX = 0;
  private lipY = 0;
  private readonly rampBox = { x0: 0, x1: 0, y1: 0, z: 0 };
  private obstacles: readonly Obstacle[] = [];
  private lineupMinX = 0;
  private lineupMaxX = 0;
  private lineupTop = 0;

  // Eased framing weights.
  private readonly air = new EasedSwitch(1.2);
  private readonly altBlend = new EasedSwitch(0.8);
  /** The car has left the ground since the last snap (keeps the backflip side view). */
  private launched = false;
  /** Attract: weight of the hero shot, latched once the car nears the stunt. */
  private hero = 0;

  // Mode transition, stored relative to the car so the blend follows it.
  private blendT = 1;
  private blendDuration = 1;
  private readonly blendFrom = createPose();

  // Smoothed side-view framing.
  private sideReady = false;
  private sideDistance = 0;
  private sideCenterX = 0;
  private readonly shot: SideShot = {
    minX: 0,
    maxX: 0,
    topY: 0,
    keepMin: 0,
    keepMax: 0,
    baseDistance: 0,
    minDistance: 0,
    maxDistance: 0,
    maxWidthDistance: 0,
    camHeight: 0,
    groundNdc: 0,
    topNdc: 0,
    yaw: 0,
  };

  // Orbits (wreck / result).
  private orbitReady = false;
  private orbitAzimuth = 0;
  private readonly orbitCenter = new THREE.Vector3();

  /** Top edge of the in-run HUD's bottom strip (NDC), measured every frame. */
  private hudTop = -1;
  private readonly coarsePointer: MediaQueryList | null =
    typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;

  private readonly lastCarPos = new THREE.Vector3();
  /** Last applied pose, before shake. */
  private readonly current = createPose();
  private readonly desired = createPose();
  private readonly poseA = createPose();
  private readonly poseB = createPose();
  private readonly poseC = createPose();
  private readonly blendPose = createPose();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setLevel(level: LevelDef): void {
    if (level.id !== this.levelId) this.alt = false;
    this.levelId = level.id;
    this.sideAir = level.camera.airView === "side";
    this.focusX = level.camera.focusX;
    this.air.duration = this.sideAir ? 1.2 : 0.9;

    const profile = level.profile;
    this.hasRamp = profile.rampStart < profile.length;
    this.rampBaseX = Infinity;
    if (this.hasRamp) {
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const s of profile.samples(0.5, profile.rampStart, profile.length)) {
        maxX = Math.max(maxX, s.x);
        maxY = Math.max(maxY, s.y);
      }
      this.rampBaseX = profile.sample(profile.rampStart).x;
      this.rampMaxX = maxX;
      this.lipY = profile.sample(profile.length).y;
      // The Curl, its apron and the truss tower behind it.
      this.rampBox.x0 = this.rampBaseX - 3;
      this.rampBox.x1 = maxX + 6.5;
      this.rampBox.y1 = maxY + 2.5;
      this.rampBox.z = CURL_WIDTH / 2 + 3.5;
    }

    this.obstacles = level.obstacles;
    this.lineupMinX = Infinity;
    this.lineupMaxX = -Infinity;
    this.lineupTop = 0;
    for (const o of level.obstacles) {
      this.lineupMinX = Math.min(this.lineupMinX, o.x - o.sizeX / 2);
      this.lineupMaxX = Math.max(this.lineupMaxX, o.x + o.sizeX / 2);
      this.lineupTop = Math.max(this.lineupTop, o.baseY + o.sizeY);
    }
    if (level.obstacles.length === 0) {
      this.lineupMinX = this.focusX;
      this.lineupMaxX = this.focusX;
    }
    this.sideReady = false;
    this.orbitReady = false;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.blendFrom.pos.copy(this.current.pos).sub(this.lastCarPos);
    this.blendFrom.target.copy(this.current.target).sub(this.lastCarPos);
    this.blendFrom.fov = this.current.fov;
    this.blendT = 0;
    this.blendDuration = MODE_BLEND[mode];
    this.sideReady = false;
    this.orbitReady = false;
    this.hero = 0;
  }

  /** "C" key: alternate between the level's default framing and a closer/alternate one. */
  cycleFraming(): void {
    this.alt = !this.alt;
  }

  /** Add trauma for screen shake (0..1, decays). */
  shake(intensity: number): void {
    this.trauma = clamp(this.trauma + intensity, 0, 1);
  }

  /** Jump straight to the current target (no smoothing), e.g. after a reset. */
  snap(car: CarSnapshot): void {
    this.blendT = 1;
    this.trauma = 0;
    this.sideReady = false;
    this.orbitReady = false;
    this.hero = 0;
    this.launched = car.mode === "airborne";
    this.measureHud();
    this.air.reset(this.airGoal(car));
    this.altBlend.reset(this.alt);
    this.compose(this.desired, car, 0);
    this.constrain(this.desired.pos);
    this.apply(this.desired, car, false);
  }

  update(dt: number, car: CarSnapshot): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    this.measureHud();
    const out = this.desired;
    this.compose(out, car, dt);
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDuration);
      const from = this.blendPose;
      from.pos.copy(this.blendFrom.pos).add(car.position);
      from.target.copy(this.blendFrom.target).add(car.position);
      from.fov = this.blendFrom.fov;
      lerpPose(out, from, out, smootherstep(this.blendT));
    }
    this.constrain(out.pos);
    this.apply(out, car, true);
  }

  private compose(out: Pose, car: CarSnapshot, dt: number): void {
    // Every shot keeps the base FOV; only the chase widens it with speed.
    out.fov = BASE_FOV;
    switch (this.mode) {
      case "attract":
        this.attractShot(out, car, dt);
        break;
      case "ready":
        this.readyShot(out, car);
        break;
      case "follow":
        this.followShot(out, car, dt);
        break;
      case "wreck":
        this.orbitShot(out, car, dt, 13, 4.5, 0.35, 0);
        break;
      case "result":
        this.orbitShot(
          out,
          car,
          dt,
          14,
          2.6,
          0.12,
          this.camera.aspect >= 1.2 ? RESULT_SCREEN_X : 0
        );
        break;
    }
  }

  private airGoal(car: CarSnapshot): boolean {
    if (this.sideAir) {
      return this.launched || car.onRamp || car.mode !== "grounded";
    }
    return car.mode !== "grounded";
  }

  /** Behind and slightly to the side of the car at the start line, drifting gently. */
  private readyShot(out: Pose, car: CarSnapshot): void {
    const p = car.position;
    const drift = Math.sin(this.time * 0.4);
    out.pos.set(p.x - 6.4 - 0.5 * drift, p.y + 1.05, p.z + 3.0);
    out.target.set(p.x + 2.2, p.y + 0.15, p.z);
    this.clearHud(out);
  }

  private followShot(out: Pose, car: CarSnapshot, dt: number): void {
    if (car.mode === "airborne") this.launched = true;
    const airW = this.air.update(this.airGoal(car), dt);
    const altW = this.altBlend.update(this.alt, dt);
    let chaseW: number;
    if (this.sideAir) {
      // Backflip: chase on the runway, side view from +z once on the Curl; alt = high chase.
      this.chaseBackflip(this.poseA, car);
      if (airW * (1 - altW) > 1e-3) {
        this.backflipSide(car, false);
        this.sideShot(this.poseB, dt);
        lerpPose(out, this.poseA, this.poseB, airW);
      } else {
        this.sideReady = false;
        copyPose(out, this.poseA);
      }
      if (altW > 1e-3) {
        this.highChase(this.poseC, car, airW);
        lerpPose(out, out, this.poseC, altW);
      }
      chaseW = (1 - airW) * (1 - altW);
    } else {
      // Kickflip: chase that rises and pulls back in the air; alt = side view of the lineup.
      this.chaseKickflip(out, car, airW);
      if (altW > 1e-3) {
        this.lineupSide(car);
        this.sideShot(this.poseB, dt);
        lerpPose(out, out, this.poseB, altW);
      } else {
        this.sideReady = false;
      }
      chaseW = 1 - altW;
    }
    const kick = smoothstep(FOV_SPEED_MIN, FOV_SPEED_MAX, Math.abs(car.speed));
    out.fov = BASE_FOV + SPEED_FOV * kick * chaseW;
  }

  /** ≈10 m behind and 3.2 m up, looking ahead; stays on the runway while the car climbs. */
  private chaseBackflip(out: Pose, car: CarSnapshot): void {
    const p = car.position;
    out.pos.set(Math.min(p.x, this.rampBaseX) - 10, 3.2, 0);
    const ahead = 6;
    out.target.set(
      p.x + Math.cos(car.pitch) * ahead,
      p.y + 0.7 + Math.max(0, Math.sin(car.pitch)) * ahead,
      0
    );
    this.clearHud(out);
  }

  /** Alternate backflip framing: high behind on the runway, then facing the Curl as the car flies back. */
  private highChase(out: Pose, car: CarSnapshot, airW: number): void {
    const p = car.position;
    const runX = Math.min(p.x, this.rampBaseX) - 16;
    const airX = Math.min(this.rampBaseX - 24, p.x - 22);
    const airY = clamp(p.y * 0.55 + 5, 5, 40);
    out.pos.set(
      lerp(runX, airX, airW),
      lerp(7.5, airY, airW),
      lerp(2.5, 7, airW)
    );
    out.target.set(lerp(p.x + 14, p.x, airW), lerp(0.8, p.y, airW), 0);
    this.clearHud(out);
  }

  /** Behind, slightly left and up with the lineup ahead; rises and pulls back in the air. */
  private chaseKickflip(out: Pose, car: CarSnapshot, airW: number): void {
    const p = car.position;
    out.pos.set(
      p.x - lerp(10.5, 14.5, airW),
      p.y + lerp(2.9, 3.8, airW),
      lerp(-2.4, -3.6, airW)
    );
    out.target.set(
      p.x + lerp(9, 3.5, airW),
      lerp(p.y + 0.5, Math.max(1.2, p.y * 0.55), airW),
      lerp(-0.3, 0, airW)
    );
    this.clearHud(out);
  }

  /**
   * The Curl, the lip and the runway below, framed around the car and the
   * level focus. Unless `keepLip`, the lip's headroom is released once the
   * car is well clear of the Curl, so the descent and touchdown get the frame.
   */
  private backflipSide(car: CarSnapshot, keepLip: boolean): void {
    const s = this.shot;
    const p = car.position;
    // A portrait frame is too narrow to show the lip and the landing zone
    // together; once the car is off the ramp it frames the car (closer) instead.
    const lipW =
      keepLip || car.onRamp
        ? 1
        : this.camera.aspect < 1
          ? 0
          : smoothstep(-45, -15, p.x);
    this.carWindow(car, LEAD_TIME);
    s.minX = Math.min(s.keepMin, this.focusX - 6);
    s.maxX = Math.max(s.keepMax, this.rampMaxX + 4);
    s.topY = Math.max(this.carTop(car, 3.5), (this.lipY + 3) * lipW);
    s.baseDistance = BACKFLIP_SIDE_DISTANCE;
    s.minDistance = 30;
    s.maxDistance = BACKFLIP_SIDE_MAX;
    s.maxWidthDistance = BACKFLIP_SIDE_DISTANCE;
    s.camHeight = 3.2;
    s.groundNdc = this.sideGroundNdc(-0.66, 1 - lipW);
    s.topNdc = SIDE_TOP_NDC;
    s.yaw = 0;
  }

  /** The lineup and the car, from the audience side, inside LINEUP_SIDE_MAX. */
  private lineupSide(car: CarSnapshot): void {
    const s = this.shot;
    this.carWindow(car, LEAD_TIME);
    s.minX = Math.min(s.keepMin, this.lineupMinX - 3);
    s.maxX = Math.max(s.keepMax, this.lineupMaxX + 3);
    s.topY = Math.max(this.carTop(car, 3), this.lineupTop + 2.5);
    s.baseDistance = LINEUP_SIDE_MAX - 4;
    s.minDistance = 18;
    s.maxDistance = LINEUP_SIDE_MAX;
    s.maxWidthDistance = LINEUP_SIDE_MAX;
    s.camHeight = 2.2;
    s.groundNdc = this.sideGroundNdc(-0.6, 1);
    s.topNdc = SIDE_TOP_NDC;
    s.yaw = 0;
  }

  /** Ground line of an in-run side view: `preferred`, raised to clear the HUD within the (relaxed) limit. */
  private sideGroundNdc(preferred: number, relax: number): number {
    const limit = lerp(MAX_SIDE_GROUND_NDC, MAX_SIDE_GROUND_NDC_RELAXED, relax);
    return clamp(this.hudTop + HUD_CLEARANCE, preferred, limit);
  }

  /** Highest point to keep in a side shot for the car: `margin` above it, more while it climbs. */
  private carTop(car: CarSnapshot, margin: number): number {
    return (
      car.position.y + margin + Math.max(0, car.velocity.y) * CLIMB_LOOKAHEAD
    );
  }

  /** The car's must-see span in a side shot, with room ahead in its direction of travel. */
  private carWindow(car: CarSnapshot, leadTime: number): void {
    const x = car.position.x;
    const lead = clamp(car.velocity.x * leadTime, -LEAD_MAX, LEAD_MAX);
    this.shot.keepMin = x - CAR_MARGIN + Math.min(0, lead);
    this.shot.keepMax = x + CAR_MARGIN + Math.max(0, lead);
  }

  /** Low camera at +z looking slightly up at `this.shot`, perpendicular to the stunt plane. */
  private sideShot(out: Pose, dt: number): void {
    const s = this.shot;
    fitSide(s, this.camera.aspect);
    if (!this.sideReady || dt <= 0) {
      this.sideReady = true;
      this.sideDistance = sideFit.distance;
      this.sideCenterX = sideFit.centerX;
    } else {
      const rate =
        sideFit.distance > this.sideDistance ? DOLLY_OUT_RATE : DOLLY_IN_RATE;
      this.sideDistance = damp(this.sideDistance, sideFit.distance, rate, dt);
      this.sideCenterX = damp(this.sideCenterX, sideFit.centerX, 4, dt);
    }
    const d = this.sideDistance;
    const tilt = Math.atan2(-s.camHeight, d) + ndcAngle(-s.groundNdc);
    out.target.set(this.sideCenterX, s.camHeight + d * Math.tan(tilt), 0);
    out.pos.set(
      this.sideCenterX + d * Math.sin(s.yaw),
      s.camHeight,
      d * Math.cos(s.yaw)
    );
  }

  /** Menu: a low tracking shot beside the car, easing into a hero shot of the stunt. */
  private attractShot(out: Pose, car: CarSnapshot, dt: number): void {
    const p = car.position;
    const t = this.time;
    const azimuth = 0.9 + 0.45 * Math.sin(t * 0.12);
    const radius = 8.5 + 1.5 * Math.sin(t * 0.07 + 1);
    const track = this.poseA;
    track.pos.set(
      p.x + radius * Math.cos(azimuth),
      1.1 + 0.4 * Math.sin(t * 0.1),
      p.z + radius * Math.sin(azimuth)
    );
    track.target.set(p.x + 1.2, p.y + 0.1, p.z);

    const near = this.sideAir
      ? smoothstep(-80, -35, p.x)
      : smoothstep(-62, -30, p.x);
    const active = car.mode !== "grounded" || car.onRamp ? 1 : near;
    this.hero = Math.max(this.hero, active);
    if (this.hero < 1e-3) {
      this.sideReady = false;
      copyPose(out, track);
      return;
    }
    // The menu frames the stunt between the title and the cards and fits the
    // whole flight (no lead, no pan) so the camera never swings behind props.
    // Portrait screens are too narrow for that: they frame the car and pan with it.
    const portrait = this.camera.aspect < 1;
    const s = this.shot;
    if (this.sideAir) {
      // Square on to the Curl; far out, but the towers stay out of frame.
      this.backflipSide(car, !portrait);
      s.yaw = 0.06 + 0.08 * Math.sin(t * 0.09);
      s.maxDistance = ATTRACT_MAX_DISTANCE;
      s.topNdc = ATTRACT_TOP_NDC;
    } else {
      // Three-quarter view from the approach, kept in front of the stage lights.
      this.lineupSide(car);
      s.yaw = -0.7 + 0.08 * Math.sin(t * 0.09);
      s.maxDistance = LINEUP_ATTRACT_DEPTH / Math.cos(s.yaw);
      s.topNdc = ATTRACT_TOP_NDC_LINEUP;
    }
    this.carWindow(car, 0);
    s.minX = Math.min(s.minX, s.keepMin);
    s.maxX = Math.max(s.maxX, s.keepMax);
    s.baseDistance = Math.min(s.baseDistance, 30);
    s.maxWidthDistance = portrait ? s.baseDistance : s.maxDistance;
    s.groundNdc = ATTRACT_GROUND_NDC;
    this.sideShot(this.poseB, dt);
    lerpPose(out, track, this.poseB, this.hero);
  }

  /**
   * Circles the (smoothed) car position, starting from the current camera
   * bearing; the car is held at `screenX` (NDC) across the frame.
   */
  private orbitShot(
    out: Pose,
    car: CarSnapshot,
    dt: number,
    radius: number,
    height: number,
    speed: number,
    screenX: number
  ): void {
    const p = car.position;
    const c = this.orbitCenter;
    if (!this.orbitReady || dt <= 0) {
      this.orbitReady = true;
      c.copy(p);
      this.orbitAzimuth = Math.atan2(
        this.current.pos.z - p.z,
        this.current.pos.x - p.x
      );
    } else {
      c.set(
        damp(c.x, p.x, 4, dt),
        damp(c.y, p.y, 4, dt),
        damp(c.z, p.z, 4, dt)
      );
    }
    this.orbitAzimuth += speed * dt;
    const cos = Math.cos(this.orbitAzimuth);
    const sin = Math.sin(this.orbitAzimuth);
    out.pos.set(
      c.x + radius * cos,
      Math.max(c.y, 0.5) + height,
      c.z + radius * sin
    );
    // Aim beside the car so it lands at `screenX`: looking along (-cos, 0, -sin),
    // the camera's right vector is (sin, 0, -cos).
    const shift = screenX * this.camera.aspect * TAN_HALF_FOV * radius;
    out.target.set(c.x - sin * shift, c.y + 0.2, c.z + cos * shift);
  }

  private measureHud(): void {
    const h = window.innerHeight;
    if (!h) {
      this.hudTop = -1;
      return;
    }
    const touch = this.coarsePointer !== null && this.coarsePointer.matches;
    const px = !touch
      ? HUD_BOTTOM_PX
      : h > window.innerWidth
        ? HUD_BOTTOM_PX_TOUCH_PORTRAIT
        : HUD_BOTTOM_PX_TOUCH_LANDSCAPE;
    this.hudTop = Math.min(0, -1 + (2 * px) / h);
  }

  /** Lowers the look-at point until the car (at CHASE_CAR_BOTTOM_NDC) clears the HUD strip. */
  private clearHud(out: Pose): void {
    const lift = this.hudTop + HUD_CLEARANCE - CHASE_CAR_BOTTOM_NDC;
    if (lift <= 0) return;
    out.target.y -= lift * TAN_HALF_FOV * out.pos.distanceTo(out.target);
  }

  /** Keeps the eye above the ground, over parked vehicles and out of the Curl and its truss. */
  private constrain(p: THREE.Vector3): void {
    for (const o of this.obstacles) {
      const inside = Math.min(
        o.sizeX / 2 + OBSTACLE_MARGIN - Math.abs(p.x - o.x),
        o.sizeZ / 2 + OBSTACLE_MARGIN - Math.abs(p.z - o.z)
      );
      if (inside > 0) {
        const clearY = o.baseY + o.sizeY + 1;
        if (p.y < clearY) {
          p.y = lerp(p.y, clearY, smoothstep(0, 1.5, inside));
        }
      }
    }
    if (this.hasRamp) {
      const b = this.rampBox;
      const inside = Math.min(p.x - b.x0, b.x1 - p.x, b.y1 - p.y);
      if (inside > 0) {
        const need = b.z * smoothstep(0, 2, inside);
        if (Math.abs(p.z) < need) p.z = p.z < 0 ? -need : need;
      }
    }
    p.y = Math.max(p.y, MIN_CAMERA_Y);
  }

  private apply(pose: Pose, car: CarSnapshot, shake: boolean): void {
    copyPose(this.current, pose);
    this.lastCarPos.copy(car.position);
    const cam = this.camera;
    cam.position.copy(pose.pos);
    cam.lookAt(pose.target);
    if (shake && this.trauma > 0) {
      const amount = this.trauma * this.trauma;
      const t = this.time;
      cam.rotateY(SHAKE_YAW * amount * shakeNoise(t, 1.3));
      cam.rotateX(SHAKE_PITCH * amount * shakeNoise(t, 7.1));
      cam.rotateZ(SHAKE_ROLL * amount * shakeNoise(t, 13.7));
    }
    if (Math.abs(cam.fov - pose.fov) > 0.01) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
  }
}
