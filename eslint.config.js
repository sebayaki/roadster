import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Build output, and local screenshots and tool runs (gitignored).
  globalIgnores(["dist", "snaps"]),
  {
    extends: [js.configs.recommended, tseslint.configs.recommended],
    files: ["**/*.{ts,js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
  }
);
