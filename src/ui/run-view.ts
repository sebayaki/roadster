import type { CarSnapshot, LevelDef, Units } from "@/core/types";
import { clamp, lengthIn, offFullTurn, speedIn } from "@/core/math";
import { dispatchAction } from "@/input/events";
import {
  axisLabel,
  hintSegments,
  type ControlScheme,
  type HintId,
} from "./controls-info";
import {
  ClassFlag,
  NumberText,
  TransformSlot,
  h,
  icon,
  replayClass,
  segmentNode,
  setChildren,
} from "./dom";
import {
  formatBest,
  formatSpeedRange,
  lengthUnit,
  speedUnit,
  type Attitude,
} from "./format";
import { CAR_REAR, CAR_SIDE, ICONS } from "./icons";

const RAD2DEG = 180 / Math.PI;
/** Full scale of the speed bar relative to the top of the recommended band. */
const SPEED_BAR_SCALE = 1.4;
/** Keep the air panel up this long after touchdown so the final numbers can be read (ms). */
const AIR_LINGER = 1400;
const HINT_BITS: Record<HintId, number> = {
  go: 1,
  flipBack: 2,
  roll: 4,
  landSoft: 8,
  liftOff: 16,
};
/** Auto-dismiss delay per hint (ms); "go" stays until the car moves. */
const HINT_DURATION: Record<HintId, number> = {
  go: Number.POSITIVE_INFINITY,
  flipBack: 3200,
  roll: 3000,
  landSoft: 2600,
  liftOff: 3200,
};
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs))
    el.setAttribute(name, String(value));
  return el;
}

/** Lowest of the four jet levels: ≈1 only while the lift thrusters fire. */
function liftLevel(car: CarSnapshot): number {
  const t = car.thrusters;
  return Math.min(t[0], t[1], t[2], t[3]);
}

/** x where the level's obstacles (the kickflip lineup) begin; +∞ without obstacles. */
export function lineupStartX(level: LevelDef): number {
  let x = Number.POSITIVE_INFINITY;
  for (const o of level.obstacles) {
    for (const [px] of o.polygon) x = Math.min(x, px);
  }
  return x;
}

/**
 * The in-run HUD: title, best, pause / mute buttons, speedometer with the
 * recommended band, cold-gas gauge, the airborne panel (rotation dial, height,
 * air time) and one-shot coaching hints.
 */
export class RunView {
  readonly el: HTMLElement;
  /** Car orientation seen in the last non-crashed frame (for "Landed on the roof" lines). */
  readonly attitude: Attitude = { pitch: 0, roll: 0 };

  private readonly name = h("div", { class: "run-name" });
  private readonly venue = h("div", { class: "run-venue" });
  private readonly bestValue = h("span", { class: "run-best-val" }, "—");
  private readonly muteIcon = icon(ICONS.soundOn);
  private readonly muteButton = h(
    "button",
    {
      type: "button",
      class: "hud-icon-btn run-mute",
      "aria-label": "Mute",
      "aria-pressed": "false",
    },
    this.muteIcon
  );
  private readonly howTo = h("ol", { class: "run-howto hud-glass" });
  private readonly coach = h("div", { class: "run-coach" });
  private readonly hintEl = h("div", { class: "run-hint", role: "status" });
  private readonly speedUnitEl = h("span", { class: "speed-unit" });
  private readonly targetEl = h("span", { class: "speed-target-val" });
  private readonly band = h("div", { class: "sb-band" });
  private readonly speedText: NumberText;
  private readonly speedFill: TransformSlot;
  private readonly speedMarker: TransformSlot;
  private readonly gasText: NumberText;
  private readonly gasFill: TransformSlot;
  private readonly inBand: ClassFlag;
  private readonly reverse: ClassFlag;
  private readonly gasLow: ClassFlag;

