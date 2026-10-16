export interface BrowserEventHandlers {
  /** Any user gesture (audio may only be unlocked inside one). */
  gesture(): void;
  visibility(hidden: boolean): void;
  /** Viewport size changed (coalesced to one call per animation frame). */
  resize(): void;
}

/** Pointer, key and touch events that can carry user activation in some browser. */
const GESTURES = [
  "pointerdown",
  "pointerup",
  "keydown",
  "touchstart",
  "touchend",
  "click",
] as const;

/** Wires the window / document listeners the App needs for the page's lifetime. */
export function bindBrowserEvents(handlers: BrowserEventHandlers): void {
  let frame = 0;
  const onResize = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      handlers.resize();
    });
  };
  for (const type of GESTURES) {
    window.addEventListener(type, () => handlers.gesture(), {
      capture: true,
      passive: true,
    });
  }
  document.addEventListener("visibilitychange", () =>
    handlers.visibility(document.hidden)
  );
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
}
