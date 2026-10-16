/** Tiny DOM helpers for the HUD: element builder, keycaps and change-detecting setters. */
import type { HintSegment } from "./controls-info";
import { ICONS } from "./icons";

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Create an element with attributes (class, aria-*, data-*, …) and children (nodes or text). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      el.setAttribute(name, value === true ? "" : String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

/** Replace all children of `el` (null / false entries are skipped). */
export function setChildren(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  appendChildren(el, children);
}

function appendChildren(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "number" ? String(child) : child);
  }
}

/** Wrap trusted static SVG markup (see icons.ts) in a span. */
export function icon(
  svgMarkup: string,
  className = "hud-icon"
): HTMLSpanElement {
  const span = h("span", { class: className, "aria-hidden": "true" });
  span.innerHTML = svgMarkup;
  return span;
}

/** Keyboard / button glyph chip. */
export function keycap(label: string, className = "hud-key"): HTMLElement {
  return h("kbd", { class: className }, label);
}

/** A hint / cheat-sheet segment: plain text or a keycap (touch spin keys draw their glyph). */
export function segmentNode(seg: HintSegment): Node {
  if (typeof seg === "string") return document.createTextNode(seg);
  if (!seg.icon) return keycap(seg.key);
  return h(
    "kbd",
    {
      class: "hud-key hud-key--icon",
      "aria-label": seg.icon === "ccw" ? "counter-clockwise" : "clockwise",
    },
    icon(ICONS[seg.icon])
  );
}

/** Restart a CSS entrance animation by re-adding `className` (forces one style flush; call rarely). */
export function replayClass(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/** Text whose DOM node is rewritten only when the rounded value changes. */
export class NumberText {
  private last = Number.NaN;
  private readonly scale: number;

  constructor(
    private readonly el: HTMLElement,
    private readonly digits = 0
  ) {
    this.scale = 10 ** digits;
  }

  set(value: number): void {
    const q = Math.round(value * this.scale);
    if (q === this.last) return;
    this.last = q;
    this.el.textContent =
      this.digits === 0 ? String(q) : (q / this.scale).toFixed(this.digits);
  }

  /** Force the next set() to write (e.g. after the unit changed). */
  invalidate(): void {
    this.last = Number.NaN;
  }
}

/** A CSS transform driven by one number, written only when its quantized value changes. */
export class TransformSlot {
  private last = Number.NaN;

  constructor(
    private readonly el: HTMLElement | SVGElement,
    private readonly render: (value: number) => string,
    private readonly step = 0.001
  ) {}

  set(value: number): void {
    const q = Math.round(value / this.step);
    if (q === this.last) return;
    this.last = q;
    this.el.style.transform = this.render(q * this.step);
  }
}

/** A class toggle that touches the DOM only when the state flips. */
export class ClassFlag {
  private state: boolean | null = null;

  constructor(
    private readonly el: Element,
    private readonly className: string
  ) {}

  set(on: boolean): void {
    if (on === this.state) return;
    this.state = on;
    this.el.classList.toggle(this.className, on);
  }
}
