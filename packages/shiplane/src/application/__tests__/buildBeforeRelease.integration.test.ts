import { describe, expect, it } from "vitest";

import { releaseToEntry } from "../releaseToEntry";
import { branchWorld, kit, lib, manifest } from "./releaseBranchWorld";

const built = (name: string, fields: Record<string, unknown> = {}) =>
  manifest({
    name,
    version: "1.2.0",
    main: "./dist/index.js",
    scripts: { build: "tsc" },
    ...fields,
  });

const FILES = {
  "packages/lib/package.json": built("@acme/lib"),
  "packages/kit/package.json": built("@acme/ui-kit"),
};

const CHANGESETS = [
  { id: "a", text: '---\n"@acme/lib": minor\n"@acme/ui-kit": minor\n---\n\nFaster.\n' },
];

/** lib and kit, on main, each with a build script. */
const world = ({
  files = FILES,
  pending = true,
}: { files?: Record<string, string>; pending?: boolean } = {}) => {
  const made = branchWorld({
    units: [lib, kit],
    files,
    pending: [
      { name: "@acme/lib", newVersion: "1.3.0" },
      { name: "@acme/ui-kit", newVersion: "0.5.0" },
    ],
    interactive: true,
    yes: true,
  });
  made.source.seed({
    position: { branch: "main", head: "head", originMain: "head" },
    tags: { "lib@1.2.0": "abc", "ui-kit@0.4.0": "def", "kit@0.4.0": "def" },
  });
  made.versioning.seed({ pending: pending ? CHANGESETS : [] });
  made.host.seed({ prStates: { 1800: ["CLOSED"] } });
  made.context.release.via = "local";
  const commands = () =>
    made.shell.calls
      .filter(({ command }) => ["npm", "sh", "echo"].includes(command))
      .map(
        ({ command, args, cwd }) =>
          `${cwd?.replace("/repo", "") ?? ""}$ ${[command, ...args].join(" ")}`,
      );
  const builds = () => commands().filter((command) => !command.includes("echo"));
  const published = () => commands().filter((command) => command.includes("echo publish"));
  return { ...made, commands, builds, published, release: () => releaseToEntry(made.context) };
};

const wroteNothing = ({ source, host, published }: ReturnType<typeof world>) => {
  expect(source.received).toEqual([]);
  expect(host.received).toEqual([]);
  expect(published()).toEqual([]);
};

describe("Feature: every picked unit builds before a release writes anything", () => {
  it("given a build that fails, when releasing, then it shows why and nothing is written", async () => {
    const made = world();
    made.shell.seed("npm run build", { status: 2, stdout: "src/index.ts: type error" });

    expect(await made.release()).toBe(false);

    wroteNothing(made);
    expect(made.builds()).toEqual(["/packages/lib$ npm run build"]);
    expect(made.output.text).toContain(
      "build lib failed: npm run build in packages/lib exited with 2",
    );
    expect(made.output.text).toContain("│ src/index.ts: type error");
    expect(made.output.text).toContain("Nothing was written: no release PR, tag or publish.");
  });

  it("given builds that pass, when releasing, then the release PR opens after them", async () => {
    const made = world();

    await made.release();

    expect(made.builds().slice(0, 2)).toEqual([
      "/packages/lib$ npm run build",
      "/packages/kit$ npm run build",
    ]);
    expect(made.output.text).toContain("✓ 2 units built");
    expect(made.host.received.some(({ type }) => type === "pr")).toBe(true);
  });

  it("given lib using kit, both picked, when releasing, then each builds once, kit first", async () => {
    const made = world({
      files: {
        ...FILES,
        "packages/lib/package.json": built("@acme/lib", {
          dependencies: { "@acme/ui-kit": "workspace:*" },
        }),
      },
    });
    made.versioning.seed({
      folders: { "@acme/ui-kit": "packages/kit", "@acme/lib": "packages/lib" },
    });
    await made.release();

    expect(made.builds().slice(0, 2)).toEqual([
      "/packages/kit$ npm run build",
      "/packages/lib$ npm run build",
    ]);
    expect(made.builds().filter((command) => command.includes("kit"))).toHaveLength(1);
  });

  it("given a build that looks current, when releasing, then it builds all the same", async () => {
    const made = world({
      files: { ...FILES, "packages/lib/src/index.ts": "", "packages/lib/dist/index.js": "" },
    });
    made.source.seed({ ignored: ["packages/lib/dist/index.js"] });
    made.shell.seed("npm run build", { status: 1 });

    expect(await made.release()).toBe(false);
  });

  it("given only tagged versions to ship, when releasing, then each builds once for the whole release", async () => {
    const made = world({ pending: false });

    expect(await made.release()).toBe(true);

    expect(made.builds()).toHaveLength(2);
    expect(made.published()).toHaveLength(2);
  });

  it("given a release PR merged on the way, when shipping, then each builds again: its version moved", async () => {
    const made = world();
    made.host.seed({ prStates: { 1800: ["MERGED"], 1801: ["MERGED"] } });

    expect(await made.release()).toBe(true);

    expect(made.builds()).toHaveLength(4);
    expect(made.published()).toHaveLength(2);
  });

  it("given a prepare and two units, when releasing, then all prepare first, and each again right before it publishes", async () => {
    const made = world({ pending: false });
    made.context.release.prepare = "make {unit}";

    expect(await made.release()).toBe(true);

    expect(made.commands().map((command) => command.split("$ ")[1])).toEqual([
      "sh -c make lib",
      "sh -c make kit",
      "sh -c make lib",
      "echo publish @acme/lib 1.2.0",
      "sh -c make kit",
      "echo publish @acme/ui-kit 0.4.0",
    ]);
  });

  it("given a prepare and one unit, when releasing, then it prepares once", async () => {
    const made = world({ pending: false });
    made.context.release.prepare = "make {unit}";
    made.context.release.units = [lib];

    expect(await made.release()).toBe(true);

    expect(made.builds()).toEqual(["$ sh -c make lib"]);
  });

  it("given a prepare that fails, when releasing, then nothing is written", async () => {
    const made = world();
    made.context.release.prepare = "make {unit}";
    made.shell.seed("sh -c make kit", { status: 1 });

    expect(await made.release()).toBe(false);

    wroteNothing(made);
  });

  it("given a unit with nothing to build, when releasing, then nothing is said about a build", async () => {
    const made = world({ files: {}, pending: false });

    await made.release();

    expect(made.output.text).not.toContain("built");
    expect(made.builds()).toEqual([]);
  });

  it("given uncommitted changes, when releasing, then it stops before building", async () => {
    const made = world();
    made.source.seed({ clean: false });

    expect(await made.release()).toBe(false);

    expect(made.output.text).toContain("Uncommitted changes");
    expect(made.builds()).toEqual([]);
  });

  it("given a build that changes tracked files, when releasing, then it says so and nothing is written", async () => {
    const made = world();
    made.source.isClean = () => Promise.resolve(made.builds().length === 0);

    expect(await made.release()).toBe(false);

    expect(made.output.text).toContain("The build changed files your repository tracks");
    wroteNothing(made);
  });
});
