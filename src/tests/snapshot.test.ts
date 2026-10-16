import { describe, expect, it } from "vitest";
import { CAR } from "@/core/car-spec";
import { createCarSnapshot } from "@/core/snapshot";

describe("createCarSnapshot", () => {
  it("is the car at rest on the ground with a full tank", () => {
    const car = createCarSnapshot();
    expect(car.mode).toBe("grounded");
    expect(car.position).toEqual({ x: 0, y: CAR.comHeight, z: 0 });
    expect(car.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(car.gas).toBe(1);
    expect(car.heightAboveGround).toBe(0);
  });

  it("returns new nested objects every call (owners write them in place)", () => {
    const a = createCarSnapshot();
    const b = createCarSnapshot();
    expect(a.position).not.toBe(b.position);
    expect(a.velocity).not.toBe(b.velocity);
    expect(a.quaternion).not.toBe(b.quaternion);
    expect(a.thrusters).not.toBe(b.thrusters);
  });
});
