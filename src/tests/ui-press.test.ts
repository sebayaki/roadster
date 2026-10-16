import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onPress } from "@/ui/dom";

/** Stand-in for a button that contains only itself. */
class FakeButton extends EventTarget {
  contains(node: unknown): boolean {
    return node === this;
  }
}

/** Node has no PointerEvent: a plain Event carrying the fields onPress reads. */
function pointerUp(
  target: EventTarget,
  isPrimary: boolean,
  pointerType: string
) {
  target.dispatchEvent(
    Object.assign(new Event("pointerup"), {
      isPrimary,
      pointerType,
      clientX: 10,
      clientY: 10,
    })
  );
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
    pointerUp(button, true, "mouse");
    pointerUp(button, true, "touch");
    expect(press).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("click"));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("acts once on a secondary touch that lifts on the button", () => {
    const { button, press } = setup();
    pointerUp(button, false, "touch");
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
    pointerUp(button, false, "touch");
    hit = null;
    pointerUp(button, false, "touch");
    expect(press).not.toHaveBeenCalled();
  });
});