  private readonly air: HTMLElement;
  private readonly airOn: ClassFlag;
  private readonly heightText: NumberText;
  private readonly heightUnit = h("span", { class: "air-unit" });
  private readonly airTimeText: NumberText;
  private readonly degText: NumberText;
  private readonly axisEl = h("span", { class: "dial-axis" });
  private readonly turnsEl = h("span", { class: "dial-turns" });
  private readonly dialArc: SVGCircleElement;
  private readonly dialCar: SVGGElement;
  private readonly dialCarSlot: TransformSlot;
  private readonly dialCcw: ClassFlag;
  private readonly dialDone: ClassFlag;
  private readonly dialLevel: ClassFlag;
  private lastArc = -1;
  private lastTurns = -1;

  private level: LevelDef | null = null;
  private scheme: ControlScheme = "keyboard";
  private units: Units = "metric";
  private lastCar: CarSnapshot | null = null;
  private speedScale = 1;
  private lineupX = Number.POSITIVE_INFINITY;
  private airUntil = 0;
  private hintMask = 0;
  private hint: HintId | null = null;
  private hintUntil = 0;

  constructor() {
    const pauseButton = h(
      "button",
      {
        type: "button",
        class: "hud-icon-btn run-pause",
        "aria-label": "Pause",
      },
      icon(ICONS.pause)
    );
    this.muteButton.addEventListener("click", () => dispatchAction("mute"));
    pauseButton.addEventListener("click", () => dispatchAction("pause"));

    // Speedometer: digits + unit, bar with the recommended band and a live marker.
    const speedDigits = h("span", { class: "speed-val" }, "0");
    const fill = h("div", { class: "sb-fill" });
    const rail = h("div", { class: "sb-rail" }, h("i", { class: "sb-marker" }));
    const speed = h(
      "div",
      { class: "run-speed" },
      h(
        "div",
        { class: "speed-row" },
        speedDigits,
        h(
          "span",
          { class: "speed-meta" },
          this.speedUnitEl,
          h("span", { class: "speed-gear" }, "R")
        )
      ),
      h(
        "div",
        { class: "speed-bar" },
        h("div", { class: "sb-track" }),
        this.band,
        fill,
        rail
      ),
      h(
        "div",
        { class: "speed-target" },
        h("span", { class: "hud-label" }, "Target"),
        this.targetEl
      )
    );
    this.speedText = new NumberText(speedDigits);
    this.speedFill = new TransformSlot(fill, (v) => `scaleX(${v})`);
    this.speedMarker = new TransformSlot(
      rail,
      (v) => `translateX(${v * 100}%)`
    );

    // Cold-gas gauge.
    const gasDigits = h("span", { class: "gas-val" }, "100");
    const gasFill = h("div", { class: "gb-fill" });
    const gas = h(
      "div",
      { class: "run-gas" },
      h(
        "div",
        { class: "gas-row" },
        h("span", { class: "hud-label" }, "Cold gas"),
        h(
          "span",
          { class: "gas-num" },
          gasDigits,
          h("span", { class: "gas-pct" }, "%")
        )
      ),
      h("div", { class: "gas-bar" }, h("div", { class: "gb-track" }), gasFill)
    );
    this.gasText = new NumberText(gasDigits);
    this.gasFill = new TransformSlot(gasFill, (v) => `scaleX(${v})`);

    const cluster = h(
      "div",
      { class: "run-cluster hud-glass" },
      speed,
      h("div", { class: "cluster-rule" }),
      gas
    );
    this.inBand = new ClassFlag(cluster, "is-in-band");
    this.reverse = new ClassFlag(cluster, "is-reverse");
    this.gasLow = new ClassFlag(cluster, "is-gas-low");

    // Airborne panel: rotation dial + height + air time.
    const dial = svgEl("svg", {
      class: "dial",
      viewBox: "0 0 120 120",
      "aria-hidden": "true",
    });
    dial.append(
      svgEl("circle", { class: "dial-track", cx: 60, cy: 60, r: 52 }),
      svgEl("circle", { class: "dial-done", cx: 60, cy: 60, r: 52 })
    );
    this.dialArc = svgEl("circle", {
      class: "dial-arc",
      cx: 60,
      cy: 60,
      r: 52,
      pathLength: 360,
    });
    dial.append(this.dialArc);
    const ticks = svgEl("g", { class: "dial-ticks" });
    for (const [x1, y1, x2, y2] of [
      [60, 1, 60, 13],
      [119, 60, 109, 60],
      [60, 119, 60, 109],
      [1, 60, 11, 60],
    ]) {
      ticks.append(svgEl("line", { x1, y1, x2, y2 }));
    }
    dial.append(ticks);
    this.dialCar = svgEl("g", { class: "dial-car" });
    dial.append(this.dialCar);
    this.dialCarSlot = new TransformSlot(
      this.dialCar,
      (v) => `rotate(${v}deg)`,
      0.5
    );

    const degDigits = h("span", { class: "dial-deg-val" }, "0");
    const heightDigits = h("span", { class: "air-val" }, "0.0");
    const airDigits = h("span", { class: "air-val" }, "0.0");
    this.air = h(
      "div",
      { class: "run-air hud-glass", "aria-hidden": "true" },
      dial,
      h(
        "div",
        { class: "air-side" },
        h(
          "div",
          { class: "dial-readout" },
          h(
            "span",
            { class: "dial-deg" },
            degDigits,
            h("span", { class: "dial-deg-unit" }, "°")
          ),
          h("span", { class: "dial-meta" }, this.axisEl, this.turnsEl)
        ),
        h(
          "div",
          { class: "air-stats" },
          h(
            "div",
            { class: "air-stat" },
            h("span", { class: "hud-label" }, "Height"),
            h("span", { class: "air-num" }, heightDigits, this.heightUnit)
          ),
          h(
            "div",
            { class: "air-stat" },
            h("span", { class: "hud-label" }, "Air"),
            h(
              "span",
              { class: "air-num" },
              airDigits,
              h("span", { class: "air-unit" }, "s")
            )
          )
        )
      )
    );
    this.degText = new NumberText(degDigits);
    this.heightText = new NumberText(heightDigits, 1);
    this.airTimeText = new NumberText(airDigits, 1);
    this.airOn = new ClassFlag(this.air, "is-on");
    this.dialCcw = new ClassFlag(this.air, "is-ccw");
    this.dialDone = new ClassFlag(this.air, "is-turned");
    this.dialLevel = new ClassFlag(this.air, "is-level");

    this.coach.append(this.hintEl);
    this.el = h(
      "section",
      { class: "hud-run", hidden: true, "aria-label": "Run" },
      h(
        "header",
        { class: "run-top" },
        h(
          "div",
          { class: "run-title" },
          h("span", { class: "run-accent" }),
          h("div", null, this.name, this.venue)
        ),
        h(
          "div",
          { class: "run-actions" },
          h(
            "div",
            { class: "run-best" },
            h("span", { class: "hud-label" }, "Best"),
            this.bestValue
          ),
          this.muteButton,
          pauseButton
        )
      ),
      this.howTo,
      this.coach,
      this.air,
      cluster
    );
    // In-run buttons must not keep keyboard focus, or Space / Enter would press them again.
    this.el.addEventListener("mousedown", (e) => {
      if (e.target instanceof Element && e.target.closest("button"))
        e.preventDefault();
    });
  }

