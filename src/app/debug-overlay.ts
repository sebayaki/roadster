import * as THREE from "three";
import { BODY_BOX } from "@/core/car-spec";
import type { CarSnapshot } from "@/core/types";

/**
 * `?debug=1`: a solid magenta collision box with dark edges and the car-local
 * axes (+x red forward, +y green up, +z blue right) at the car pose, to check
 * camera framing independently of the Roadster model.
 */
export class DebugOverlay {
  readonly root = new THREE.Group();
  private readonly box: THREE.BoxGeometry;
  private readonly edges: THREE.EdgesGeometry;
  private readonly fill: THREE.MeshBasicMaterial;
  private readonly line: THREE.LineBasicMaterial;
  private readonly axes: THREE.AxesHelper;

  constructor() {
    this.root.name = "debug-car";
    this.box = new THREE.BoxGeometry(
      BODY_BOX.maxX - BODY_BOX.minX,
      BODY_BOX.maxY - BODY_BOX.minY,
      BODY_BOX.maxZ - BODY_BOX.minZ
    );
    this.box.translate(
      (BODY_BOX.maxX + BODY_BOX.minX) / 2,
      (BODY_BOX.maxY + BODY_BOX.minY) / 2,
      (BODY_BOX.maxZ + BODY_BOX.minZ) / 2
    );
    this.edges = new THREE.EdgesGeometry(this.box);
    this.fill = new THREE.MeshBasicMaterial({
      color: 0xc0168a,
      transparent: true,
      opacity: 0.75,
    });
    this.line = new THREE.LineBasicMaterial({ color: 0x000000 });
    this.root.add(new THREE.Mesh(this.box, this.fill));
    this.root.add(new THREE.LineSegments(this.edges, this.line));
    this.axes = new THREE.AxesHelper(3);
    this.root.add(this.axes);
  }

  update(car: CarSnapshot): void {
    const { position: p, quaternion: q } = car;
    this.root.position.set(p.x, p.y, p.z);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.box.dispose();
    this.edges.dispose();
    this.fill.dispose();
    this.line.dispose();
    this.axes.dispose();
  }
}
