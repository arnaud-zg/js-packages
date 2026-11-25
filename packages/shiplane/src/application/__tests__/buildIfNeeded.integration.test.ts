import { describe, expect, it } from "vitest";

import { branchRelease } from "../branchRelease";
import { planShips } from "../planShips";
import { shipTo } from "../ship";
import { branchWorld, lib, manifest } from "./releaseBranchWorld";

const PUBLISH = "echo publish @acme/lib 1.2.0";

const FIELDS = {
  name: "@acme/lib",
  version: "1.2.0",
  main: "./dist/index.js",
  scripts: { build: "tsc" },
};

const FRESH = {
  "packages/lib/package.json": manifest(FIELDS),
  "packages/lib/src/index.ts": "",
  "packages/lib/dist/index.js": "",
};

/** lib, tagged and not published yet, about to ship from this machine. */
const world = (files: Record<string, string> = FRESH) => {
  const made = branchWorld({ units: [lib], files });
  made.source.seed({
    tags: { "lib@1.2.0": "abc" },
    ignored: ["packages/lib/dist/index.js", "packages/core/dist/index.js"],
  });
  const commands = () =>
    made.shell.calls
      .filter(({ command }) => command === "npm" || command === "sh" || command === "echo")
      .map(({ command, args }) => [command, ...args].join(" "));
  return { ...made, commands, ship: () => shipTo(made.context, "staging", { via: "local" }) };
};

describe("Feature: building a package right before it publishes, only when needed", () => {
  it("given a build newer than its sources, when shipped, then it publishes without building", async () => {
    const { ship, commands, output } = world();

    expect(await ship()).toBe(true);
    expect(commands()).toEqual([PUBLISH]);
    expect(output.text).toContain("packages/lib: build up to date");
  });

  it("given no build yet, when shipped, then it builds in its folder before publishing", async () => {
    const { ship, commands, shell } = world({ "packages/lib/package.json": manifest(FIELDS) });

    expect(await ship()).toBe(true);
    expect(commands()).toEqual(["npm run build", PUBLISH]);
    expect(shell.calls.find(({ command }) => command === "npm")?.cwd).toBe("/repo/packages/lib");
  });

  it.each(["packages/lib/src/index.ts", "pnpm-workspace.yaml"])(
    "given %s changed after the build, when shipped, then it builds again",
    async (file) => {
      const { ship, commands, files } = world();
      files.write(file, "changed");

      await ship();

      expect(commands()).toEqual(["npm run build", PUBLISH]);
    },
  );

  it("given entries git tracks, when shipped, then it builds: nothing says the build is current", async () => {
    const { ship, commands, source } = world();
    source.seed({ ignored: [] });

    await ship();

    expect(commands()).toEqual(["npm run build", PUBLISH]);
  });

  it("given publishConfig naming the built entry, when it is missing, then it builds", async () => {
    const { ship, commands } = world({
      "packages/lib/package.json": manifest({
        ...FIELDS,
        main: "./src/index.ts",
        publishConfig: { main: "./dist/index.js" },
      }),
      "packages/lib/src/index.ts": "",
    });

    await ship();

    expect(commands()).toEqual(["npm run build", PUBLISH]);
  });

  it("given a build that fails, when shipped, then nothing publishes", async () => {
    const { ship, commands, shell } = world({ "packages/lib/package.json": manifest(FIELDS) });
    shell.seed("npm run build", { status: 1 });

    expect(await ship()).toBe(false);
    expect(commands()).toEqual(["npm run build"]);
  });

  it("given a workspace package it bundles that changed, when shipped, then that one builds first, then it does", async () => {
    const { ship, shell, files, versioning } = world({
      ...FRESH,
      "packages/lib/package.json": manifest({
        ...FIELDS,
        devDependencies: { "@acme/core": "workspace:*" },
      }),
      // Each uses the other: the check still ends.
      "packages/core/package.json": manifest({
        ...FIELDS,
        name: "@acme/core",
        devDependencies: { "@acme/lib": "workspace:*" },
      }),
      "packages/core/src/index.ts": "",
      "packages/core/dist/index.js": "",
    });
    versioning.seed({ folders: { "@acme/core": "packages/core", "@acme/lib": "packages/lib" } });
    files.write("packages/core/src/index.ts", "changed");

    await ship();

    expect(shell.calls.filter(({ command }) => command === "npm").map(({ cwd }) => cwd)).toEqual([
      "/repo/packages/core",
      "/repo/packages/lib",
    ]);
  });

  it("given a prepare in the config, when shipped, then only the prepare runs", async () => {
    const { ship, commands, context } = world({ "packages/lib/package.json": manifest(FIELDS) });
    context.release.prepare = "make {unit}";

    await ship();

    expect(commands()).toEqual(["sh -c make lib", PUBLISH]);
  });

  it("given a test release, when its version is written, then it builds at that version before publishing", async () => {
    const { context, commands } = world();

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(commands()).toEqual(["npm run build", "echo publish @acme/lib 1.3.0-beta.0"]);
  });

  it("given a dry run, when planned, then the build is shown and nothing runs", async () => {
    const { context, commands, output } = world();

    await planShips(context, "staging");

    expect(output.text).toContain("npm run build  (in packages/lib, if needed)");
    expect(commands()).toEqual([]);
  });
});
