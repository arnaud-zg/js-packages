import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import type { AnyDeliveryAdapter } from "../modules/suggest";
import { shellServerHosting } from "../adapters/server-hosting/shell-server-hosting.adapter";
import { isRecord } from "../application/config/values";
import { PackageJsonSchema } from "../application/manifest";

/** A plugin's own word on what init may offer: `"shiplane": { "adapters": ["flyServerHosting"] }`. */
const PluginManifestSchema = z.object({
  shiplane: z.object({ adapters: z.array(z.string()).optional() }).optional(),
});

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * The delivery adapters init can offer: the built-in shell adapter, then each one a plugin this
 * repository depends on names in its package.json. A plugin that does not load is skipped.
 */
export const installedAdapters = async (root: string): Promise<AnyDeliveryAdapter[]> => {
  const manifestFile = path.join(root, "package.json");
  if (!fs.existsSync(manifestFile)) return [shellServerHosting()];
  const manifest = PackageJsonSchema.safeParse(readJson(manifestFile)).data;
  const names = Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies });
  const require = createRequire(manifestFile);
  const found = await Promise.all(
    names.map(async (name): Promise<AnyDeliveryAdapter[]> => {
      try {
        const own = PluginManifestSchema.safeParse(
          readJson(require.resolve(`${name}/package.json`)),
        );
        const factories = own.data?.shiplane?.adapters ?? [];
        if (factories.length === 0) return [];
        const loaded: unknown = await import(pathToFileURL(require.resolve(name)).href);
        if (!isRecord(loaded)) return [];
        return factories.flatMap((factory) => {
          const make = loaded[factory];
          return typeof make === "function" ? [make() as AnyDeliveryAdapter] : [];
        });
      } catch {
        return [];
      }
    }),
  );
  return [...found.flat(), shellServerHosting()];
};
