import readline from "readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FakeWorkspace } from "./fakeWorkspace";
import { runSync } from "../sync";
import { APP_PACKAGE_JSON, createFakeWorkspace, WORKSPACE_YAML } from "./fakeWorkspace";

let workspace: FakeWorkspace;
let prompts: string[];

/** The person's answer to the "Apply …?" prompt; readline is Node's, not ours. */
function answerPrompt(answer: string): void {
  vi.spyOn(readline, "createInterface").mockReturnValue({
    question: (query: string, callback: (input: string) => void) => {
      prompts.push(query);
      callback(answer);
    },
    close: () => undefined,
  } as unknown as readline.Interface);
}

const SDK_BUMP = {
  "expo-camera": "~17.0.12",
  "@expo/vector-icons": "^15.0.4",
  "react-native-safe-area-context": "~5.6.2",
};

const SYNCED_YAML = `packages:
  - apps/*
  - packages/*
catalog:
  some-lib: ^3.0.0
catalogs:
  expo:
    # pinned by the Expo SDK
    expo-camera: "~17.0.12"
    "@expo/vector-icons": "^15.0.4"
    react-native-safe-area-context: "~5.6.2"
`;

beforeEach(() => {
  workspace = createFakeWorkspace();
  prompts = [];
  answerPrompt("n");
});

afterEach(() => {
  workspace.cleanup();
});

describe("syncing the catalogs with the Expo SDK", () => {
  it("given expo install --fix bumps app and sibling packages, when synced with --yes, then the catalogs take the new versions and keep their comments", async () => {
    workspace.expoFixes(SDK_BUMP);

    await runSync(workspace.paths, { dryRun: false, yes: true });

    expect(workspace.readWorkspaceYaml()).toBe(SYNCED_YAML);
    expect(prompts).toEqual([]);
  });

  it("given an applied sync, when it finishes, then expo ran in the app on concrete versions, pnpm install ran at the root and the app's package.json is back as it was", async () => {
    workspace.expoFixes(SDK_BUMP);
    const before = workspace.readAppPackageJson();

    await runSync(workspace.paths, { dryRun: false, yes: true });

    expect(workspace.calls()).toEqual([
      {
        command: "npx expo install --fix",
        cwd: workspace.appDir,
        appVariant: "development",
        packageJson: {
          ...APP_PACKAGE_JSON,
          dependencies: {
            "expo-camera": "~17.0.10",
            react: "19.2.0-rc.1-x",
            ghost: "catalog:nope",
            "some-lib": "^3.0.0",
            "react-native-safe-area-context": "~5.6.0",
          },
          devDependencies: { "@expo/vector-icons": "^15.0.3" },
        },
      },
      { command: "pnpm install", cwd: workspace.rootDir },
    ]);
    expect(workspace.readAppPackageJson()).toBe(before);
  });

  it("given an applied sync, when it finishes, then the report lists each change and ends with done", async () => {
    workspace.expoFixes(SDK_BUMP);

    await runSync(workspace.paths, { dryRun: false, yes: true });

    expect(workspace.output).toMatchInlineSnapshot(`
      [
        "",
        "  Expo catalog sync",
        "",
        "  Scanning 5 catalog packages across workspace...",
        "  Including 2 packages from other workspace packages",
        "",
        "────────────────────────────────────────────────────────────",
        "────────────────────────────────────────────────────────────",
        "",
        "  Package                         From        To",
        "  ──────────────────────────────────────────────────────────",
        "  expo-camera                     ~17.0.10    →  ~17.0.12",
        "  @expo/vector-icons              ^15.0.3     →  ^15.0.4",
        "  react-native-safe-area-context  ~5.6.0      →  ~5.6.2",
        "",
        "",
        "────────────────────────────────────────────────────────────",
        "────────────────────────────────────────────────────────────",
        "",
        "  ✓ Done — catalog and lockfile are in sync.",
        "",
      ]
    `);
    expect(workspace.spinners).toEqual([
      "- Running expo install --fix...",
      "- Updating pnpm-workspace.yaml...",
      "✔ pnpm-workspace.yaml updated",
    ]);
  });

  it("given a dry run, when synced, then the pending updates are shown and nothing is written or installed", async () => {
    workspace.expoFixes(SDK_BUMP);

    await runSync(workspace.paths, { dryRun: true, yes: false });

    expect(workspace.readWorkspaceYaml()).toBe(WORKSPACE_YAML);
    expect(workspace.calls().map(({ command }) => command)).toEqual(["npx expo install --fix"]);
    expect(prompts).toEqual([]);
    expect(workspace.output).toMatchInlineSnapshot(`
      [
        "",
        "  Expo catalog sync  [dry run]",
        "",
        "  Scanning 5 catalog packages across workspace...",
        "  Including 2 packages from other workspace packages",
        "",
        "────────────────────────────────────────────────────────────",
        "────────────────────────────────────────────────────────────",
        "",
        "  Package                         From        To",
        "  ──────────────────────────────────────────────────────────",
        "  expo-camera                     ~17.0.10    →  ~17.0.12",
        "  @expo/vector-icons              ^15.0.3     →  ^15.0.4",
        "  react-native-safe-area-context  ~5.6.0      →  ~5.6.2",
        "",
        "  3 updates pending — dry run, nothing written",
        "",
      ]
    `);
  });

  it("given a single change, when previewed, then the summary reads '1 update'", async () => {
    workspace.expoFixes({ "expo-camera": "~17.0.12" });

    await runSync(workspace.paths, { dryRun: true, yes: false });

    expect(workspace.output.slice(-2)).toEqual([
      "  1 update pending — dry run, nothing written",
      "",
    ]);
  });

  it("given expo install --fix changes nothing, when synced, then the catalogs are reported in sync and pnpm install does not run", async () => {
    await runSync(workspace.paths, { dryRun: false, yes: true });

    expect(workspace.readWorkspaceYaml()).toBe(WORKSPACE_YAML);
    expect(workspace.calls().map(({ command }) => command)).toEqual(["npx expo install --fix"]);
    expect(workspace.output.slice(-3)).toEqual([
      "",
      "  ✓ catalogs are already in sync with the Expo SDK.",
      "",
    ]);
  });

  it("given a package the app excludes from expo install, when expo changes it, then its catalog version stays", async () => {
    workspace.cleanup();
    workspace = createFakeWorkspace({
      appPackageJson: { ...APP_PACKAGE_JSON, expo: { install: { exclude: ["expo-camera"] } } },
    });
    workspace.expoFixes({ "expo-camera": "~17.0.12", "@expo/vector-icons": "^15.0.4" });

    await runSync(workspace.paths, { dryRun: false, yes: true });

    expect(workspace.readWorkspaceYaml()).toContain("expo-camera: ~17.0.10");
    expect(workspace.readWorkspaceYaml()).toContain('"@expo/vector-icons": "^15.0.4"');
  });

  it("given an app with no sibling packages, when previewed, then the scan counts only the app's catalog packages", async () => {
    workspace.cleanup();
    workspace = createFakeWorkspace({ siblings: {} });

    await runSync(workspace.paths, { dryRun: true, yes: false });

    expect(workspace.output.slice(0, 6)).toEqual([
      "",
      "  Expo catalog sync  [dry run]",
      "",
      "  Scanning 3 catalog packages across workspace...",
      "",
      "────────────────────────────────────────────────────────────",
    ]);
  });

  it("given expo install --fix removes a package, when synced, then its catalog version stays", async () => {
    workspace.expoFixes({ "expo-camera": null });

    await runSync(workspace.paths, { dryRun: false, yes: true });

    expect(workspace.readWorkspaceYaml()).toBe(WORKSPACE_YAML);
  });
});

