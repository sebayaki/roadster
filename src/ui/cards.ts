import type { LandingGrade, LevelDef, Units } from "@/core/types";
import { DEG } from "@/core/math";
import { buttonKey, type ControlScheme } from "./controls-info";
import { h, icon, keycap, onPress, replayClass, setChildren } from "./dom";
import {
  SHORT_LINE,
  SHORT_TIP,
  crashReasonLine,
  crashTip,
  formatBest,
  formatLength,
  formatMultiplier,
  formatScore,
  formatSeconds,
  formatSpeed,
  resultKind,
  sharePageUrl,
  shareText,
  shareUrl,
  stuntLabel,
  type Attitude,
} from "./format";
import type { PauseOptions, ResultOptions } from "./hud";
import { ICONS } from "./icons";
import type { Toggles } from "./toggles";

let idCounter = 0;

const GRADE_WORD: Record<LandingGrade, string> = {
  perfect: "Perfect",
  great: "Great",
  good: "Good",
};

function button(
  label: string,
  iconSvg: string,
  key: string | null,
  primary = false
): HTMLButtonElement {
  return h(
    "button",
    { type: "button", class: `hud-btn${primary ? " hud-btn--primary" : ""}` },
    icon(iconSvg),
    h("span", null, label),
    key ? keycap(key) : null
  );
}

function row(label: string, value: string, className = ""): HTMLElement {
  return h(
    "div",
    { class: `rc-row ${className}` },
    h("dt", null, label),
    h("dd", null, value)
  );
}

/** Focus the button without scrolling, unless the device is touch-only (no focus rings there). */
function autofocus(el: HTMLElement, scheme: ControlScheme): void {
  if (scheme !== "touch") el.focus({ preventScroll: true });
}

/** Activate the focused button inside `card`, else `fallback`. */
function activateFocused(card: HTMLElement, fallback: () => void): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLButtonElement && card.contains(focused))
    focused.click();
  else fallback();
}

/** End-of-run card: trick or WRECKED / TOO SHORT, grade, breakdown, stats, best and actions. */
export class ResultCard {
  readonly el: HTMLElement;
  private readonly card = h("div", { class: "hud-card result-card" });
  private readonly titleId = `rc-title-${++idCounter}`;
  private opts: ResultOptions | null = null;
  private stats: HTMLElement | null = null;
  private locked = false;
  private raf = 0;
  /** Touch devices share through the OS share sheet (KakaoTalk, Messages, LINE, X app…). */
  private nativeShare = false;

