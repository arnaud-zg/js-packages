import fs from "fs";
import os from "os";
import path from "path";
import { dump } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCheck } from "../check";
import { aPackageJson, aWorkspaceYaml } from "./builders";

let rootDir: string;
let appDir: string;
let packageJsonPath: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-pnpm-catalog-check-test-"));
  appDir = path.join(rootDir, "apps", "expo");
  packageJsonPath = path.join(appDir, "package.json");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, "pnpm-workspace.yaml"), dump(aWorkspaceYaml().build()));
  fs.writeFileSync(packageJsonPath, JSON.stringify(aPackageJson().build(), null, 2) + "\n");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.chmodSync(packageJsonPath, 0o644);
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("checking the expo app against expo-doctor", () => {
  describe("given the expo app's package.json cannot be written", () => {
    it("when checked, then the write error surfaces instead of an expo-doctor failure", () => {
      fs.chmodSync(packageJsonPath, 0o444);
      const paths = {
        rootDir,
        appDir,
        workspaceYamlPath: path.join(rootDir, "pnpm-workspace.yaml"),
        packageJsonPath,
      };

      expect(() => runCheck(paths, { dryRun: false })).toThrow(/EACCES|EPERM/);
    });
  });
});
