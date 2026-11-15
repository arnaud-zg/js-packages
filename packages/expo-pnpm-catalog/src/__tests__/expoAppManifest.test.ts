import { Builder } from "builder-pattern";
import { describe, expect, it } from "vitest";

import type { PackageJson } from "../catalogUtils";
import { ExpoAppManifest } from "../expoAppManifest";
import { aPackageJson } from "./builders";

function manifestOf(data: PackageJson): ExpoAppManifest {
  return ExpoAppManifest.fromText({ text: JSON.stringify(data, null, 2) + "\n" });
}

describe("reading the expo app package.json", () => {
  describe("given the expo app declares catalog dependencies", () => {
    it("when read, then only catalog-referenced packages are tracked for sync", () => {
      const manifest = manifestOf(
        aPackageJson()
          .dependencies({ "expo-camera": "catalog:expo", "some-lib": "catalog:", expo: "~53.0.0" })
          .build(),
      );

      expect(manifest.catalogPackages()).toEqual(new Set(["expo-camera", "some-lib"]));
    });

    it("when a catalog dep is in devDependencies, then it is also tracked for sync", () => {
      const manifest = manifestOf(
        aPackageJson()
          .dependencies({})
          .devDependencies({ "expo-build-properties": "catalog:expo" })
          .build(),
      );

      expect(manifest.catalogPackages()).toContain("expo-build-properties");
    });

    it("when a dep uses the root catalog, then it is also tracked for sync", () => {
      const manifest = manifestOf(
        aPackageJson().dependencies({}).devDependencies({ "some-lib": "catalog:" }).build(),
      );

      expect(manifest.catalogPackages()).toContain("some-lib");
    });
  });

  describe("given some packages are excluded from expo install", () => {
    it("when read, then excluded packages are not synced", () => {
      const manifest = manifestOf(
        Builder<PackageJson>({ expo: { install: { exclude: ["react", "react-native"] } } }).build(),
      );

      expect(manifest.excludedPackages()).toEqual(new Set(["react", "react-native"]));
    });
  });

  describe("given resolved versions replace the catalog references", () => {
    it("when turned into text, then expo tooling sees concrete versions and other fields", () => {
      const text = manifestOf(aPackageJson().build())
        .withDeps({ dependencies: { "expo-camera": "~17.0.10" }, devDependencies: {} })
        .toText();

      expect(JSON.parse(text)).toEqual({
        name: "@/app",
        dependencies: { "expo-camera": "~17.0.10" },
        devDependencies: {},
      });
    });
  });

  describe("given a package.json in the two-space format npm writes", () => {
    it("when read and turned back into text, then the text is identical", () => {
      const text = JSON.stringify(aPackageJson().build(), null, 2) + "\n";

      expect(ExpoAppManifest.fromText({ text }).toText()).toBe(text);
    });
  });

  describe("given dependencies is not a map of versions", () => {
    it("when read, then it throws an error naming the file", () => {
      expect(() =>
        ExpoAppManifest.fromText({ text: '{"dependencies": 5}', source: "/repo/package.json" }),
      ).toThrow(/\/repo\/package\.json is malformed/);
    });
  });
});
