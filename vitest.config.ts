import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/** The app's Vite config (the `@/` alias) plus the test settings. */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/tests/**/*.test.ts"],
    },
  })
);
