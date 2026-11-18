import { defineLibraryConfig } from "@arnaud-zg/configs/tsdown";

// package.json keeps its exports by hand: the config API, the plugin API and the testing kit.
export default defineLibraryConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    plugin: "src/plugin.ts",
    memory: "src/memory.ts",
    testing: "src/testing/public.ts",
  },
  // The testing kit runs inside its importer's vitest.
  deps: { neverBundle: ["vitest"] },
  exports: false,
  // Declaration maps point at the shipped src: Cmd/Ctrl-click on testReleases or channels in a
  // config opens their source and its documentation, not a generated .d.ts.
  dts: { sourcemap: true },
});
