import { describe, expect, it } from "vitest";
import { isInputAction } from "@/input/events";
import {
  KEY_ACTIONS,
  KEY_HOLD,
  KEY_PREVENT_DEFAULT,
  PAD,
  STICK_DEADZONE,
  applyDeadzone,
  isInteractiveTarget,
  stickToSpin,
  triggerToPedal,
} from "@/input/mapping";

describe("keyboard mapping", () => {
  it("maps arrows and WASD to held controls (layout-independent codes)", () => {
    expect(KEY_HOLD.ArrowUp).toBe("gas");
    expect(KEY_HOLD.KeyW).toBe("gas");
    expect(KEY_HOLD.ArrowDown).toBe("brake");
    expect(KEY_HOLD.KeyS).toBe("brake");
    expect(KEY_HOLD.Space).toBe("thrust");
    expect(KEY_HOLD.ArrowLeft).toBe("left");
    expect(KEY_HOLD.KeyA).toBe("left");
    expect(KEY_HOLD.ArrowRight).toBe("right");
    expect(KEY_HOLD.KeyD).toBe("right");
    expect(KEY_HOLD.KeyQ).toBeUndefined();
  });

  it("maps meta keys to edge-triggered actions", () => {
    expect(KEY_ACTIONS.Enter).toBe("confirm");
    expect(KEY_ACTIONS.KeyR).toBe("restart");
    expect(KEY_ACTIONS.Escape).toBe("pause");
    expect(KEY_ACTIONS.KeyP).toBe("pause");
    expect(KEY_ACTIONS.KeyC).toBe("camera");
    expect(KEY_ACTIONS.KeyM).toBe("mute");
    expect(KEY_ACTIONS.KeyU).toBe("units");
    for (const action of Object.values(KEY_ACTIONS)) {
      expect(isInputAction(action)).toBe(true);
    }
  });

  it("only suppresses the scrolling keys", () => {
    expect([...KEY_PREVENT_DEFAULT].sort()).toEqual(
      ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Space"].sort()
    );
  });
});

describe("gamepad mapping", () => {
  it("uses the standard layout", () => {
    expect(PAD).toMatchObject({
      A: 0,
      B: 1,
      Y: 3,
      LT: 6,
      RT: 7,
      START: 9,
      DPAD_LEFT: 14,
      DPAD_RIGHT: 15,
    });
  });

  it("applies a rescaled stick deadzone", () => {
    expect(stickToSpin(0)).toBe(0);
    expect(stickToSpin(STICK_DEADZONE * 0.9)).toBe(0);
    expect(stickToSpin(-STICK_DEADZONE * 0.9)).toBe(0);
    expect(stickToSpin(1)).toBe(1);
    expect(stickToSpin(-1)).toBe(-1);
    expect(stickToSpin(STICK_DEADZONE + (1 - STICK_DEADZONE) / 2)).toBeCloseTo(
      0.5,
      6
    );
    expect(applyDeadzone(1.3, 0.2)).toBe(1);
  });

  it("treats resting triggers as released", () => {
    expect(triggerToPedal(0)).toBe(0);
    expect(triggerToPedal(0.04)).toBe(0);
    expect(triggerToPedal(1)).toBe(1);
    expect(triggerToPedal(0.5)).toBeGreaterThan(0.4);
  });
});

describe("events", () => {
  it("validates action names", () => {
    expect(isInputAction("pause")).toBe(true);
    expect(isInputAction("jump")).toBe(false);
    expect(isInputAction(3)).toBe(false);
  });

  it("does not treat non-elements as interactive targets", () => {
    expect(isInteractiveTarget(null)).toBe(false);
  });
});