describe("confirming a sync before it is applied", () => {
  beforeEach(() => {
    workspace.expoFixes(SDK_BUMP);
  });

  it.each(["", "y", "yes", " Y ", "YES"])(
    "given the answer %j, when asked to apply, then the catalogs are updated",
    async (answer) => {
      answerPrompt(answer);

      await runSync(workspace.paths, { dryRun: false, yes: false });

      expect(prompts).toEqual(["  Apply 3 updates to pnpm-workspace.yaml? [Y/n] "]);
      expect(workspace.readWorkspaceYaml()).toBe(SYNCED_YAML);
    },
  );

  it.each(["n", "no", "nope"])(
    "given the answer %j, when asked to apply, then the sync aborts and nothing is written",
    async (answer) => {
      answerPrompt(answer);

      await runSync(workspace.paths, { dryRun: false, yes: false });

      expect(workspace.readWorkspaceYaml()).toBe(WORKSPACE_YAML);
      expect(workspace.calls().map(({ command }) => command)).toEqual(["npx expo install --fix"]);
      expect(workspace.output.slice(-3)).toEqual(["", "  Aborted.", ""]);
    },
  );

  it("given a single change, when asked to apply, then the prompt reads '1 update'", async () => {
    workspace.expoFixes({ "expo-camera": "~17.0.12" });

    await runSync(workspace.paths, { dryRun: false, yes: false });

    expect(prompts).toEqual(["  Apply 1 update to pnpm-workspace.yaml? [Y/n] "]);
  });
});
