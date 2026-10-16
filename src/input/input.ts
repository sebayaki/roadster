import type { Controls, InputAction, SpinAxis } from "@/core/types";
import { clamp } from "@/core/math";
import { ACTION_EVENT, announceAction, isInputAction } from "./events";
import {
  HOLD_CONTROLS,
  KEY_ACTIONS,
  KEY_HOLD,
  KEY_PREVENT_DEFAULT,
  PAD,
  PAD_ACTIONS,
  countGamepads,
  isInteractiveTarget,
  readGamepads,
  stickToSpin,
  triggerToPedal,
  type HoldControl,
} from "./mapping";
import { TouchControls } from "./touch-controls";
import "./touch.css";

/** Returned by drainActions() when nothing happened (frozen: callers must not mutate it). */
const NO_ACTIONS = Object.freeze([]) as unknown as InputAction[];

function isPressed(buttons: readonly GamepadButton[], index: number): boolean {
  return buttons[index]?.pressed === true;
}

/** `?touch=1` / `?touch=0` forces the on-screen controls on or off (testing on desktop). */
function detectTouch(): boolean {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Keyboard + on-screen touch controls + gamepad, merged into one Controls value.
 *
 * Keyboard: ↑/W gas, ↓/S brake, Space thrust, ←/A and →/D spin,
 * R restart, Esc/P pause, C camera, M mute, U units, Enter confirm.
 *
 * Gamepad (standard mapping): RT gas, LT brake, A thrust / confirm, left stick X
 * or D-pad spin, Start pause, Y restart, B back.
 *
 * Every keyboard / gamepad action is first announced with the cancelable
 * `rdstr:input` window event so an open overlay (menu, pause, result) can claim
 * it; unclaimed actions are queued for drainActions(). `rdstr:action` events
 * (the HUD's on-screen buttons) are queued directly.
 */
export class Input {
  /** Current merged controls; refreshed by update(). */
  readonly controls: Controls = {
    throttle: 0,
    brake: 0,
    thrust: false,
    spin: 0,
  };
  /** True when the device has a coarse pointer (phone / tablet). */
  readonly isTouch: boolean;

  private queue: InputAction[] = [];
  private readonly touch: TouchControls;

  /** Held key code → control, plus how many keys hold each control. */
  private readonly keys = new Map<string, HoldControl>();
  private readonly keyCounts: Record<HoldControl, number> = {
    gas: 0,
    brake: 0,
    thrust: 0,
    left: 0,
    right: 0,
  };
  /** Space confirmed an overlay: ignore it as thrust until released. */
  private spaceLatched = false;
  /** Enter / Space presses that started on a focused button: its native activation owns them. */
  private readonly buttonKeys = new Set<string>();

  private padsConnected = 0;
  /** Per gamepad index: bitmask of action buttons held last poll. */
  private readonly padPrev: number[] = [];
  /** Per gamepad index: A confirmed an overlay, ignore it as thrust until released. */
  private readonly padLatched: boolean[] = [];
  private padThrottle = 0;
  private padBrake = 0;
  private padSpin = 0;
  private padThrust = false;

  /** `touchRoot` receives the on-screen buttons (gas, brake, thrust, spin ◀ ▶). */
  constructor(touchRoot: HTMLElement) {
    this.isTouch = detectTouch();
    this.touch = new TouchControls(touchRoot);
    this.padsConnected = countGamepads();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("gamepadconnected", this.onPadsChanged);
    window.addEventListener("gamepaddisconnected", this.onPadsChanged);
    window.addEventListener(ACTION_EVENT, this.onActionEvent);
  }

  /** Call once per frame before reading `controls` (polls gamepads). */
  update(): void {
    this.pollGamepads();
    const k = this.keyCounts;
    const t = this.touch;
    const c = this.controls;
    c.throttle = Math.max(
      k.gas > 0 ? 1 : 0,
      t.pressed("gas") ? 1 : 0,
      this.padThrottle
    );
    c.brake = Math.max(
      k.brake > 0 ? 1 : 0,
      t.pressed("brake") ? 1 : 0,
      this.padBrake
    );
    c.thrust =
      (k.thrust > 0 && !this.spaceLatched) ||
      t.pressed("thrust") ||
      this.padThrust;
    const keySpin = (k.right > 0 ? 1 : 0) - (k.left > 0 ? 1 : 0);
    const touchSpin =
      (t.pressed("right") ? 1 : 0) - (t.pressed("left") ? 1 : 0);
    c.spin = clamp(keySpin + touchSpin + this.padSpin, -1, 1);
  }

  /** Edge-triggered actions since the previous call, oldest first. */
  drainActions(): InputAction[] {
    if (this.queue.length === 0) return NO_ACTIONS;
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /** Show the on-screen controls only during a run on touch devices. */
  setTouchControlsVisible(visible: boolean): void {
    this.touch.setVisible(visible && this.isTouch);
  }

  /** Update the spin button glyphs/labels for the level's axis (flip vs roll). */
  setSpinAxis(axis: SpinAxis): void {
    this.touch.setSpinAxis(axis);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.releaseAll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("gamepadconnected", this.onPadsChanged);
    window.removeEventListener("gamepaddisconnected", this.onPadsChanged);
    window.removeEventListener(ACTION_EVENT, this.onActionEvent);
    this.touch.dispose();
    this.queue = [];
  }

  /** Announce to overlays, queue for the App when nobody claimed it. */
  private emit(action: InputAction): void {
    if (!announceAction(action)) this.queue.push(action);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code;
    const activates =
      code === "Enter" || code === "NumpadEnter" || code === "Space";
    if (activates && isInteractiveTarget(e.target)) {
      // A fresh press activates the focused button natively (no double trigger).
      if (!e.repeat && !this.keys.has(code)) {
        this.buttonKeys.add(code);
        return;
      }
      // A held key (thrust when a card opened, or auto-repeat) must not: Chrome
      // arms a button on a repeated Space keydown and clicks it on release.
      e.preventDefault();
      if (this.buttonKeys.has(code)) return;
    }
    if (KEY_PREVENT_DEFAULT.has(code)) e.preventDefault();

    const control = KEY_HOLD[code];
    if (control && !this.keys.has(code)) {
      this.keys.set(code, control);
      this.keyCounts[control] += 1;
    }
    if (e.repeat) return;
    if (code === "Space") {
      // Space confirms on overlays only; during a run it is just thrust.
      if (announceAction("confirm")) this.spaceLatched = true;
      return;
    }
    const action = KEY_ACTIONS[code];
    if (action) this.emit(action);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.buttonKeys.delete(code);
    const control = this.keys.get(code);
    if (control) {
      // Held since before a button took focus: releasing it must not click that button.
      if (isInteractiveTarget(e.target)) e.preventDefault();
      this.keys.delete(code);
      this.keyCounts[control] = Math.max(0, this.keyCounts[control] - 1);
    }
    if (code === "Space") this.spaceLatched = false;
  };

  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.buttonKeys.clear();
    for (const control of HOLD_CONTROLS) this.keyCounts[control] = 0;
    this.spaceLatched = false;
    this.touch.releaseAll();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") this.releaseAll();
  };

  private readonly onActionEvent = (e: Event): void => {
    const action = (e as CustomEvent<unknown>).detail;
    if (isInputAction(action)) this.queue.push(action);
  };

  private readonly onPadsChanged = (): void => {
    this.padsConnected = countGamepads();
    if (this.padsConnected === 0) {
      this.padPrev.length = 0;
      this.padLatched.length = 0;
    }
  };

  private pollGamepads(): void {
    this.padThrottle = 0;
    this.padBrake = 0;
    this.padSpin = 0;
    this.padThrust = false;
    if (this.padsConnected === 0) return;
    const pads = readGamepads();
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;
      const b = pad.buttons;

      this.padThrottle = Math.max(
        this.padThrottle,
        triggerToPedal(b[PAD.RT]?.value ?? 0)
      );
      this.padBrake = Math.max(
        this.padBrake,
        triggerToPedal(b[PAD.LT]?.value ?? 0)
      );
      let spin = stickToSpin(pad.axes[0] ?? 0);
      if (isPressed(b, PAD.DPAD_LEFT)) spin -= 1;
      if (isPressed(b, PAD.DPAD_RIGHT)) spin += 1;
      this.padSpin += spin;

      const a = isPressed(b, PAD.A);
      const prev = this.padPrev[i] ?? 0;
      let now = a ? 1 : 0;
      for (let j = 0; j < PAD_ACTIONS.length; j++) {
        if (isPressed(b, PAD_ACTIONS[j][0])) now |= 2 << j;
      }
      const edges = now & ~prev;
      this.padPrev[i] = now;

      if (!a) this.padLatched[i] = false;
      // A confirms on overlays only; during a run it is just thrust.
      if (edges & 1 && announceAction("confirm")) this.padLatched[i] = true;
      if (a && !this.padLatched[i]) this.padThrust = true;
      for (let j = 0; j < PAD_ACTIONS.length; j++) {
        if (edges & (2 << j)) this.emit(PAD_ACTIONS[j][1]);
      }
    }
  }
}
