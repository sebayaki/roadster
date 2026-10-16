#!/usr/bin/env node
/**
 * Regenerates the social and icon images in public/ from the game's own 3D
 * scenes (needs `npm run dev` running and a local Chrome):
 *   og.jpg               1200×630 link preview (dev/og.html)
 *   apple-touch-icon.png 180×180 home-screen icon (dev/icon.html, square; iOS rounds it)
 *   icon-192.png         192×192 icon for Android / large favicon slots
 *   favicon.ico          16, 32 and 48 px with rounded corners
 *
 * Usage: node scripts/social-assets.mjs [--base=http://localhost:5173]
 * Override the Chrome binary with CHROME_PATH.
 */
import { writeFileSync } from "node:fs";
import { launchChrome, waitForSnapReady } from "./chrome.mjs";

const base =
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ??
  "http://localhost:5173";

/** Loads a dev scene, waits for its first frames, and returns a screenshot. */
async function capture(page, path, width, height, options) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await waitForSnapReady(page);
  await new Promise((r) => setTimeout(r, 600));
  return page.screenshot(options);
}

/**
 * Scales a square PNG down in the browser by repeated halving (sharper than one
 * big jump), optionally clipping rounded corners. Returns PNG buffers by size.
 */
async function downscale(page, png, targets) {
  const urls = await page.evaluate(
    async (src, targets) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const draw = (source, size, rounded) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const g = canvas.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        if (rounded) {
          g.beginPath();
          g.roundRect(0, 0, size, size, size * 0.22);
          g.clip();
        }
        g.drawImage(source, 0, 0, size, size);
        return canvas;
      };
      const levels = [[img.width, img]];
      for (let s = img.width / 2; s >= 16; s /= 2) {
        levels.push([s, draw(levels[levels.length - 1][1], s, false)]);
      }
      const out = {};
      for (const { size, rounded } of targets) {
        const [, source] = levels
          .filter(([s]) => s >= size)
          .reduce((a, b) => (b[0] < a[0] ? b : a));
        out[size] = draw(source, size, rounded).toDataURL("image/png");
      }
      return out;
    },
    `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    targets
  );
  return Object.fromEntries(
    Object.entries(urls).map(([size, url]) => [
      size,
      Buffer.from(url.split(",")[1], "base64"),
    ])
  );
}

/** Packs PNG images into one .ico (PNG-compressed entries, supported by all current browsers). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const browser = await launchChrome();

try {
  const page = await browser.newPage();
  page.on("pageerror", (err) => {
    throw err;
  });

  await capture(page, "/dev/og.html?t=10&freeze=1", 1200, 630, {
    path: "public/og.jpg",
    type: "jpeg",
    quality: 90,
  });
  console.log("wrote public/og.jpg");

  const icon = await capture(page, "/dev/icon.html?freeze=1", 1024, 1024, {
    type: "png",
  });
  const square = await downscale(page, icon, [
    { size: 192, rounded: false },
    { size: 180, rounded: false },
  ]);
  const rounded = await downscale(page, icon, [
    { size: 48, rounded: true },
    { size: 32, rounded: true },
    { size: 16, rounded: true },
  ]);
  writeFileSync("public/icon-192.png", square[192]);
  writeFileSync("public/apple-touch-icon.png", square[180]);
  writeFileSync(
    "public/favicon.ico",
    ico([16, 32, 48].map((size) => ({ size, png: rounded[size] })))
  );
  console.log("wrote public/icon-192.png, apple-touch-icon.png, favicon.ico");
} finally {
  await browser.close();
}
