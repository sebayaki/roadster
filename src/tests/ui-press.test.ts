import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onPress } from "@/ui/dom";

/** Stand-in for a button that contains only itself. */
class FakeButton extends EventTarget {
  contains(node: unknown): boolean {
    return node === this;
  }
}

/** Node has no PointerEvent: a plain Event carrying the fields onPress reads. */
function pointer(
  target: EventTarget,
  type: "pointerdown" | "pointerup" | "pointercancel",
  pointerId: number,
  isPrimary = false,
  pointerType = "touch"
) {
  target.dispatchEvent(
    Object.assign(new Event(type), {
      pointerId,
      isPrimary,
      pointerType,
      clientX: 10,
      clientY: 10,
    })
  );
}

/** A pointer that goes down and lifts on `target`. */
function tap(
  target: EventTarget,
  pointerId: number,
  isPrimary = false,
  pointerType = "touch"
) {
  pointer(target, "pointerdown", pointerId, isPrimary, pointerType);
  pointer(target, "pointerup", pointerId, isPrimary, pointerType);
}

describe("onPress", () => {
  /** What document.elementFromPoint() finds where the pointer lifts. */
  let hit: unknown;
  let now: number;

  beforeEach(() => {
    now = 0;
    vi.stubGlobal("document", { elementFromPoint: () => hit });
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup() {
    const button = new FakeButton();
    const press = vi.fn();
    onPress(button as unknown as HTMLElement, press);
    hit = button;
    return { button, press };
  }

  it("acts once per click (mouse, primary touch, keyboard)", () => {
    const { button, press } = setup();
    tap(button, 1, true, "mouse");
    tap(button, 2, true, "touch");
    expect(press).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("click"));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("acts once on a secondary touch that goes down and lifts on the button", () => {
    const { button, press } = setup();
    tap(button, 3);
    expect(press).toHaveBeenCalledTimes(1);
    // A browser that also clicks for that tap: still one press.
    now += 50;
    button.dispatchEvent(new Event("click"));
    expect(press).toHaveBeenCalledTimes(1);
    // A later click is a new press.
    now += 600;
    button.dispatchEvent(new Event("click"));
    expect(press).toHaveBeenCalledTimes(2);
  });

  it("ignores a secondary touch that lifts off the button", () => {
    const { button, press } = setup();
    hit = {};
    tap(button, 3);
    hit = null;
    tap(button, 4);
    expect(press).not.toHaveBeenCalled();
  });

  it("ignores a secondary touch that went down elsewhere or was cancelled", () => {
    const { button, press } = setup();
    // A finger held on GAS whose capture the hidden touch controls released.
    pointer(button, "pointerup", 5);
    pointer(button, "pointerdown", 6);
    pointer(button, "pointercancel", 6);
    pointer(button, "pointerup", 6);
    expect(press).not.toHaveBeenCalled();
  });
});
