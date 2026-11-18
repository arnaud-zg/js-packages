import fs from "fs";
import { stripVTControlCharacters } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FakeWorkspace } from "./fakeWorkspace";
import { createFakeWorkspace, WORKSPACE_YAML } from "./fakeWorkspace";

let workspace: FakeWorkspace;
let errors: string[];
const originalCwd = process.cwd();
const originalArgv = process.argv;

/** Runs the CLI as `expo-pnpm-catalog <args>` from `cwd`, a folder of the temp workspace. */
async function runCli(cwd: string, ...args: string[]): Promise<void> {
  process.chdir(cwd);
  process.argv = ["node", "expo-pnpm-catalog", ...args];
  vi.resetModules();
  await import("../cli");
}

beforeEach(() => {
  workspace = createFakeWorkspace();
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(stripVTControlCharacters(args.map(String).join(" ")));
  });
});

afterEach(() => {
  process.chdir(originalCwd);
  process.argv = originalArgv;
  process.exitCode = undefined;
  workspace.cleanup();
});

describe("checking an expo app from the terminal", () => {
  it("given an --app-dir relative to the workspace root, when check --dry-run runs from the root, then the resolved versions are listed, nothing runs and the exit code stays clean", async () => {
    await runCli(workspace.rootDir, "check", "--dry-run", "--app-dir", "apps/expo");

    await vi.waitFor(() =>
      expect(workspace.output).toContain("  [dry run] — nothing was written or run"),
    );
    expect(workspace.output).toContain(
      "  3 from apps/expo · 2 additional from other workspace packages",
    );
    expect(workspace.calls()).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("given expo-doctor reports issues, when check runs inside the app folder, then expo-doctor ran there and the exit code is 1", async () => {
    workspace.doctorExitCode(1);

    await runCli(workspace.appDir, "check");

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(workspace.calls().map(({ command, cwd }) => ({ command, cwd }))).toEqual([
      { command: "npx expo-doctor", cwd: workspace.appDir },
    ]);
    expect(errors).toEqual([]);
  });

  it("given expo-doctor passes, when check runs, then it reports success and the exit code stays clean", async () => {
    await runCli(workspace.appDir, "check");

    await vi.waitFor(() => expect(workspace.output).toContain("  ✓ All checks passed"));
    expect(process.exitCode).toBeUndefined();
  });

  it("given a malformed package.json, when check runs, then the error is reported and the exit code is 1", async () => {
    fs.writeFileSync(workspace.paths.packageJsonPath, "{ not json");

    await runCli(workspace.appDir, "check", "--dry-run");

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(errors[0]).toMatch(/^Unexpected error: SyntaxError/);
  });
});

describe("syncing the catalogs from the terminal", () => {
  beforeEach(() => {
    workspace.expoFixes({ "expo-camera": "~17.0.12" });
  });

  it("given an SDK bump, when sync --yes runs inside the app folder, then the catalog takes the new version without a prompt", async () => {
    await runCli(workspace.appDir, "sync", "--yes");

    await vi.waitFor(() =>
      expect(workspace.output).toContain("  ✓ Done — catalog and lockfile are in sync."),
    );
    expect(workspace.readWorkspaceYaml()).toContain('expo-camera: "~17.0.12"');
    expect(process.exitCode).toBeUndefined();
  });

  it("given an SDK bump, when sync --dry-run runs from the root, then the update is only reported", async () => {
    await runCli(workspace.rootDir, "sync", "--dry-run", "--app-dir", "apps/expo");

    await vi.waitFor(() =>
      expect(workspace.output).toContain("  1 update pending — dry run, nothing written"),
    );
    expect(workspace.readWorkspaceYaml()).toBe(WORKSPACE_YAML);
  });

  it("given a malformed package.json, when sync runs, then the error is reported and the exit code is 1", async () => {
    fs.writeFileSync(workspace.paths.packageJsonPath, "{ not json");

    await runCli(workspace.appDir, "sync", "-y");

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(errors[0]).toMatch(/^Unexpected error: SyntaxError/);
  });
});
