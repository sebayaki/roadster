import * as THREE from "three";
import { CAR } from "@/core/car-spec";
import { merge, prep } from "./geo";

/**
 * Wheel geometry in the wheel's own frame: axle along +z (outer face toward +z),
 * centered on the wheel center. Left wheels are the same mesh turned 180° about y.
 */
export interface WheelGeometries {
  tire: THREE.BufferGeometry;
  /** Light satin disc behind the spokes. */
  disc: THREE.BufferGeometry;
  /** Six dark spokes, hub cap and rim lip. */
  spokes: THREE.BufferGeometry;
}

const R = CAR.wheelRadius;
const HALF = 0.145;
const RIM = 0.292;

/** Lathe around y, then turned so the lathe's +y becomes the axle (+z). */
function lathe(points: Array<[number, number]>, segments: number) {
  const g = new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments
  );
  g.rotateX(Math.PI / 2);
  return prep(g);
}

export function buildWheel(high: boolean): WheelGeometries {
  const seg = high ? 56 : 28;

  // Low-profile tire: thin sidewalls, squared shoulders.
  const tire = lathe(
    [
      [RIM + 0.004, -HALF + 0.004],
      [R - 0.03, -HALF - 0.002],
      [R - 0.01, -HALF + 0.012],
      [R, -HALF + 0.035],
      [R, HALF - 0.035],
      [R - 0.01, HALF - 0.012],
      [R - 0.03, HALF + 0.002],
      [RIM + 0.004, HALF - 0.004],
    ],
    seg
  );

  // Dished light disc set behind the spokes (faces +z).
  const disc = lathe(
    [
      [RIM, HALF - 0.022],
      [RIM - 0.02, HALF - 0.03],
      [0.2, HALF - 0.05],
      [0.11, HALF - 0.068],
      [0.05, HALF - 0.072],
      [0.0, HALF - 0.072],
    ],
    seg
  );

  // Dark rim lip, hub cap and six slender twisted blade spokes.
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    lathe(
      [
        [RIM + 0.006, HALF - 0.026],
        [RIM + 0.006, HALF - 0.004],
        [RIM - 0.006, HALF - 0.002],
        [RIM - 0.012, HALF - 0.024],
      ],
      seg
    )
  );
  parts.push(
    lathe(
      [
        [0.058, HALF - 0.06],
        [0.055, HALF - 0.02],
        [0.038, HALF - 0.01],
        [0.0, HALF - 0.008],
      ],
      high ? 24 : 12
    )
  );
  // Blade outline in (radial, tangential): thin at the hub, widest at ~70% radius.
  const grow = high ? 0 : 0.005;
  const shape = new THREE.Shape(
    (
      [
        [0.05, -0.011],
        [0.2, -0.018],
        [RIM - 0.004, -0.016],
        [RIM - 0.004, 0.016],
        [0.2, 0.018],
        [0.05, 0.011],
      ] as const
    ).map(([r, t]) => new THREE.Vector2(r, t + Math.sign(t) * grow))
  );
  const depth = 0.024;
  const bevel = high ? 0.005 : 0;
  for (let k = 0; k < 6; k++) {
    const spoke = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: high,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 1,
    });
    // Twist each blade about its own radial axis so one edge stands proud.
    spoke.translate(0, 0, -depth / 2);
    spoke.rotateX(0.5);
    spoke.translate(0, 0, HALF - 0.03);
    spoke.rotateZ((k * Math.PI) / 3 + Math.PI / 6);
    parts.push(prep(spoke));
  }
  return { tire, disc, spokes: merge(parts) };
}
