import * as THREE from "three";
import { type MeshBuilder, SLOT, type Slot } from "./geometry";

/**
 * spokes: dark dish with light spokes (Model 3 / Y aero wheels); aero: dark
 * cover with a bright lip (Cybertruck); cover: smooth light disc (Cybercab);
 * truck: aluminum disc with a dark hub (Semi).
 */
export type WheelStyle = "spokes" | "aero" | "cover" | "truck";

export interface WheelDef {
  /** Wheel center; the outer face points away from z = 0. */
  x: number;
  y: number;
  z: number;
  radius: number;
  width: number;
  /** Rim radius as a fraction of the tire radius. */
  rim: number;
  style: WheelStyle;
}

type Profile = Array<[radius: number, axial: number]>;

/** Ring slots (lip, face, hub) per style. */
const RINGS: Record<WheelStyle, [Slot, Slot, Slot]> = {
  spokes: [SLOT.rim, SLOT.trim, SLOT.rim],
  aero: [SLOT.rim, SLOT.trim, SLOT.rim],
  cover: [SLOT.trim, SLOT.rim, SLOT.rim],
  truck: [SLOT.rim, SLOT.rim, SLOT.trim],
};

/** Tire, rim dish and spokes of one wheel, merged into the builder's slots. */
export function addWheel(b: MeshBuilder, w: WheelDef, segments: number): void {
  const place = new THREE.Matrix4().compose(
    new THREE.Vector3(w.x, w.y, w.z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      w.z < 0 ? Math.PI : 0
    ),
    new THREE.Vector3(1, 1, 1)
  );
  // Lathe geometry revolves around +y; turn that axis onto the axle (+z).
  const axle = place
    .clone()
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const lathe = (slot: Slot, pts: Profile) => {
    const geo = new THREE.LatheGeometry(
      pts.map(([r, a]) => new THREE.Vector2(r, a)),
      segments
    );
    b.geometry(slot, geo, axle);
    geo.dispose();
  };

  const r = w.radius;
  const hw = w.width / 2;
  const rr = r * w.rim;
  const bev = Math.min(0.045, w.width * 0.18);
  lathe(SLOT.trim, [
    [rr * 1.02, -hw + 0.01],
    [r - bev, -hw],
    [r - bev * 0.25, -hw + bev * 0.6],
    [r, -hw + bev * 1.4],
    [r, hw - bev * 1.4],
    [r - bev * 0.25, hw - bev * 0.6],
    [r - bev, hw],
    [rr * 1.02, hw - 0.01],
  ]);

  const fz = hw - 0.016;
  const [lipSlot, faceSlot, hubSlot] = RINGS[w.style];
  lathe(lipSlot, [
    [rr * 1.04, fz + 0.006],
    [rr * 0.95, fz],
    [rr * 0.88, fz - 0.025],
  ]);
  lathe(faceSlot, [
    [rr * 0.88, fz - 0.025],
    [rr * 0.6, fz - 0.04],
    [rr * 0.3, fz - 0.04],
    [rr * 0.25, fz - 0.012],
  ]);
  lathe(hubSlot, [
    [rr * 0.25, fz - 0.012],
    [rr * 0.12, fz - 0.006],
    [0.001, fz - 0.005],
  ]);

  if (w.style === "spokes" || w.style === "aero") {
    const count = w.style === "spokes" ? 5 : 6;
    const inner = rr * 0.24;
    const outer = rr * 0.9;
    const mid = (inner + outer) / 2;
    const width = w.style === "spokes" ? rr * 0.2 : rr * 0.07;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + 0.3;
      const m = place
        .clone()
        .multiply(
          new THREE.Matrix4().compose(
            new THREE.Vector3(Math.cos(a) * mid, Math.sin(a) * mid, fz - 0.024),
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              a
            ),
            new THREE.Vector3(outer - inner, width, 0.022)
          )
        );
      b.boxMatrix(SLOT.rim, m);
    }
  }
}
