import * as THREE from "three";

/** One cross-section position along the loft axis (car-local x). */
export interface Station {
  x: number;
  /**
   * Hard edge across the loft here for half-section points in [from, to]: faces
   * before and after do not share normals there. Omit for a smooth station.
   */
  crease?: readonly [number, number];
  /** Free-form tag passed back to the section callback (e.g. "inside a wheel arch"). */
  tag?: number;
}

/**
 * A mirrored loft along +x. Each station's half section runs from the bottom center
 * line (index 0, z = 0) around the +z side to the top center line (index n-1, z = 0);
 * the -z side is mirrored. Faces are split into one geometry per material.
 */
export interface LoftSpec {
  /** Sorted by increasing x. */
  stations: Station[];
  /** Points per half section, both center-line points included. */
  halfCount: number;
  /** Writes the half section of `station` into `z` / `y` (length halfCount). */
  section(station: Station, z: Float64Array, y: Float64Array): void;
  /** Material index for half-section segment j (points j..j+1) between two stations; -1 = no faces. */
  material(j: number, x0: number, x1: number): number;
  /** Whether half-section point j is a hard edge at x (separate normals on either side). */
  crease(j: number, x: number): boolean;
  materialCount: number;
}

/** Output of a loft: one indexed geometry per material plus the raw rings. */
export interface LoftResult {
  geometries: THREE.BufferGeometry[];
  /** Full rings (x, y, z per point, 2 * (halfCount - 1) points) per station. */
  rings: Float32Array[];
}

export function buildLoft(spec: LoftSpec): LoftResult {
  const { stations, halfCount } = spec;
  const ringSize = 2 * (halfCount - 1);
  const halfIndex = (f: number) => (f < halfCount ? f : ringSize - f);
  const sideSign = (f: number) => (f < halfCount ? 1 : -1);
  /** Half-section segment that full-ring segment f (points f..f+1) mirrors. */
  const halfSegment = (f: number) => (f < halfCount - 1 ? f : ringSize - f - 1);

  const zs = new Float64Array(halfCount);
  const ys = new Float64Array(halfCount);
  const rings = stations.map((st) => {
    spec.section(st, zs, ys);
    const ring = new Float32Array(ringSize * 3);
    for (let f = 0; f < ringSize; f++) {
      const h = halfIndex(f);
      ring[f * 3] = st.x;
      ring[f * 3 + 1] = ys[h];
      ring[f * 3 + 2] = zs[h] * sideSign(f);
    }
    return ring;
  });

  const positions: number[][] = [];
  const indices: number[][] = [];
  const lookup: Map<number, number>[] = [];
  for (let m = 0; m < spec.materialCount; m++) {
    positions.push([]);
    indices.push([]);
    lookup.push(new Map());
  }

  // Vertex identity: (station, ring point, which side of a crease along the ring,
  // which side of a crease station). Shared identities get smoothed normals.
  const vertex = (
    m: number,
    i: number,
    f: number,
    afterPoint: boolean,
    afterStation: boolean
  ): number => {
    const st = stations[i];
    const h = halfIndex(f);
    const ringSide = spec.crease(h, st.x) ? (afterPoint ? 1 : 0) : 2;
    const split = st.crease && h >= st.crease[0] && h <= st.crease[1];
    const stationSide = split ? (afterStation ? 1 : 0) : 2;
    const key = ((i * ringSize + f) * 3 + ringSide) * 3 + stationSide;
    const map = lookup[m];
    let index = map.get(key);
    if (index === undefined) {
      index = map.size;
      map.set(key, index);
      const r = rings[i];
      positions[m].push(r[f * 3], r[f * 3 + 1], r[f * 3 + 2]);
    }
    return index;
  };

  for (let i = 0; i < stations.length - 1; i++) {
    const x0 = stations[i].x;
    const x1 = stations[i + 1].x;
    for (let f = 0; f < ringSize; f++) {
      const m = spec.material(halfSegment(f), x0, x1);
      if (m < 0) continue;
      const g = (f + 1) % ringSize;
      const a = vertex(m, i, f, true, true);
      const b = vertex(m, i + 1, f, true, false);
      const c = vertex(m, i, g, false, true);
      const d = vertex(m, i + 1, g, false, false);
      indices[m].push(a, b, c, b, d, c);
    }
  }

  const geometries = positions.map((pos, m) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setIndex(indices[m]);
    geometry.computeVertexNormals();
    return geometry;
  });
  return { geometries, rings };
}

/** Cap closing a ring: a triangle fan to `center`, facing +x (`front`) or -x. */
export function capRing(
  ring: Float32Array,
  center: THREE.Vector3,
  front: boolean
): THREE.BufferGeometry {
  const count = ring.length / 3;
  const pos: number[] = [center.x, center.y, center.z];
  for (let f = 0; f < count; f++) {
    pos.push(ring[f * 3], ring[f * 3 + 1], ring[f * 3 + 2]);
  }
  const index: number[] = [];
  for (let f = 0; f < count; f++) {
    const a = 1 + f;
    const b = 1 + ((f + 1) % count);
    if (front) index.push(0, b, a);
    else index.push(0, a, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