  constructor() {
    this.el = h(
      "section",
      {
        class: "hud-result hud-overlay",
        hidden: true,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": this.titleId,
      },
      this.card
    );
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(
    opts: ResultOptions,
    scheme: ControlScheme,
    attitude: Attitude,
    stuntNumber: number
  ): void {
    this.opts = opts;
    this.locked = false;
    const { level, landing, crash } = opts;
    const kind = resultKind(landing);

    let title: string;
    let sub: string;
    let tip = "";
    if (landing && kind === "landed") {
      title = landing.trick.name;
      sub = `${GRADE_WORD[landing.grade]} landing`;
    } else if (landing) {
      title = "TOO SHORT";
      sub = SHORT_LINE;
      tip = SHORT_TIP;
    } else {
      title = "WRECKED";
      sub = crashReasonLine(
        crash?.reason ?? "impact",
        crash?.obstacle,
        attitude
      );
      tip = crashTip(
        crash?.reason ?? "impact",
        level.spinAxis,
        crash?.obstacle
      );
    }

    const retry = button(
      "Retry",
      ICONS.retry,
      buttonKey(scheme, "retry"),
      true
    );
    const next = button("Next stunt", ICONS.next, null);
    const menu = button("Menu", ICONS.menu, null);
    this.nativeShare = scheme === "touch" && "share" in navigator;
    const share = button(
      this.nativeShare ? "Share" : "Share on X",
      ICONS.share,
      null
    );
    onPress(retry, () => this.run((o) => o.onRetry()));
    onPress(next, () => this.run((o) => o.onNext()));
    onPress(menu, () => this.run((o) => o.onMenu()));
    onPress(share, () => this.share());
    if (!this.nativeShare)
      share.setAttribute("aria-label", "Share on X (opens a new tab)");

    const totalValue = h("span", { class: "rc-total-val" }, "0");
    const total = landing?.score.total ?? 0;
    this.stats = landing ? h("dl", { class: "rc-stats" }) : null;

    this.card.className = `hud-card result-card is-${kind}`;
    setChildren(
      this.card,
      h(
        "div",
        { class: "rc-eyebrow" },
        `${stuntLabel(stuntNumber)} · ${level.title} · ${level.venue}`
      ),
      h(
        "div",
        { class: "rc-head" },
        h(
          "div",
          { class: "rc-heading" },
          h("h2", { class: "rc-title", id: this.titleId }, title),
          h("p", { class: "rc-sub" }, sub),
          tip ? h("p", { class: "rc-tip" }, tip) : null
        ),
        landing && kind === "landed"
          ? h(
              "div",
              { class: `rc-grade is-${landing.grade}` },
              h(
                "span",
                { class: "rc-grade-name" },
                GRADE_WORD[landing.grade].toUpperCase()
              ),
              h(
                "span",
                { class: "rc-grade-mult" },
                formatMultiplier(landing.score.multiplier)
              )
            )
          : null
      ),
      landing
        ? h(
            "div",
            { class: "rc-body" },
            h(
              "dl",
              { class: "rc-breakdown" },
              row(
                kind === "landed" ? `Trick` : `Trick · missed`,
                formatScore(landing.score.trick)
              ),
              row("Air", formatScore(landing.score.air)),
              row("Height", formatScore(landing.score.height)),
              row("Gas left", formatScore(landing.score.gas)),
              row(
                "Landing",
                formatMultiplier(landing.score.multiplier),
                "is-mult"
              )
            ),
            this.stats
          )
        : null,
      h(
        "div",
        { class: "rc-score" },
        h(
          "div",
          { class: "rc-total" },
          h("span", { class: "hud-label" }, "Score"),
          totalValue,
          opts.isNewBest ? h("span", { class: "rc-new" }, "New best") : null
        ),
        h(
          "div",
          { class: "rc-best" },
          h("span", { class: "hud-label" }, "Best"),
          h("span", { class: "rc-best-val" }, formatBest(opts.best))
        )
      ),
      h("div", { class: "rc-actions" }, retry, next, menu, share)
    );
    this.renderStats(opts.units);

    this.el.hidden = false;
    replayClass(this.el, "is-entering");
    this.countUp(totalValue, total);
    autofocus(retry, scheme);
  }

  hide(): void {
    this.el.hidden = true;
    this.opts = null;
    cancelAnimationFrame(this.raf);
  }

  /** Units toggled while the card is up: re-render the stats in place. */
  setUnits(units: Units): void {
    if (this.opts && this.opts.units !== units) {
      this.opts = { ...this.opts, units };
      this.renderStats(units);
    }
  }

  /** Overlay key handling: confirm → focused button or RETRY; restart → RETRY; back → MENU. */
  handle(action: "confirm" | "restart" | "back"): void {
    if (action === "confirm")
      activateFocused(this.card, () => this.run((o) => o.onRetry()));
    else if (action === "restart") this.run((o) => o.onRetry());
    else this.run((o) => o.onMenu());
  }

  private run(fn: (opts: ResultOptions) => void): void {
    const opts = this.opts;
    if (!opts || this.locked) return;
    this.locked = true;
    fn(opts);
  }

  private share(): void {
    const opts = this.opts;
    if (!opts) return;
    const text = shareText(opts.level, opts.landing);
    const url = sharePageUrl(
      document.querySelector<HTMLLinkElement>("link[rel=canonical]")?.href,
      location
    );
    const openIntent = () =>
      window.open(shareUrl(text, url), "_blank", "noopener,noreferrer");
    if (!this.nativeShare) {
      openIntent();
      return;
    }
    navigator
      .share({ title: document.title, text, url })
      .catch((err: unknown) => {
        // AbortError: the user closed the share sheet.
        if (!(err instanceof DOMException && err.name === "AbortError"))
          openIntent();
      });
  }

  private renderStats(units: Units): void {
    const landing = this.opts?.landing;
    if (!this.stats || !landing) return;
    const { stats } = landing;
    this.stats.replaceChildren(
      row("Air time", formatSeconds(stats.airTime)),
      row("Max height", formatLength(stats.maxHeight, units)),
      row("Distance", formatLength(stats.distance, units, 0)),
      row("Top speed", formatSpeed(stats.topSpeed, units)),
      row(
        "Touchdown",
        `${formatSpeed(landing.impactSpeed, units)} · ${Math.round(landing.angleError / DEG)}°`
      )
    );
  }

  private countUp(el: HTMLElement, total: number): void {
    cancelAnimationFrame(this.raf);
    if (total <= 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = formatScore(total);
      return;
    }
    const start = performance.now() + 250;
    const duration = 900;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / duration));
      el.textContent = formatScore(total * (1 - (1 - k) ** 3));
      if (k < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/** Pause card: RESUME / RESTART / MENU plus the sound and units toggles. */
export class PauseCard {
  readonly el: HTMLElement;
  private readonly eyebrow = h("div", { class: "rc-eyebrow" });
  private readonly card: HTMLElement;
  private readonly resume: HTMLButtonElement;
  private readonly restart: HTMLButtonElement;
  private readonly menu: HTMLButtonElement;
  private opts: PauseOptions | null = null;

  constructor(toggles: Toggles) {
    const titleId = `pause-title-${++idCounter}`;
    this.resume = button("Resume", ICONS.play, null, true);
    this.restart = button("Restart", ICONS.retry, null);
    this.menu = button("Menu", ICONS.menu, null);
    onPress(this.resume, () => this.run((o) => o.onResume()));
    onPress(this.restart, () => this.run((o) => o.onRestart()));
    onPress(this.menu, () => this.run((o) => o.onMenu()));
    this.card = h(
      "div",
      { class: "hud-card pause-card" },
      this.eyebrow,
      h("h2", { class: "pause-title", id: titleId }, "Paused"),
      h(
        "div",
        { class: "pause-actions" },
        this.resume,
        this.restart,
        this.menu
      ),
      h("div", { class: "pause-toggles" }, toggles.el)
    );
    this.el = h(
      "section",
      {
        class: "hud-pause hud-overlay",
        hidden: true,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
      },
      this.card
    );
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(
    opts: PauseOptions,
    level: LevelDef | null,
    scheme: ControlScheme
  ): void {
    const wasVisible = this.visible;
    this.opts = opts;
    this.eyebrow.textContent = level ? `${level.title} · ${level.venue}` : "";
    this.setKey(this.resume, buttonKey(scheme, "resume"));
    this.setKey(this.restart, buttonKey(scheme, "restart"));
    this.el.hidden = false;
    if (!wasVisible) {
      replayClass(this.el, "is-entering");
      autofocus(this.resume, scheme);
    }
  }

  hide(): void {
    this.el.hidden = true;
    this.opts = null;
  }

  /** Overlay key handling: confirm → focused button or RESUME; restart → RESTART; back / pause → RESUME. */
  handle(action: "confirm" | "restart" | "back"): void {
    if (action === "confirm")
      activateFocused(this.card, () => this.run((o) => o.onResume()));
    else if (action === "restart") this.run((o) => o.onRestart());
    else this.run((o) => o.onResume());
  }

  private setKey(btn: HTMLButtonElement, key: string | null): void {
    btn.querySelector("kbd")?.remove();
    if (key) btn.append(keycap(key));
  }

  /** One action per pause: further clicks are ignored until the card is shown again. */
  private run(fn: (opts: PauseOptions) => void): void {
    const opts = this.opts;
    if (!opts) return;
    this.opts = null;
    fn(opts);
  }
}
