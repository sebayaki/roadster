import type {
  CarSnapshot,
  CrashReason,
  InputAction,
  LandingResult,
  LevelDef,
  LevelId,
  Units,
} from "@/core/types";
import { loadBestScores } from "@/core/storage";
import { LEVEL_ORDER } from "@/levels";
import { INPUT_EVENT, isInputAction } from "@/input/events";
import { PauseCard, ResultCard } from "./cards";
import { detectScheme, type ControlScheme } from "./controls-info";
import { MenuView } from "./menu-view";
import { PopupLayer } from "./popups";
import { RunView } from "./run-view";
import { Toggles } from "./toggles";
import "./hud.css";

export interface MenuOptions {
  levels: LevelDef[];
  best: Partial<Record<LevelId, number>>;
  muted: boolean;
  units: Units;
  isTouch: boolean;
  onPlay(id: LevelId): void;
}

export interface ResultOptions {
  level: LevelDef;
  /** Set when the run ended in a clean touchdown. */
  landing: LandingResult | null;
  /** Set when the run ended in a wreck. */
  crash: { reason: CrashReason; obstacle?: string } | null;
  best: number;
  isNewBest: boolean;
  units: Units;
  onRetry(): void;
  onNext(): void;
  onMenu(): void;
}

export interface PauseOptions {
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
}

export type PopupKind = "trick" | "info" | "warn" | "perfect";

