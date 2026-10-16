import type { LevelDef, LevelId } from "@/core/types";
import {
  SCHEME_LABEL,
  buttonKey,
  cheatSheet,
  type ControlScheme,
  type HintSegment,
} from "./controls-info";
import { h, icon, keycap, replayClass } from "./dom";
import { formatScore } from "./format";
import { ART_CURL, ART_LINEUP, ICONS } from "./icons";
import authorAvatar from "./assets/sebayaki.png";
import type { Toggles } from "./toggles";

const REPO_URL = "https://github.com/sebayaki/roadster";
const AUTHOR_URL = "https://x.com/0xsebayaki";

const ART: Partial<Record<LevelId, string>> = {
  backflip: ART_CURL,
  kickflip: ART_LINEUP,
};

/** Render a hint / cheat-sheet segment: plain text or a keycap (touch spin keys draw the glyph). */
export function segmentNode(seg: HintSegment): Node {
  if (typeof seg === "string") return document.createTextNode(seg);
  if (seg.icon) {
    const cap = keycap("", "hud-key hud-key--icon");
    cap.setAttribute(
      "aria-label",
      seg.icon === "ccw" ? "counter-clockwise" : "clockwise"
    );
    cap.append(icon(seg.icon === "ccw" ? ICONS.ccw : ICONS.cw));
    return cap;
  }
  return keycap(seg.key);
}

/**
 * Title screen over the attract demo: wordmark, the two stunt cards, a
 * device-aware controls cheat sheet, sound / units toggles and the disclaimer.
 */
export class MenuView {
  readonly el: HTMLElement;
  private readonly cards = h("div", { class: "menu-cards" });
  private readonly sheet = h("aside", {
    class: "menu-sheet hud-glass",
    "aria-label": "Controls",
  });
  private levels: LevelDef[] = [];
  private scheme: ControlScheme = "keyboard";
  private onPlay: ((id: LevelId) => void) | null = null;

  constructor(toggles: Toggles) {
    this.el = h(
      "section",
      { class: "hud-menu", hidden: true, "aria-label": "Main menu" },
      h(
        "div",
        { class: "menu-brand" },
        h(
          "h1",
          { class: "wordmark", "aria-label": "RDSTR Stunts" },
          h("span", { class: "wm-a" }, "RDSTR"),
          " ",
          h("span", { class: "wm-b" }, "STUNTS")
        ),
        h(
          "p",
          { class: "menu-sub" },
          "Unofficial fan game — fly the new Roadster while you wait"
        )
      ),
      toggles.el,
      h("div", { class: "menu-main" }, this.cards, this.sheet),
      h(
        "footer",
        { class: "menu-foot" },
        h("span", null, "Fan-made. Not affiliated with Tesla, Inc."),
        h(
          "a",
          {
            class: "foot-link",
            href: REPO_URL,
            target: "_blank",
            rel: "noopener",
          },
          icon(ICONS.github, "foot-icon"),
          "Open source · MIT License"
        ),
        h(
          "a",
          {
            class: "foot-link",
            href: AUTHOR_URL,
            target: "_blank",
            rel: "noopener",
          },
          h("img", {
            class: "foot-avatar",
            src: authorAvatar,
            alt: "",
            width: 18,
            height: 18,
            decoding: "async",
          }),
          "Made by ",
          h("strong", null, "sebayaki.eth")
        )
      )
    );
    this.cards.addEventListener("click", this.onCardsClick);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /**
   * Show (or refresh in place) the menu. A fresh show plays the entrance motion
   * and, with `autofocus`, focuses the first PLAY so Enter starts it; a refresh
   * of an already visible menu keeps the focus and skips the motion.
   */
  show(
    levels: LevelDef[],
    best: Partial<Record<LevelId, number>>,
    scheme: ControlScheme,
    onPlay: (id: LevelId) => void,
    autofocus: boolean
  ): void {
    const refresh = this.visible;
    this.levels = levels;
    this.onPlay = onPlay;
    this.renderCards(best, scheme);
    this.renderSheet(scheme);
    this.el.dataset.scheme = scheme;
    this.el.hidden = false;
    if (!refresh) {
      replayClass(this.el, "is-entering");
      if (autofocus) this.firstPlay()?.focus({ preventScroll: true });
    }
  }

  hide(): void {
    this.el.hidden = true;
    this.onPlay = null;
  }

  /** Re-render the cheat sheet when the control scheme changes (gamepad plugged in). */
  setScheme(scheme: ControlScheme): void {
    if (!this.visible || scheme === this.scheme) return;
    this.renderSheet(scheme);
    this.el.dataset.scheme = scheme;
  }

  /** Enter / A: play the focused stunt, otherwise the first one. */
  playFocusedOrFirst(): void {
    const focused = document.activeElement;
    const id =
      focused instanceof HTMLElement && this.cards.contains(focused)
        ? focused.dataset.level
        : undefined;
    const level = this.levels.find((l) => l.id === id) ?? this.levels[0];
    if (level) this.play(level.id);
  }

  private play(id: LevelId): void {
    const onPlay = this.onPlay;
    if (!onPlay) return;
    // One play per menu visit: guards double clicks and Enter + click races.
    this.onPlay = null;
    onPlay(id);
  }

  private firstPlay(): HTMLButtonElement | null {
    return this.cards.querySelector<HTMLButtonElement>(".card-play");
  }

  private readonly onCardsClick = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const card = target?.closest<HTMLElement>("[data-level]");
    const id = card?.dataset.level as LevelId | undefined;
    if (id) this.play(id);
  };

