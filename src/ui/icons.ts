/**
 * Inline SVG icons (trusted static markup, drawn with currentColor).
 * Icons use a 24×24 grid; pictograms and dial glyphs have their own view boxes.
 */
const stroke =
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const svg = (body: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" focusable="false" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pause: svg(
    '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"/>'
  ),
  soundOn: svg(
    `<path d="M3.5 9.5h3.6L12 5.6v12.8l-4.9-3.9H3.5z" fill="currentColor"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M18 6.6a7.6 7.6 0 0 1 0 10.8" ${stroke}/>`
  ),
  soundOff: svg(
    `<path d="M3.5 9.5h3.6L12 5.6v12.8l-4.9-3.9H3.5z" fill="currentColor"/><path d="M15.8 9.6l4.8 4.8M20.6 9.6l-4.8 4.8" ${stroke}/>`
  ),
  play: svg('<path d="M8 5.2v13.6L18.8 12z" fill="currentColor"/>'),
  retry: svg(
    `<path d="M18.6 13.4A6.8 6.8 0 1 1 16.5 7" ${stroke}/><path d="M17.4 3.6v3.9h-3.9" ${stroke}/>`
  ),
  next: svg(`<path d="M5 12h13.5M13.2 6.6l5.4 5.4-5.4 5.4" ${stroke}/>`),
  menu: svg(`<path d="M5 7.5h14M5 12h14M5 16.5h14" ${stroke}/>`),
  share: svg(
    `<path d="M12 3.8v11M7.8 8 12 3.8 16.2 8" ${stroke}/><path d="M5.2 12.6v5.6c0 .9.7 1.6 1.6 1.6h10.4c.9 0 1.6-.7 1.6-1.6v-5.6" ${stroke}/>`
  ),
  /** Anticlockwise open circle arrow (↺). */
  ccw: svg(
    `<path d="M12 19.2A7.2 7.2 0 1 0 4.8 12" ${stroke}/><path d="M2.3 9.6 4.8 12.6 7.6 10" ${stroke}/>`
  ),
  /** Clockwise open circle arrow (↻). */
  cw: svg(
    `<path d="M12 19.2A7.2 7.2 0 1 1 19.2 12" ${stroke}/><path d="M16.4 10l2.8 2.6 2.5-3" ${stroke}/>`
  ),
  /** Car underside with three downward cold-gas plumes. */
  thrust: svg(
    `<path d="M3.5 6.5h17" ${stroke} stroke-width="2.4"/><path d="M6 9.5 4 18.5c0 1.2 1 1.8 2 1.8s2-.6 2-1.8zM12 9.5l-2.2 10.2c0 1.3 1 2 2.2 2s2.2-.7 2.2-2zM18 9.5l-2 9c0 1.2 1 1.8 2 1.8s2-.6 2-1.8z" fill="currentColor" opacity=".9"/>`
  ),
  /** GitHub mark (Octicons mark-github). */
  github: svg(
    '<path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.01 8.01 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A8.01 8.01 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>',
    "0 0 16 16"
  ),
  rotatePhone: svg(
    `<rect x="7.5" y="3" width="9" height="15" rx="1.8" ${stroke}/><path d="M20.5 13.5a8.5 8.5 0 0 1-7 7.4" ${stroke}/><path d="M15.3 18.6l-1.9 2.4 2.6 1.6" ${stroke}/>`
  ),
} as const;

/** Side silhouette for the pitch dial (nose to the right), centered on (60, 60). */
export const CAR_SIDE =
  '<path d="M27 65.5V57l5-3.4 21.5-5.4c3-.7 6-.6 8.8.4l11.6 4.6 21.2 6.3c1.3.4 2.1 1.5 2.1 2.8v3.2H27z" fill="currentColor"/>' +
  '<circle cx="40" cy="66" r="6" class="dial-wheel"/><circle cx="81" cy="66" r="6" class="dial-wheel"/>' +
  '<path d="M55 50.6l7-1.2 11 4.4" fill="none" class="dial-glass"/>';

/** Rear silhouette for the roll dial, centered on (60, 60). */
export const CAR_REAR =
  '<path d="M35 69V59.5l5.5-7.5h39l5.5 7.5V69z" fill="currentColor"/>' +
  '<rect x="31.5" y="62" width="6" height="11" rx="1.6" class="dial-wheel"/><rect x="82.5" y="62" width="6" height="11" rx="1.6" class="dial-wheel"/>' +
  '<path d="M39.5 61h41" class="dial-tail"/>';

/** Menu card pictogram: the Curl with the backflip trajectory. */
export const ART_CURL = svg(
  '<path d="M4 70h124" class="art-line"/>' +
    '<path d="M134 70V8M146 70V8M134 8h12M134 20l12 12M146 20l-12 12M134 32h12M134 44l12 12M146 44l-12 12M134 56h12" class="art-truss"/>' +
    '<path d="M78 70c30 0 48-12 50-34 1.4-15-6-26-24-29" class="art-ramp"/>' +
    '<path d="M100 6C80-1 58 7 51 29c-4 13-4 26-2 37" class="art-path"/>' +
    // The car flips backwards while flying right-to-left: counter-clockwise (↺).
    '<path d="M36 37A7 7 0 1 0 29 30" class="art-spin"/><path d="M26.6 27.7 29 30.6l2.7-2.5" class="art-spin"/>' +
    '<path d="M4 72.5h72" class="art-led"/>',
  "0 0 160 80"
);

/** Menu card pictogram: the lineup with the kickflip arc. */
export const ART_LINEUP = svg(
  '<path d="M2 68h156" class="art-line"/>' +
    '<path d="M17 66h126" class="art-stage"/><path d="M17 68.5h126" class="art-led"/>' +
    '<path d="M22 64v-6l4-5h12l4 5v6z" class="art-car"/>' +
    '<path d="M47 64v-7l4-6h12l4 6v7z" class="art-car"/>' +
    '<path d="M73 64V34c0-2 1.5-3 3.5-3h17c2 0 3.5 1 3.5 3v30z" class="art-car"/>' +
    '<path d="M103 64v-8l10-6 10 6v8z" class="art-car"/>' +
    '<path d="M128 64v-5l3.5-4h11l3.5 4v5z" class="art-car"/>' +
    '<path d="M6 60C26 22 52 6 80 6s54 16 74 54" class="art-path"/>' +
    // Same ↺ as ◀ / KICKFLIP.
    '<path d="M80 25A6 6 0 1 0 74 19" class="art-spin"/><path d="M71.9 17 74 19.5l2.3-2.2" class="art-spin"/>',
  "0 0 160 80"
);
