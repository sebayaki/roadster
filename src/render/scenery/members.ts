import * as THREE from "three";

export type Vec3Tuple = readonly [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();

/**
 * Collects straight structural members (tubes between two points) and turns
 * them into one InstancedMesh: one draw call for a whole truss or set of masts.
 */
export class MemberList {
  private readonly data: number[] = [];

  get count(): number {
    return this.data.length / 7;
  }

  /** Adds a tube of the given radius from `a` to `b`. */
  add(a: Vec3Tuple, b: Vec3Tuple, radius: number): void {
    this.data.push(a[0], a[1], a[2], b[0], b[1], b[2], radius);
  }

  /** Builds the instanced mesh (unit cylinder along +y scaled per member). */
  toMesh(
    material: THREE.Material,
    radialSegments = 6,
    name = "members"
  ): THREE.InstancedMesh {
    const geometry = new THREE.CylinderGeometry(
      1,
      1,
      1,
      radialSegments,
      1,
      true
    );
    const mesh = new THREE.InstancedMesh(geometry, material, this.count);
    mesh.name = name;
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      tmpA.set(this.data[o], this.data[o + 1], this.data[o + 2]);
      tmpB.set(this.data[o + 3], this.data[o + 4], this.data[o + 5]);
      const r = this.data[o + 6];
      tmpDir.subVectors(tmpB, tmpA);
      const length = tmpDir.length();
      tmpQuat.setFromUnitVectors(UP, tmpDir.divideScalar(length || 1));
      tmpScale.set(r, length, r);
      tmpMatrix.compose(tmpA.add(tmpB).multiplyScalar(0.5), tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** Places copies of a geometry with arbitrary transforms as one InstancedMesh. */
export function instances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: readonly THREE.Matrix4[],
  name: string
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
