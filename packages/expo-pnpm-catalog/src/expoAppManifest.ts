/**
 * Represents the Expo app's package.json — provides resolved copies for tools
 * that cannot understand catalog: references (expo-doctor, expo install --fix),
 * and always restores the original file.
 */
import type { PackageJson } from "./schemas";
import { isCatalogRef } from "./catalogUtils";
import { PackageJsonSchema, parseOrThrow } from "./schemas";

export type { PackageJson };

export type ManifestText = {
  text: string;
  /** Names the file in a parse error. */
  source?: string;
};

export type ManifestDeps = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export class ExpoAppManifest {
  private constructor(readonly data: PackageJson) {}

  static fromText({ text, source = "package.json" }: ManifestText): ExpoAppManifest {
    return new ExpoAppManifest(
      parseOrThrow({ schema: PackageJsonSchema, value: JSON.parse(text), source }),
    );
  }

  toText(): string {
    return JSON.stringify(this.data, null, 2) + "\n";
  }

  withDeps({ dependencies, devDependencies }: ManifestDeps): ExpoAppManifest {
    return new ExpoAppManifest({ ...this.data, dependencies, devDependencies });
  }

  excludedPackages(): Set<string> {
    return new Set(this.data.expo?.install?.exclude ?? []);
  }

  catalogPackages(): Set<string> {
    const allDeps = { ...this.data.dependencies, ...this.data.devDependencies };
    return new Set(
      Object.entries(allDeps)
        .filter(([, version]) => isCatalogRef(version))
        .map(([name]) => name),
    );
  }
}
