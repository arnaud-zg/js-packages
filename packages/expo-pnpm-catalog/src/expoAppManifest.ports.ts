import type { ExpoAppManifest } from "./expoAppManifest";

export type ExpoAppManifestFile = {
  /** The first load remembers the text that `restore()` puts back. */
  load(): ExpoAppManifest;
  write(manifest: ExpoAppManifest): void;
  restore(): void;
};
