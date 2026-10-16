import path from "node:path";
import { defineConfig } from "vite";

/**
 * GitHub Pages: default `VITE_BASE=./` so assets resolve on project sites.
 * Override with `VITE_BASE=/` for root hosting if needed.
 */
const base = process.env.VITE_BASE ?? "./";

export default defineConfig({
  base,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
