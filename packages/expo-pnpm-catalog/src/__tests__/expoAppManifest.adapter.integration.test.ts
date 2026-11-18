import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PackageJson } from "../catalogUtils";
import { createExpoAppManifestFile } from "../expoAppManifest.adapter";
import { PackageJsonSchema } from "../schemas";
import { aPackageJson } from "./builders";

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-manifest-test-"));
  filePath = path.join(tmpDir, "package.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(data: PackageJson): string {
  const content = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(filePath, content);
  return content;
}

const resolvedDeps = { dependencies: { "expo-camera": "~17.0.10" }, devDependencies: {} };

describe("swapping the expo app package.json on disk", () => {
  describe("given the expo app manifest is loaded", () => {
    it("when written with resolved versions, then expo tooling sees concrete versions", () => {
      writeManifest(aPackageJson().build());
      const file = createExpoAppManifestFile(filePath);

      file.write(file.load().withDeps(resolvedDeps));

      const written = PackageJsonSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
      expect(written.dependencies?.["expo-camera"]).toBe("~17.0.10");
    });

    it("when restored after being written, then the original catalog references are back", () => {
      const original = writeManifest(aPackageJson().build());
      const file = createExpoAppManifestFile(filePath);

      file.write(file.load().withDeps(resolvedDeps));
      file.restore();

      expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    it("when expo tooling updates the file externally, then the new versions load and restore still puts back the original", () => {
      const original = writeManifest(aPackageJson().build());
      const file = createExpoAppManifestFile(filePath);
      file.load();

      writeManifest(aPackageJson().dependencies({ "expo-camera": "~17.0.10" }).build());

      expect(file.load().data.dependencies?.["expo-camera"]).toBe("~17.0.10");
      file.restore();
      expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });
  });

  describe("given the expo app manifest was never loaded", () => {
    it("when restored, then the file on disk is left as it is", () => {
      const original = writeManifest(aPackageJson().build());
      const file = createExpoAppManifestFile(filePath);

      file.restore();

      expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });
  });
});
