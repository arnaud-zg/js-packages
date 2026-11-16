import fs from "fs";

import type { ExpoAppManifestFile } from "./expoAppManifest.ports";
import { ExpoAppManifest } from "./expoAppManifest";

export function createExpoAppManifestFile(filePath: string): ExpoAppManifestFile {
  let original: string | undefined;
  return {
    load: () => {
      const text = fs.readFileSync(filePath, "utf-8");
      original ??= text;
      return ExpoAppManifest.fromText({ text, source: filePath });
    },
    write: (manifest) => fs.writeFileSync(filePath, manifest.toText()),
    restore: () => {
      if (original !== undefined) fs.writeFileSync(filePath, original);
    },
  };
}
