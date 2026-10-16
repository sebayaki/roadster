import { BODY_BOX } from "@/core/car-spec";
import { GRAVITY } from "@/core/math";
import type { Quat } from "@/core/types";
import {
  CarHull,
  COLLISION_POINTS,
  CORNER_COUNT,
  createContact,
  hullOverlaps,
  poseQuaternion,
  quatMatrix,
  type ObstacleShape,
} from "./collision";
import { createRampHit, TrackGeometry } from "./track";
import { TUNING } from "./tuning";

const W = TUNING.wreck;
const LX = BODY_BOX.maxX - BODY_BOX.minX;
const LY = BODY_BOX.maxY - BODY_BOX.minY;
const LZ = BODY_BOX.maxZ - BODY_BOX.minZ;
/** Inverse principal moments of inertia of a unit-mass box (body frame). */
const INV_IX = 12 / (LY * LY + LZ * LZ);
const INV_IY = 12 / (LX * LX + LZ * LZ);
const INV_IZ = 12 / (LX * LX + LY * LY);
const MAX_CONTACTS = 32;

/** Called for wreck contacts hitting harder than the impact threshold. */
export type ImpactListener = (
  x: number,
  y: number,
  z: number,
  intensity: number
) => void;

/**
 * Free 3D rigid body (unit mass, box inertia) for the crashed car. Its 8 box corners
 * collide with the ground plane and the ramp shell; the projected box collides with
 * obstacle prisms. Sequential impulses with restitution and Coulomb friction.
 */
export class WreckBody {
  px = 0;
  py = 0;
  pz = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Orientation (unit quaternion). */
  readonly q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  /** Angular velocity, world frame (rad/s). */
  wx = 0;
  wy = 0;
  wz = 0;
  /** Row-major rotation matrix of the current orientation. */
  readonly m = new Float64Array(9);
  /** Seconds at rest (below the rest thresholds). */
  restTime = 0;
  /** Lowest corner height above y = 0. */
  lowest = 0;

  private readonly track: TrackGeometry;
  private readonly shapes: ObstacleShape[];
  private readonly rampHalfWidth: number;
  private readonly hit = createRampHit();
  private readonly hull = new CarHull();
  private readonly contact = createContact();
  private asleep = false;
  private sinceImpact = Infinity;
  // Contact list for the current sub-step (offset r from the COM, normal n, depth).
  private count = 0;
  private readonly crx = new Float64Array(MAX_CONTACTS);
  private readonly cry = new Float64Array(MAX_CONTACTS);
  private readonly crz = new Float64Array(MAX_CONTACTS);
  private readonly cnx = new Float64Array(MAX_CONTACTS);
  private readonly cny = new Float64Array(MAX_CONTACTS);
  private readonly cnz = new Float64Array(MAX_CONTACTS);
  private readonly cdepth = new Float64Array(MAX_CONTACTS);
  // Scratch output of applyInvInertia().
  private ix = 0;
  private iy = 0;
  private iz = 0;

  constructor(
    track: TrackGeometry,
    shapes: ObstacleShape[],
    rampHalfWidth: number
  ) {
    this.track = track;
    this.shapes = shapes;
    this.rampHalfWidth = rampHalfWidth;
  }

