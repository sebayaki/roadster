import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BODY_BOX, CAR } from "@/core/car-spec";
import type { Quality } from "@/core/types";
import { kickflipLevel, OUTLINE_BASE } from "@/levels/kickflip";
import { prepareObstacles } from "@/physics/collision";
import { buildBody } from "@/render/roadster/body";
import { buildLineup } from "@/render/vehicles-model";

describe.each<Quality>(["high", "low"])("3D models, %s quality", (quality) => {
  it("give the Roadster body the car's exact dimensions", () => {
    const box = new THREE.Box3();
    for (const geometry of Object.values(buildBody(quality === "high"))) {
      if (!(geometry instanceof THREE.BufferGeometry)) continue;
      geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
    }
    expect(box.min.x).toBeCloseTo(BODY_BOX.minX, 3);
    expect(box.max.x).toBeCloseTo(BODY_BOX.maxX, 3);
    expect(box.min.y).toBeCloseTo(CAR.groundClearance - CAR.comHeight, 3);
    expect(box.max.y).toBeCloseTo(BODY_BOX.maxY, 3);
    expect(box.min.z).toBeCloseTo(BODY_BOX.minZ, 3);
    expect(box.max.z).toBeCloseTo(BODY_BOX.maxZ, 3);
  });

  it("keep each lineup vehicle inside the outline physics collides with", () => {
    const lineup = buildLineup(kickflipLevel.obstacles, quality);
    lineup.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (const o of kickflipLevel.obstacles) {
      if (o.kind === "stage") continue;
      const vehicle = lineup.getObjectByName(o.id);
      if (!vehicle) throw new Error(`no model for ${o.id}`);
      const [shape] = prepareObstacles([o]);
      let checked = 0;
      let overhang = 0;
      vehicle.traverse((mesh) => {
        if (!(mesh instanceof THREE.Mesh)) return;
        const position = mesh.geometry.getAttribute("position");
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          // The outline starts OUTLINE_BASE above the stand; the tires reach below it.
          if (v.y <= o.baseY + OUTLINE_BASE + 0.001) continue;
          checked++;
          for (let k = 0; k < shape.count; k++) {
            const out = v.x * shape.nx[k] + v.y * shape.ny[k] - shape.hi[k];
            overhang = Math.max(overhang, out);
          }
        }
      });
      expect(checked, o.id).toBeGreaterThan(1000);
      // The Cybertruck's tail light band stands 2 mm proud of its outline.
      expect(overhang, o.id).toBeLessThan(0.003);
    }
  });
});