/**
 * DOM overlay: title menu, in-run HUD, popups, pause and result cards.
 *
 * Coordination with Input (both use window events, see src/input/events.ts):
 * - the HUD's pause / mute / units buttons emit `rdstr:action`, which Input
 *   queues like the matching keys, so the App handles them as usual;
 * - sound and units belong to the App: buttons and keys only emit actions and
 *   the App pushes the new values back through setMuted / setUnits;
 * - while the menu, pause or result card is open the HUD claims Enter / Space /
 *   A (confirm), Esc / B (back), R / Y (restart) through `rdstr:input` and runs
 *   the card's own callbacks, so those keys never reach the App twice.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly menuToggles: Toggles;
  private readonly pauseToggles: Toggles;
  private readonly menu: MenuView;
  private readonly run: RunView;
  private readonly popups = new PopupLayer();
  private readonly result: ResultCard;
  private readonly pause: PauseCard;

  private level: LevelDef | null = null;
  private muted = false;
  private units: Units = "metric";
  private isTouch = false;
  private scheme: ControlScheme = "keyboard";
  /** Best score per level, kept current from showMenu / showResult (seeded from storage). */
  private readonly best: Partial<Record<LevelId, number>>;
  private readonly howToSeen = new Set<LevelId>();
  private rotateHintShown = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.best = { ...loadBestScores() };

    this.menuToggles = new Toggles();
    this.pauseToggles = new Toggles();
    this.menu = new MenuView(this.menuToggles);
    this.run = new RunView();
    this.result = new ResultCard();
    this.pause = new PauseCard(this.pauseToggles);

    root.classList.add("hud-root");
    root.append(
      this.run.el,
      this.popups.el,
      this.menu.el,
      this.result.el,
      this.pause.el
    );
    this.syncToggles();

    window.addEventListener(INPUT_EVENT, this.onInputAction);
    window.addEventListener("gamepadconnected", this.onGamepad);
    window.addEventListener("gamepaddisconnected", this.onGamepad);
  }

  showMenu(opts: MenuOptions): void {
    this.muted = opts.muted;
    this.units = opts.units;
    this.isTouch = opts.isTouch;
    this.scheme = detectScheme(opts.isTouch);
    Object.assign(this.best, opts.best);
    this.run.hide();
    this.result.hide();
    this.pause.hide();
    this.popups.clear();
    this.syncToggles();
    this.menu.show(
      opts.levels,
      opts.best,
      this.scheme,
      (id) => opts.onPlay(id),
      !opts.isTouch
    );
  }

  /** In-run HUD for a level; shows the "hold gas to go" hint until the car moves. */
  showRun(level: LevelDef, isTouch: boolean): void {
    this.level = level;
    this.isTouch = isTouch;
    this.scheme = detectScheme(isTouch);
    this.menu.hide();
    this.result.hide();
    this.pause.hide();
    this.popups.clear();
    const firstRun = !this.howToSeen.has(level.id);
    this.howToSeen.add(level.id);
    const rotateHint =
      isTouch &&
      !this.rotateHintShown &&
      matchMedia("(orientation: portrait)").matches;
    if (rotateHint) this.rotateHintShown = true;
    this.run.show(level, this.scheme, isTouch, this.best[level.id], {
      howTo: firstRun,
      rotateHint,
    });
    this.run.el.inert = false;
  }

  /** Per frame during a run: speedometer (+ speed hint band), height, gas, live rotation dial, air time. */
  update(car: CarSnapshot, level: LevelDef, units: Units): void {
    if (units !== this.units) this.setUnits(units);
    this.run.update(car, level, units);
  }

  /** Transient centered callout, e.g. "BACKFLIP!", "PERFECT LANDING", "OUT OF GAS". */
  popup(text: string, kind: PopupKind = "info"): void {
    this.popups.show(text, kind);
  }

  showResult(opts: ResultOptions): void {
    if (opts.best > 0) this.best[opts.level.id] = opts.best;
    this.level = opts.level;
    this.units = opts.units;
    this.syncToggles();
    this.pause.hide();
    this.menu.hide();
    this.run.hide();
    const stuntNumber = Math.max(0, LEVEL_ORDER.indexOf(opts.level.id)) + 1;
    this.result.show(opts, this.scheme, this.run.attitude, stuntNumber);
  }

  showPause(opts: PauseOptions): void {
    this.run.el.inert = true;
    // Every pause action leaves the pause state, so close the card before calling the App.
    const leave = (fn: () => void) => () => {
      this.hidePause();
      fn();
    };
    this.pause.show(
      {
        onResume: leave(() => opts.onResume()),
        onRestart: leave(() => opts.onRestart()),
        onMenu: leave(() => opts.onMenu()),
      },
      this.level,
      this.scheme
    );
  }

  hidePause(): void {
    this.pause.hide();
    this.run.el.inert = false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncToggles();
  }

  /** Units switched in the App: toggles, run gauges and result stats follow right away. */
  setUnits(units: Units): void {
    this.units = units;
    this.syncToggles();
    this.run.setUnits(units);
    this.result.setUnits(units);
  }

  dispose(): void {
    window.removeEventListener(INPUT_EVENT, this.onInputAction);
    window.removeEventListener("gamepadconnected", this.onGamepad);
    window.removeEventListener("gamepaddisconnected", this.onGamepad);
    this.popups.clear();
    this.result.hide();
    for (const el of [
      this.run.el,
      this.popups.el,
      this.menu.el,
      this.result.el,
      this.pause.el,
    ]) {
      el.remove();
    }
    this.root.classList.remove("hud-root");
  }

  private syncToggles(): void {
    this.menuToggles.sync(this.muted, this.units);
    this.pauseToggles.sync(this.muted, this.units);
    this.run.setMuted(this.muted);
  }

  /** Keyboard / gamepad actions announced by Input; open cards claim the ones they handle. */
  private readonly onInputAction = (e: Event): void => {
    const action: unknown = (e as CustomEvent<unknown>).detail;
    if (!isInputAction(action)) return;
    const overlay = this.pause.visible
      ? this.pause
      : this.result.visible
        ? this.result
        : null;
    const mapped = mapOverlayAction(action);
    if (overlay) {
      if (!mapped) return;
      e.preventDefault();
      overlay.handle(mapped);
    } else if (this.menu.visible && mapped) {
      e.preventDefault();
      if (mapped === "confirm") this.menu.playFocusedOrFirst();
    }
  };

  private readonly onGamepad = (): void => {
    if (this.isTouch) return;
    this.scheme = detectScheme(false);
    this.menu.setScheme(this.scheme);
  };
}

/** confirm → confirm, restart → restart, back / pause → back; camera passes through. */
function mapOverlayAction(
  action: InputAction
): "confirm" | "restart" | "back" | null {
  switch (action) {
    case "confirm":
    case "restart":
      return action;
    case "back":
    case "pause":
      return "back";
    default:
      return null;
  }
}
