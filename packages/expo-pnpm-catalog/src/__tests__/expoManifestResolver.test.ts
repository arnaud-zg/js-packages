import { dump } from "js-yaml";
import { describe, expect, it } from "vitest";

import { CatalogWorkspace } from "../catalogWorkspace";
import { ExpoAppManifest } from "../expoAppManifest";
import { ExpoManifestResolver } from "../expoManifestResolver";
import { aPackageJson, aWorkspaceYaml } from "./builders";

function aWorkspace(): CatalogWorkspace {
  return CatalogWorkspace.fromText({ text: dump(aWorkspaceYaml().build()) });
}

function aManifest(
  deps: Record<string, string>,
  devDeps: Record<string, string> = {},
): ExpoAppManifest {
  const data = aPackageJson().dependencies(deps).devDependencies(devDeps).build();
  return ExpoAppManifest.fromText({ text: JSON.stringify(data, null, 2) + "\n" });
}

describe("preparing the manifest for expo tooling", () => {
  describe("given the expo app has catalog dependencies", () => {
    it("when resolved, then expo tooling sees concrete versions instead of catalog references", () => {
      const resolved = ExpoManifestResolver.from(aManifest({ "expo-camera": "catalog:expo" }))
        .withCatalogResolution(aWorkspace())
        .build();

      expect(resolved.data.dependencies?.["expo-camera"]).toBe("~17.0.10");
    });

    it("when extra workspace packages are included, then their versions are present in the resolved manifest", () => {
      const resolved = ExpoManifestResolver.from(aManifest({}))
        .withCatalogResolution(aWorkspace())
        .mergeExtraPackages({ "expo-crypto": "~15.0.8" })
        .build();

      expect(resolved.data.dependencies?.["expo-crypto"]).toBe("~15.0.8");
    });

    it("when a dep exists in both sources, then the app's own version takes precedence", () => {
      const resolved = ExpoManifestResolver.from(aManifest({ "expo-camera": "catalog:expo" }))
        .withCatalogResolution(aWorkspace())
        .mergeExtraPackages({ "expo-camera": "~99.0.0" })
        .build();

      expect(resolved.data.dependencies?.["expo-camera"]).toBe("~17.0.10");
    });
  });

  describe("given resolution steps are chained", () => {
    it("when resolved, then the source manifest keeps its catalog references", () => {
      const manifest = aManifest({ "expo-camera": "catalog:expo" });
      const originalText = manifest.toText();

      ExpoManifestResolver.from(manifest).withCatalogResolution(aWorkspace()).build();

      expect(manifest.toText()).toBe(originalText);
    });
  });
});
