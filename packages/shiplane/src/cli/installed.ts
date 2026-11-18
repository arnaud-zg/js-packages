import fs from "node:fs";
import path from "node:path";

import { PackageJsonSchema } from "../application/manifest";

const CORE = "shiplane";

const manifestAt = (dir: string) => {
  const manifest = path.join(dir, "package.json");
  if (!fs.existsSync(manifest)) return null;
  return PackageJsonSchema.safeParse(JSON.parse(fs.readFileSync(manifest, "utf8"))).data ?? null;
};

/** The shiplane package holding `from`: the nearest folder above it whose package.json is shiplane's. */
export const coreDir = (from: string): string => {
  let dir = from;
  while (manifestAt(dir)?.name !== CORE) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`${CORE} not found above ${from}`);
    dir = parent;
  }
  return dir;
};

/** The version of the shiplane running, from its own package.json. */
export const installedVersion = (from = import.meta.dirname): string | undefined =>
  manifestAt(coreDir(from))?.version;
