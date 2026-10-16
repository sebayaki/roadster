import { h } from "./dom";
import type { PopupKind } from "./hud";

/** How long each popup kind stays on screen (ms), matching the CSS keyframes. */
const LIFETIME: Record<PopupKind, number> = {
  trick: 2200,
  perfect: 2200,
  info: 1500,
  warn: 1900,
};
const MAX_VISIBLE = 3;

/** Stack of transient centered callouts ("360°", "BACKFLIP", "PERFECT LANDING", …). */
export class PopupLayer {
  readonly el = h("div", { class: "hud-popups", "aria-live": "polite" });
  private readonly timers = new Set<number>();

  show(text: string, kind: PopupKind): void {
    const popup = h(
      "div",
      { class: `popup popup--${kind}` },
      h("span", { class: "popup-text" }, text)
    );
    popup.style.setProperty("--life", `${LIFETIME[kind]}ms`);
    this.el.appendChild(popup);
    while (this.el.childElementCount > MAX_VISIBLE) {
      this.el.firstElementChild?.remove();
    }
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      popup.remove();
    }, LIFETIME[kind]);
    this.timers.add(timer);
  }

  clear(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.el.replaceChildren();
  }
}
