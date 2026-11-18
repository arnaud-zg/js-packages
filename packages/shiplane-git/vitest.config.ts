import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    watch: false,
    setupFiles: ["../../vitest.sandbox.mjs"],
    // Real-folder tests take seconds on CI's 1-CPU runner.
    testTimeout: 20_000,
  },
});
