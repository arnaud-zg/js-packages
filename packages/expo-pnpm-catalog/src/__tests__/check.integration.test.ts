import fs from "fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InterruptGuard } from "../interruptGuard";
import type { FakeWorkspace } from "./fakeWorkspace";
import { runCheck } from "../check";
import {
  APP_PACKAGE_JSON,
  createFakeWorkspace,
  UI_PACKAGE_JSON,
  WORKSPACE_YAML,
} from "./fakeWorkspace";

let workspace: FakeWorkspace;

afterEach(() => {
  workspace.cleanup();
});

describe("previewing which versions a check would hand to expo-doctor", () => {
  it("given an app and a sibling package that share the expo catalog, when previewed with --dry-run, then every resolved version is listed with the package it comes from", () => {
    workspace = createFakeWorkspace();

    const passed = runCheck(workspace.paths, { dryRun: true });

    expect(passed).toBe(true);
    expect(workspace.output).toMatchInlineSnapshot(`
      [
        "",
        "  Expo catalog check — 5 packages  [dry run]",
        "  3 from apps/expo · 2 additional from other workspace packages",
        "    + some-lib (@/ui)",
        "    + react-native-safe-area-context (@/ui)",
        "",
        "  Package                         Version          Source",
        "  ───────────────────────────────────────────────────────────────",
        "  expo-camera                     ~17.0.10         apps/expo",
        "  react                           19.2.0-rc.1-x    apps/expo",
        "  react-native-safe-area-context  ~5.6.0           @/ui",
        "  some-lib                        ^3.0.0           @/ui",
        "",
        "  [dry run] — nothing was written or run",
      ]
    `);
  });

  it("given a dry run, when it finishes, then expo-doctor never ran and the app's package.json is untouched", () => {
    workspace = createFakeWorkspace();
    const before = workspace.readAppPackageJson();

    runCheck(workspace.paths, { dryRun: true });

    expect(workspace.calls()).toEqual([]);
    expect(workspace.readAppPackageJson()).toBe(before);
  });

  it("given the app pins its own version of a package a sibling takes from the catalog, when previewed, then the package is listed once, as coming from the sibling", () => {
    workspace = createFakeWorkspace({
      appPackageJson: { name: "@/app", dependencies: { "some-lib": "2.0.0" } },
    });

    runCheck(workspace.paths, { dryRun: true });

    expect(workspace.output).toContain("    + some-lib (@/ui)");
    expect(workspace.output.filter((line) => /^ {2}some-lib\s/.test(line))).toEqual([
      expect.stringMatching(/^ {2}some-lib\s+2\.0\.0\s+@\/ui$/),
    ]);
  });

  it("given pnpm-workspace.yaml lists a libs folder instead of packages, when previewed, then the packages in libs are included", () => {
    workspace = createFakeWorkspace({
      workspaceYaml: WORKSPACE_YAML.replace("  - packages/*", "  - libs/*"),
      siblings: { "libs/ui": UI_PACKAGE_JSON },
    });

    runCheck(workspace.paths, { dryRun: true });

    expect(workspace.output).toContain("    + some-lib (@/ui)");
  });

  it("given the expo app sits at the workspace root with no sibling packages, when previewed, then no other package is named and every version comes from '.'", () => {
    workspace = createFakeWorkspace({
      appFolder: ".",
      siblings: {},
      appPackageJson: { name: "@/root", dependencies: { "expo-camera": "catalog:expo" } },
    });

    runCheck(workspace.paths, { dryRun: true });

    expect(workspace.output).toMatchInlineSnapshot(`
      [
        "",
        "  Expo catalog check — 1 packages  [dry run]",
        "",
        "  Package               Version       Source",
        "  ──────────────────────────────────────────────────",
        "  expo-camera           ~17.0.10      .",
        "",
        "  [dry run] — nothing was written or run",
      ]
    `);
  });
});

describe("checking the expo app's versions with expo-doctor", () => {
  beforeEach(() => {
    workspace = createFakeWorkspace();
  });

  it("given expo-doctor passes, when the app is checked, then expo-doctor ran in the app folder on concrete versions and the check passes with the app's package.json left as it was", () => {
    const before = workspace.readAppPackageJson();

    const passed = runCheck(workspace.paths, { dryRun: false });

    expect(passed).toBe(true);
    expect(workspace.calls()).toEqual([
      {
        command: "npx expo-doctor",
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
    ]);
    expect(workspace.readAppPackageJson()).toBe(before);
    expect(workspace.output.slice(-3)).toEqual(["", "  ✓ All checks passed", ""]);
    expect(workspace.spinners).toContain("- Starting expo-doctor...");
  });

  it("given expo-doctor reports issues, when the app is checked, then the check fails and points the user to sync", () => {
    workspace.doctorExitCode(1);
    const before = workspace.readAppPackageJson();

    const passed = runCheck(workspace.paths, { dryRun: false });

    expect(passed).toBe(false);
    expect(workspace.readAppPackageJson()).toBe(before);
    expect(workspace.output.slice(-5)).toMatchInlineSnapshot(`
      [
        "────────────────────────────────────────────────────────────",
        "",
        "  ✗ expo-doctor reported issues",
        "  → Run expo-pnpm-catalog sync to fix version drift",
        "",
      ]
    `);
  });

  it("given the check is interrupted after the app's package.json was swapped, when it stops, then the app's catalog references are put back", () => {
    const before = workspace.readAppPackageJson();
    const interruptAfterWork: InterruptGuard = {
      run({ work, onInterrupt }) {
        const result = work();
        fs.writeFileSync(workspace.paths.packageJsonPath, "{}");
        onInterrupt();
        return result;
      },
    };

    runCheck(workspace.paths, { dryRun: false, interrupts: interruptAfterWork });

    expect(workspace.readAppPackageJson()).toBe(before);
  });

  it("given the expo app's package.json is read-only, when the app is checked, then the permission error surfaces and expo-doctor never runs", () => {
    fs.chmodSync(workspace.paths.packageJsonPath, 0o444);

    expect(() => runCheck(workspace.paths, { dryRun: false })).toThrow(/EACCES|EPERM/);
    expect(workspace.calls()).toEqual([]);
    fs.chmodSync(workspace.paths.packageJsonPath, 0o644);
  });
});