  /** Reset for a new run of `level`. */
  show(
    level: LevelDef,
    scheme: ControlScheme,
    isTouch: boolean,
    best: number | undefined,
    options: { howTo: boolean; rotateHint: boolean }
  ): void {
    this.level = level;
    this.scheme = scheme;
    this.lastCar = null;
    this.el.dataset.scheme = scheme;
    this.el.classList.toggle("is-touch", isTouch);
    this.name.textContent = level.title;
    this.venue.textContent = level.venue;
    this.bestValue.textContent = formatBest(best);

    this.speedScale = level.speedHint[1] * SPEED_BAR_SCALE;
    this.band.style.left = `${(level.speedHint[0] / this.speedScale) * 100}%`;
    this.band.style.width = `${((level.speedHint[1] - level.speedHint[0]) / this.speedScale) * 100}%`;
    this.lineupX = lineupStartX(level);
    this.dialCar.innerHTML = level.spinAxis === "pitch" ? CAR_SIDE : CAR_REAR;
    this.axisEl.textContent = axisLabel(level.spinAxis);
    this.renderUnits();

    this.speedText.set(0);
    this.speedFill.set(0);
    this.speedMarker.set(0);
    this.gasText.set(100);
    this.gasFill.set(1);
    this.inBand.set(false);
    this.reverse.set(false);
    this.gasLow.set(false);
    this.airUntil = 0;
    this.airOn.set(false);
    this.resetDial();
    this.attitude.pitch = 0;
    this.attitude.roll = 0;

    setChildren(
      this.howTo,
      ...level.howTo.map((line) => h("li", null, line)),
      // Shown only while the phone is held in portrait (CSS).
      options.rotateHint
        ? h(
            "li",
            { class: "howto-rotate" },
            icon(ICONS.rotatePhone),
            "Turn your phone sideways for a wider view"
          )
        : null
    );
    this.howTo.classList.toggle("is-on", options.howTo);
    this.hintMask = 0;
    this.hint = null;
    this.hintEl.classList.remove("is-on");
    this.showHint("go", performance.now());

    this.el.hidden = false;
    replayClass(this.el, "is-entering");
  }

