import { existsSync, readFileSync } from "node:fs";
import type { Package } from "resolve.exports";

export const isPackageManifest = (value: unknown): value is Package =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  value.name !== "";

const parseJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`Malformed package.json at ${path}`, { cause: error });
  }
};

// A missing or nameless package.json is not a workspace package, so the scan skips it.
export const readPackageManifest = (path: string): Package | null => {
  if (!existsSync(path)) {
    return null;
  }
  const manifest = parseJsonFile(path);
  return isPackageManifest(manifest) ? manifest : null;
};
