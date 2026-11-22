import { defineLibraryConfig } from "../../tsdown.library.mjs";

// CommonJS, as tsc built it before: require() keeps working. package.json keeps its exports and bin.
export default defineLibraryConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["cjs"],
  exports: false,
});