  hide(): void {
    this.el.hidden = true;
  }

  setMuted(muted: boolean): void {
    this.muteButton.setAttribute("aria-pressed", String(muted));
    this.muteButton.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    this.muteIcon.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    this.muteButton.classList.toggle("is-off", muted);
  }

  /** Switch units right away (e.g. toggled on the pause card) using the last snapshot. */
  setUnits(units: Units): void {
    if (units === this.units) return;
    this.units = units;
    this.renderUnits();
    const car = this.lastCar;
    if (car && this.level) this.update(car, this.level, units);
  }

  /** Per frame: gauges, dial and hints. Touches the DOM only when a shown value changes. */
  update(car: CarSnapshot, level: LevelDef, units: Units): void {
    if (units !== this.units) {
      this.units = units;
      this.renderUnits();
    }
    this.lastCar = car;
    const now = performance.now();
    const speed = Math.abs(car.speed);
    const grounded = car.mode === "grounded";
    const airborne = car.mode === "airborne";

    this.speedText.set(speedIn(speed, units));
    const p = clamp(speed / this.speedScale, 0, 1);
    this.speedFill.set(p);
    this.speedMarker.set(p);
    this.inBand.set(
      grounded && speed >= level.speedHint[0] && speed <= level.speedHint[1]
    );
    this.reverse.set(grounded && car.speed < -0.5);

    this.gasText.set(car.gas * 100);
    this.gasFill.set(clamp(car.gas, 0, 1));
    this.gasLow.set(car.gas < 0.2);

    if (airborne) {
      this.airUntil = now + AIR_LINGER;
      this.heightText.set(lengthIn(Math.max(0, car.heightAboveGround), units));
      this.airTimeText.set(car.airTime);
      this.updateDial(car, level);
    }
    this.airOn.set(car.mode !== "crashed" && (airborne || now < this.airUntil));

    if (car.mode !== "crashed") {
      this.attitude.pitch = car.pitch;
      this.attitude.roll = car.roll;
    }
    this.updateHints(car, level, now);
  }

  private renderUnits(): void {
    const level = this.level;
    this.speedUnitEl.textContent = speedUnit(this.units);
    this.heightUnit.textContent = lengthUnit(this.units);
    if (level) {
      this.targetEl.textContent = `${formatSpeedRange(level.speedHint, this.units)} ${speedUnit(this.units).toLowerCase()}`;
    }
    this.speedText.invalidate();
    this.heightText.invalidate();
  }

  private resetDial(): void {
    this.lastArc = -1;
    this.lastTurns = -1;
    this.setDial(0, false);
    this.dialCarSlot.set(0);
    this.dialCcw.set(false);
    this.dialLevel.set(true);
    this.degText.set(0);
  }