  /**
   * Starts tumbling from a stunt-plane pose. `impact` (m/s) adds a deterministic
   * out-of-plane tumble and sideways drift so the wreck does not stay flat.
   */
  start(
    px: number,
    py: number,
    vx: number,
    vy: number,
    pitch: number,
    roll: number,
    pitchRate: number,
    rollRate: number,
    impact: number
  ): void {
    this.px = px;
    this.py = py;
    this.pz = 0;
    this.vx = vx;
    this.vy = vy;
    const side = vx >= 0 ? 1 : -1;
    this.vz = W.drift * impact * side;
    poseQuaternion(pitch, roll, this.q);
    const m = this.m;
    quatMatrix(this.q, m);
    // Pitch spins about world z, roll about the car's forward axis; the extra tumble
    // rolls the car and yaws it about its up axis.
    const roll2 = rollRate + W.tumbleRoll * impact * side;
    const yaw = W.tumbleYaw * impact * side;
    this.wx = roll2 * m[0] + yaw * m[1];
    this.wy = roll2 * m[3] + yaw * m[4];
    this.wz = pitchRate + roll2 * m[6] + yaw * m[7];
    this.restTime = 0;
    this.asleep = false;
    this.sinceImpact = Infinity;
    this.updateLowest();
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  get spin(): number {
    return Math.hypot(this.wx, this.wy, this.wz);
  }

  step(dt: number, onImpact: ImpactListener): void {
    this.sinceImpact += dt;
    if (this.asleep) return;
    this.vy -= GRAVITY * dt;
    const lin = 1 - W.linearDamping * dt;
    const ang = 1 - W.angularDamping * dt;
    this.vx *= lin;
    this.vy *= lin;
    this.vz *= lin;
    this.wx *= ang;
    this.wy *= ang;
    this.wz *= ang;

    this.collectContacts();
    let hardest = 0;
    let hx = 0;
    let hy = 0;
    let hz = 0;
    for (let it = 0; it < W.iterations; it++) {
      for (let c = 0; c < this.count; c++) {
        const into = this.solve(c);
        if (it === 0 && into > hardest) {
          hardest = into;
          hx = this.px + this.crx[c];
          hy = this.py + this.cry[c];
          hz = this.pz + this.crz[c];
        }
      }
    }
    if (hardest > W.impactMinSpeed && this.sinceImpact >= W.impactInterval) {
      this.sinceImpact = 0;
      onImpact(hx, hy, hz, Math.min(1, hardest / W.impactFullSpeed));
    }
    // Positional correction along the deepest contact.
    let deepest = -1;
    let depth: number = W.slop;
    for (let c = 0; c < this.count; c++) {
      if (this.cdepth[c] > depth) {
        depth = this.cdepth[c];
        deepest = c;
      }
    }
    if (deepest >= 0) {
      const k = (depth - W.slop) * W.correction;
      this.px += this.cnx[deepest] * k;
      this.py += this.cny[deepest] * k;
      this.pz += this.cnz[deepest] * k;
    }

    this.px += this.vx * dt;
    this.py += this.vy * dt;
    this.pz += this.vz * dt;
    this.integrateRotation(dt);
    this.updateLowest();

    if (this.speed < W.restSpeed && this.spin < W.restSpin) {
      this.restTime += dt;
      if (this.restTime >= W.restTime) {
        this.asleep = true;
        this.vx = this.vy = this.vz = 0;
        this.wx = this.wy = this.wz = 0;
      }
    } else {
      this.restTime = 0;
    }
  }

  private collectContacts(): void {
    const m = this.m;
    this.count = 0;
    const track = this.track;
    const hit = this.hit;
    const thickness = TUNING.rampShellThickness;
    for (let i = 0; i < CORNER_COUNT; i++) {
      const lx = COLLISION_POINTS[i * 3];
      const ly = COLLISION_POINTS[i * 3 + 1];
      const lz = COLLISION_POINTS[i * 3 + 2];
      const rx = m[0] * lx + m[1] * ly + m[2] * lz;
      const ry = m[3] * lx + m[4] * ly + m[5] * lz;
      const rz = m[6] * lx + m[7] * ly + m[8] * lz;
      const wx = this.px + rx;
      const wy = this.py + ry;
      const wz = this.pz + rz;
      if (wy < 0) this.addContact(rx, ry, rz, 0, 1, 0, -wy);
      if (
        Math.abs(wz) <= this.rampHalfWidth &&
        track.closestOnRamp(wx, wy, hit, 0.5) &&
        TrackGeometry.inShell(hit, thickness)
      ) {
        // Push out through the nearer face of the shell.
        const front = hit.dist > -thickness / 2;
        const sign = front ? 1 : -1;
        const d = front ? -hit.dist : thickness + hit.dist;
        this.addContact(rx, ry, rz, hit.nx * sign, hit.ny * sign, 0, d);
      }
    }
    if (this.shapes.length === 0) return;
    this.hull.set(this.px, this.py, m);
    const c = this.contact;
    for (const o of this.shapes) {
      if (Math.abs(this.pz - o.z) > o.halfZ + 1) continue;
      if (!hullOverlaps(this.hull, o, c)) continue;
      this.addContact(
        c.px - this.px,
        c.py - this.py,
        0,
        c.nx,
        c.ny,
        0,
        c.depth
      );
    }
  }

  private addContact(
    rx: number,
    ry: number,
    rz: number,
    nx: number,
    ny: number,
    nz: number,
    depth: number
  ): void {
    if (this.count >= MAX_CONTACTS) return;
    const c = this.count++;
    this.crx[c] = rx;
    this.cry[c] = ry;
    this.crz[c] = rz;
    this.cnx[c] = nx;
    this.cny[c] = ny;
    this.cnz[c] = nz;
    this.cdepth[c] = depth;
  }

  /** World-frame I⁻¹ · u into (ix, iy, iz). */
  private applyInvInertia(ux: number, uy: number, uz: number): void {
    const m = this.m;
    const lx = (m[0] * ux + m[3] * uy + m[6] * uz) * INV_IX;
    const ly = (m[1] * ux + m[4] * uy + m[7] * uz) * INV_IY;
    const lz = (m[2] * ux + m[5] * uy + m[8] * uz) * INV_IZ;
    this.ix = m[0] * lx + m[1] * ly + m[2] * lz;
    this.iy = m[3] * lx + m[4] * ly + m[5] * lz;
    this.iz = m[6] * lx + m[7] * ly + m[8] * lz;
  }

  /** Normal + friction impulse for contact c. Returns the approach speed it removed. */
  private solve(c: number): number {
    const rx = this.crx[c];
    const ry = this.cry[c];
    const rz = this.crz[c];
    const nx = this.cnx[c];
    const ny = this.cny[c];
    const nz = this.cnz[c];
    // Velocity of the contact point: v + ω × r.
    let ux = this.vx + this.wy * rz - this.wz * ry;
    let uy = this.vy + this.wz * rx - this.wx * rz;
    let uz = this.vz + this.wx * ry - this.wy * rx;
    const vn = ux * nx + uy * ny + uz * nz;
    if (vn >= 0) return 0;
    const e = -vn > W.bounceThreshold ? W.restitution : 0;
    // k = 1/m + n · ((I⁻¹ (r × n)) × r)
    this.applyInvInertia(
      ry * nz - rz * ny,
      rz * nx - rx * nz,
      rx * ny - ry * nx
    );
    let ax = this.ix;
    let ay = this.iy;
    let az = this.iz;
    const kn =
      1 +
      nx * (ay * rz - az * ry) +
      ny * (az * rx - ax * rz) +
      nz * (ax * ry - ay * rx);
    const jn = (-(1 + e) * vn) / kn;
    this.vx += jn * nx;
    this.vy += jn * ny;
    this.vz += jn * nz;
    this.wx += ax * jn;
    this.wy += ay * jn;
    this.wz += az * jn;
    // Coulomb friction against the remaining tangential slip.
    ux = this.vx + this.wy * rz - this.wz * ry;
    uy = this.vy + this.wz * rx - this.wx * rz;
    uz = this.vz + this.wx * ry - this.wy * rx;
    const un = ux * nx + uy * ny + uz * nz;
    ux -= un * nx;
    uy -= un * ny;
    uz -= un * nz;
    const slip = Math.hypot(ux, uy, uz);
    if (slip > 1e-6) {
      const tx = ux / slip;
      const ty = uy / slip;
      const tz = uz / slip;
      this.applyInvInertia(
        ry * tz - rz * ty,
        rz * tx - rx * tz,
        rx * ty - ry * tx
      );
      ax = this.ix;
      ay = this.iy;
      az = this.iz;
      const kt =
        1 +
        tx * (ay * rz - az * ry) +
        ty * (az * rx - ax * rz) +
        tz * (ax * ry - ay * rx);
      const jt = Math.min(slip / kt, W.friction * jn);
      this.vx -= jt * tx;
      this.vy -= jt * ty;
      this.vz -= jt * tz;
      this.wx -= ax * jt;
      this.wy -= ay * jt;
      this.wz -= az * jt;
    }
    return -vn;
  }

  private integrateRotation(dt: number): void {
    const { wx, wy, wz, q } = this;
    const { x: qx, y: qy, z: qz, w: qw } = q;
    const h = dt / 2;
    const x = qx + h * (wx * qw + wy * qz - wz * qy);
    const y = qy + h * (wy * qw + wz * qx - wx * qz);
    const z = qz + h * (wz * qw + wx * qy - wy * qx);
    const w = qw - h * (wx * qx + wy * qy + wz * qz);
    const len = Math.hypot(x, y, z, w) || 1;
    q.x = x / len;
    q.y = y / len;
    q.z = z / len;
    q.w = w / len;
    quatMatrix(q, this.m);
  }

  private updateLowest(): void {
    const m = this.m;
    let low = Infinity;
    for (let i = 0; i < CORNER_COUNT; i++) {
      const lx = COLLISION_POINTS[i * 3];
      const ly = COLLISION_POINTS[i * 3 + 1];
      const lz = COLLISION_POINTS[i * 3 + 2];
      const y = this.py + m[3] * lx + m[4] * ly + m[5] * lz;
      if (y < low) low = y;
    }
    this.lowest = Math.max(0, low);
  }
}
