/**
 * Headless Chrome for the screenshot scripts (puppeteer-core drives a local
 * Chrome: the macOS app by default, any other binary through CHROME_PATH).
 */
import puppeteer from "puppeteer-core";

const executablePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Launches headless Chrome with GPU-backed WebGL (ANGLE on Metal), plus `args`. */
export function launchChrome(args = []) {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--use-angle=metal",
      ...args,
    ],
  });
}

/** Resolves once the page sets `window.__snapReady` (the game and the dev pages do after their first frames). */
export function waitForSnapReady(page, timeout = 30000) {
  return page.waitForFunction("window.__snapReady === true", { timeout });
}
