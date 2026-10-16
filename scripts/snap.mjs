#!/usr/bin/env node
/**
 * Headless screenshot tool for checking renders without a visible browser.
 *
 * Usage:
 *   node scripts/snap.mjs <url> <out.png> [--size=1280x720] [--wait=1000]
 *        [--eval="<async js run in the page before the shot>"] [--timeout=30000]
 *
 * The page may set `window.__snapReady = true` once its first frame is ready;
 * the tool waits for that flag (up to --timeout) before running --eval and --wait.
 * Console output and page errors are printed so runtime failures are visible.
 * Requires a local Chrome (override the path with CHROME_PATH).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const i = a.indexOf("=");
      return i === -1 ? [a.slice(2), "true"] : [a.slice(2, i), a.slice(i + 1)];
    })
);

const [url, out] = positional;
if (!url || !out) {
  console.error(
    'usage: node scripts/snap.mjs <url> <out.png> [--size=WxH] [--wait=ms] [--eval="js"] [--timeout=ms]'
  );
  process.exit(2);
}

const [width, height] = (flags.size ?? "1280x720").split("x").map(Number);
const wait = Number(flags.wait ?? 1000);
const timeout = Number(flags.timeout ?? 30000);
const executablePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    `--window-size=${width},${height}`,
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--use-angle=metal",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("console", (msg) =>
    console.log(`[console.${msg.type()}] ${msg.text()}`)
  );
  page.on("pageerror", (err) => {
    failed = true;
    console.log(`[pageerror] ${err.stack ?? err.message}`);
  });
  page.on("requestfailed", (req) =>
    console.log(
      `[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ""}`
    )
  );

  await page.goto(url, { waitUntil: "load", timeout });
  await page
    .waitForFunction("window.__snapReady === true", { timeout })
    .catch(() => console.log("[snap] window.__snapReady not set; continuing"));

  if (flags.eval) {
    const result = await page.evaluate(`(async () => { ${flags.eval} })()`);
    if (result !== undefined) console.log("[eval]", JSON.stringify(result));
  }
  await new Promise((r) => setTimeout(r, wait));

  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`[snap] saved ${out}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
