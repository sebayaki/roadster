import type { SpinAxis } from "@/core/types";
import { h, icon } from "@/ui/dom";
import { ICONS } from "@/ui/icons";
import { HOLD_CONTROLS, type HoldControl } from "./mapping";

const SPIN_LABELS: Record<
  SpinAxis,
  { caption: string; left: string; right: string }
> = {
  pitch: {
    caption: "FLIP",
    left: "Flip backwards (counter-clockwise)",
    right: "Flip forwards (clockwise)",
  },
  roll: {
    caption: "ROLL",
    left: "Roll left (counter-clockwise)",
    right: "Roll right (clockwise)",
  },
};

/**
 * On-screen buttons for touch devices: ◀ ▶ spin on the left thumb, GAS / BRAKE
 * pedals and the round THRUST button on the right thumb. Multi-touch through
 * Pointer Events with pointer capture, so each finger keeps its button.
 */
export class TouchControls {
  readonly el: HTMLDivElement;
  private readonly buttons: Record<HoldControl, HTMLButtonElement>;
  private readonly caption: HTMLSpanElement;
  /** Active pointer id → the control it holds. */
  private readonly pointers = new Map<number, HoldControl>();
  private readonly counts: Record<HoldControl, number> = {
    gas: 0,
    brake: 0,
    thrust: 0,
    left: 0,
    right: 0,
  };

  constructor(parent: HTMLElement) {
    const button = (
      control: HoldControl,
      className: string,
      label: string,
      ...children: Array<Node | string>
    ) =>
      h(
        "button",
        {
          type: "button",
          class: `tc-btn ${className}`,
          "data-control": control,
          "aria-label": label,
          tabindex: -1,
        },
        ...children
      );

    this.caption = h("span", { class: "tc-caption" }, "FLIP");
    this.buttons = {
      left: button("left", "tc-spin", "", icon(ICONS.ccw, "tc-icon")),
      right: button("right", "tc-spin", "", icon(ICONS.cw, "tc-icon")),
      thrust: button(
        "thrust",
        "tc-thrust",
        "Thrusters",
        icon(ICONS.thrust, "tc-icon"),
        h("span", { class: "tc-label" }, "THRUST")
      ),
      brake: button(
        "brake",
        "tc-pedal tc-brake",
        "Brake / reverse",
        h("span", { class: "tc-label" }, "BRAKE")
      ),
      gas: button(
        "gas",
        "tc-pedal tc-gas",
        "Gas",
        h("span", { class: "tc-label" }, "GAS")
      ),
    };

    this.el = h(
      "div",
      { class: "tc", hidden: true },
      h(
        "div",
        { class: "tc-left" },
        this.caption,
        h("div", { class: "tc-pair" }, this.buttons.left, this.buttons.right)
      ),
      h(
        "div",
        { class: "tc-right" },
        this.buttons.thrust,
        this.buttons.brake,
        this.buttons.gas
      )
    );
    this.setSpinAxis("pitch");

    this.el.addEventListener("pointerdown", this.onDown);
    this.el.addEventListener("pointerup", this.onUp);
    this.el.addEventListener("pointercancel", this.onUp);
    this.el.addEventListener("lostpointercapture", this.onUp);
    this.el.addEventListener("contextmenu", this.onContextMenu);
    parent.appendChild(this.el);
  }

  /** True while at least one finger holds the control. */
  pressed(control: HoldControl): boolean {
    return this.counts[control] > 0;
  }

  setVisible(visible: boolean): void {
    if (this.el.hidden === !visible) return;
    this.el.hidden = !visible;
    if (!visible) this.releaseAll();
  }

  setSpinAxis(axis: SpinAxis): void {
    const labels = SPIN_LABELS[axis];
    this.caption.textContent = labels.caption;
    this.buttons.left.setAttribute("aria-label", labels.left);
    this.buttons.right.setAttribute("aria-label", labels.right);
  }

  /** Drop every held finger (blur, hidden tab, controls hidden). */
  releaseAll(): void {
    for (const [id, control] of this.pointers) {
      const button = this.buttons[control];
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    }
    this.pointers.clear();
    for (const control of HOLD_CONTROLS) {
      this.counts[control] = 0;
      this.buttons[control].classList.remove("is-pressed");
    }
  }

  dispose(): void {
    this.releaseAll();
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointercancel", this.onUp);
    this.el.removeEventListener("lostpointercapture", this.onUp);
    this.el.removeEventListener("contextmenu", this.onContextMenu);
    this.el.remove();
  }

  private readonly onDown = (e: PointerEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const button = target?.closest<HTMLButtonElement>("[data-control]");
    if (!button || this.pointers.has(e.pointerId)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const control = button.dataset.control as HoldControl;
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for a pointer that is already gone; the press still counts.
    }
    this.pointers.set(e.pointerId, control);
    this.counts[control] += 1;
    button.classList.add("is-pressed");
  };

  private readonly onUp = (e: PointerEvent): void => {
    const control = this.pointers.get(e.pointerId);
    if (control === undefined) return;
    this.pointers.delete(e.pointerId);
    this.counts[control] = Math.max(0, this.counts[control] - 1);
    if (this.counts[control] === 0) {
      this.buttons[control].classList.remove("is-pressed");
    }
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
}
