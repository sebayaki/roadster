import type { Units } from "@/core/types";
import { dispatchAction } from "@/input/events";
import { h, icon, onPress } from "./dom";
import { ICONS } from "./icons";

/**
 * Sound + units toggle pair used by the menu and the pause card. Presses only
 * emit the `mute` / `units` actions; the App toggles its settings and the HUD
 * shows the result through sync().
 */
export class Toggles {
  readonly el: HTMLDivElement;
  private readonly sound: HTMLButtonElement;
  private readonly soundIcon: HTMLSpanElement;
  private readonly soundState: HTMLSpanElement;
  private readonly units: HTMLButtonElement;
  private readonly metric: HTMLSpanElement;
  private readonly imperial: HTMLSpanElement;

  constructor() {
    this.soundIcon = icon(ICONS.soundOn);
    this.soundState = h("span", { class: "tg-state" }, "ON");
    this.sound = h(
      "button",
      { type: "button", class: "tg tg-sound", "aria-pressed": "true" },
      this.soundIcon,
      h("span", { class: "tg-label" }, "SOUND"),
      this.soundState
    );
    this.metric = h("span", { class: "tg-seg is-on" }, "KM/H");
    this.imperial = h("span", { class: "tg-seg" }, "MPH");
    this.units = h(
      "button",
      { type: "button", class: "tg tg-units" },
      this.metric,
      this.imperial
    );
    onPress(this.sound, () => dispatchAction("mute"));
    onPress(this.units, () => dispatchAction("units"));
    this.el = h("div", { class: "tg-group" }, this.sound, this.units);
  }

  sync(muted: boolean, units: Units): void {
    this.sound.setAttribute("aria-pressed", String(!muted));
    this.sound.classList.toggle("is-off", muted);
    this.soundIcon.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    this.soundState.textContent = muted ? "OFF" : "ON";
    const metric = units === "metric";
    this.metric.classList.toggle("is-on", metric);
    this.imperial.classList.toggle("is-on", !metric);
    this.units.setAttribute(
      "aria-label",
      metric
        ? "Units KM/H, switch to MPH and feet"
        : "Units MPH, switch to KM/H and meters"
    );
  }
}