  private updateDial(car: CarSnapshot, level: LevelDef): void {
    const pitchAxis = level.spinAxis === "pitch";
    const deg = (pitchAxis ? car.trickPitch : car.trickRoll) * RAD2DEG;
    // Screen rotation, clockwise-positive like CSS: + pitch is counter-clockwise seen from +z,
    // + roll is clockwise seen from behind.
    const screen = pitchAxis ? -deg : deg;
    this.degText.set(Math.abs(deg));
    this.dialCcw.set(screen < 0);
    this.dialCarSlot.set(screen);
    this.dialLevel.set(
      offFullTurn(car.pitch) < 0.35 && offFullTurn(car.roll) < 0.35
    );
    this.setDial(Math.abs(deg), true);
  }

  /** Arc = progress of the current turn; completed turns light the ring and the ×N badge. */
  private setDial(absDeg: number, live: boolean): void {
    const turns = Math.floor(absDeg / 360 + 1e-6);
    const arc = Math.round(absDeg - turns * 360);
    if (arc !== this.lastArc) {
      this.lastArc = arc;
      this.dialArc.style.strokeDashoffset = String(360 - arc);
    }
    if (turns !== this.lastTurns) {
      this.lastTurns = turns;
      this.dialDone.set(live && turns >= 1);
      this.turnsEl.textContent = turns >= 2 ? `×${turns}` : "";
    }
  }

  private showHint(id: HintId, now: number): void {
    if (this.hintMask & HINT_BITS[id]) return;
    this.hintMask |= HINT_BITS[id];
    this.hint = id;
    this.hintUntil = now + HINT_DURATION[id];
    this.hintEl.replaceChildren(
      ...hintSegments(id, this.scheme).map((seg) =>
        typeof seg === "string" ? h("span", null, seg) : segmentNode(seg)
      )
    );
    replayClass(this.hintEl, "is-on");
  }

  private hideHint(): void {
    if (this.hint === "go") this.howTo.classList.remove("is-on");
    this.hint = null;
    this.hintEl.classList.remove("is-on");
  }

  /** Coaching hints, each once per run (wording follows the control scheme). */
  private updateHints(car: CarSnapshot, level: LevelDef, now: number): void {
    const grounded = car.mode === "grounded";
    const airborne = car.mode === "airborne";
    const pitchAxis = level.spinAxis === "pitch";
    const trick = Math.abs(pitchAxis ? car.trickPitch : car.trickRoll);
    const lift = liftLevel(car);

    if (this.hint) {
      let keep = now < this.hintUntil && car.mode !== "crashed";
      switch (this.hint) {
        case "go":
          keep = grounded && Math.abs(car.speed) < 1;
          break;
        case "roll":
          keep &&= airborne && trick < Math.PI / 3;
          break;
        case "landSoft":
          keep &&= airborne && lift < 0.9;
          break;
        case "liftOff":
          keep &&= grounded && car.position.x < this.lineupX;
          break;
        case "flipBack":
          break;
      }
      if (!keep) this.hideHint();
      else return;
    }

    if (car.mode === "crashed") return;
    if (pitchAxis && grounded && car.onRamp && car.speed > 1) {
      this.showHint("flipBack", now);
    } else if (
      !pitchAxis &&
      airborne &&
      car.heightAboveGround > 1 &&
      trick < Math.PI / 9
    ) {
      this.showHint("roll", now);
    } else if (
      airborne &&
      trick > Math.PI &&
      offFullTurn(car.pitch) < 0.5 &&
      offFullTurn(car.roll) < 0.5 &&
      car.velocity.y < -2.5 &&
      lift < 0.5 &&
      car.gas > 0.02 &&
      car.heightAboveGround > 2
    ) {
      this.showHint("landSoft", now);
    } else if (grounded && car.speed > 3) {
      const ahead = this.lineupX - car.position.x;
      if (ahead > 0 && ahead < 45) this.showHint("liftOff", now);
    }
  }
}
