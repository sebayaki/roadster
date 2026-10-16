import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Normalizes a geometry for merging: indexed, `position` + `normal` only
 * (plus `color` when `keepColor`).
 */
export function prep(
  geometry: THREE.BufferGeometry,
  keepColor = false
): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name === "position" || name === "normal") continue;
    if (keepColor && name === "color") continue;
    geometry.deleteAttribute(name);
  }
  if (!geometry.index) {
    const count = geometry.getAttribute("position").count;
    const index: number[] = [];
    for (let i = 0; i < count; i++) index.push(i);
    geometry.setIndex(index);
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  return geometry;
}

/** Merges prepared geometries and disposes the parts. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("roadster: geometry merge failed");
  for (const part of parts) part.dispose();
  return merged;
}

/** Axis-aligned box between two corners (car-local), prepared for merging. */
export function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(
    Math.abs(x1 - x0),
    Math.abs(y1 - y0),
    Math.abs(z1 - z0)
  );
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return prep(g);
}

/**
 * Prism from a polygon in the x-y plane (counter-clockwise), extruded from z0 to z1.
 * Hard edges, flat faces.
 */
export function prismXY(
  outline: ReadonlyArray<readonly [number, number]>,
  z0: number,
  z1: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape(
    outline.map(([x, y]) => new THREE.Vector2(x, y))
  );
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0,
    bevelEnabled: false,
  });
  g.translate(0, 0, z0);
  return prep(g);
}

/** Paints every vertex of a prepared geometry with one (possibly HDR) color. */
export function tint(
  geometry: THREE.BufferGeometry,
  color: THREE.Color
): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Reverses the triangle winding of an indexed geometry in place. */
export function flipWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex();
  if (!index) return;
  const arr = index.array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = t;
  }
  index.needsUpdate = true;
}

/** Mirror copy across the car's center plane (z -> -z), keeping outward winding. */
export function mirrorZ(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.clone();
  g.scale(1, 1, -1);
  flipWinding(g);
  return g;
}