  private renderCards(
    best: Partial<Record<LevelId, number>>,
    scheme: ControlScheme
  ): void {
    const playKey = buttonKey(scheme, "play");
    const focusedId =
      document.activeElement instanceof HTMLElement &&
      this.cards.contains(document.activeElement)
        ? document.activeElement.dataset.level
        : undefined;
    this.cards.replaceChildren(
      ...this.levels.map((level, index) => {
        const score = best[level.id];
        const art = ART[level.id];
        const play = h(
          "button",
          {
            type: "button",
            class: "hud-btn hud-btn--primary card-play",
            "data-level": level.id,
            "aria-label": `Play ${level.title} at ${level.venue}`,
          },
          h("span", null, "PLAY"),
          icon(ICONS.play),
          playKey ? keycap(playKey, "hud-key card-key") : null
        );
        return h(
          "article",
          {
            class: "stunt-card hud-glass",
            "data-level": level.id,
            style: `--i:${index}`,
          },
          h(
            "div",
            { class: "card-head" },
            h(
              "div",
              { class: "card-eyebrow" },
              h(
                "span",
                { class: "card-index" },
                `Stunt ${String(index + 1).padStart(2, "0")}`
              ),
              h("span", { class: "card-venue" }, level.venue)
            ),
            art ? icon(art, "card-art") : null
          ),
          h("h2", { class: "card-title" }, level.title),
          h("p", { class: "card-tagline" }, level.tagline),
          h(
            "div",
            { class: "card-foot" },
            h(
              "div",
              { class: "card-best" },
              h("span", { class: "hud-label" }, "BEST"),
              h(
                "span",
                { class: `card-best-val${score ? "" : " is-empty"}` },
                score ? formatScore(score) : "—"
              )
            ),
            play
          )
        );
      })
    );
    if (focusedId) {
      this.cards
        .querySelector<HTMLButtonElement>(
          `.card-play[data-level="${focusedId}"]`
        )
        ?.focus({ preventScroll: true });
    }
  }

  private renderSheet(scheme: ControlScheme): void {
    this.scheme = scheme;
    const rows = cheatSheet(scheme);
    this.sheet.replaceChildren(
      h(
        "div",
        { class: "sheet-head" },
        h("span", { class: "hud-label" }, "Controls"),
        h("span", { class: "sheet-scheme" }, SCHEME_LABEL[scheme])
      ),
      h(
        "dl",
        { class: "sheet-rows" },
        ...rows.map((row) =>
          h(
            "div",
            { class: "sheet-row" },
            h("dt", null, row.label),
            h("dd", null, ...row.keys.map(segmentNode))
          )
        )
      )
    );
  }
}
