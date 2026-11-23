import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

import type { AnyDeliveryAdapter } from "../modules/suggest";
import type { CatalogEntry } from "../ports/catalog.port";
import { localEntries, localsIn, YAML_CONFIG_FILES } from "../adapters/config/yaml-config.adapter";
import { shellServerHosting } from "../adapters/server-hosting/shell-server-hosting.adapter";
import { isCatalogEntry } from "../application/config/catalog";
import { isRecord } from "../application/config/values";
import { PackageJsonSchema } from "../application/manifest";
import { catalog as ownCatalog } from "../modules/catalog";

/** A plugin's own word on what setup may offer: `"shiplane": { "adapters": ["flyServerHosting"] }`. */
const PluginManifestSchema = z.object({
  shiplane: z.object({ adapters: z.array(z.string()).optional() }).optional(),
});

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * The delivery adapters setup can offer: the built-in shell adapter, then each one a plugin this
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

/** Every plugin this repository publishes, looked for whether or not package.json lists it. */
const FIRST_PARTY = [
  "git",
  "github",
  "changesets",
  "npm",
  "fly",
  "cloudflare-pages",
  "github-pages",
  "eas",
].map((name) => `@shiplane/${name}`);

/**
 * What a shiplane.yml can name in this repository: shiplane's own modules, then the catalog of each
 * first-party plugin installed, then of each dependency whose package.json has a `shiplane` key.
 * A plugin that does not load, or exports no catalog, adds nothing.
 */
export const installedCatalog = async (root: string): Promise<CatalogEntry[]> => {
  const manifestFile = path.join(root, "package.json");
  const manifest = fs.existsSync(manifestFile)
    ? PackageJsonSchema.safeParse(readJson(manifestFile)).data
    : undefined;
  const require = createRequire(manifestFile);
  const declared = Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }).filter(
    (name) => {
      try {
        const own = PluginManifestSchema.safeParse(
          readJson(require.resolve(`${name}/package.json`)),
        );
        return own.data?.shiplane !== undefined;
      } catch {
        return false;
      }
    },
  );
  const names = [...new Set([...FIRST_PARTY, ...declared])];
  const found = await Promise.all(
    names.map(async (name): Promise<CatalogEntry[]> => {
      try {
        const loaded: unknown = await import(pathToFileURL(require.resolve(name)).href);
        const catalog = isRecord(loaded) ? loaded.catalog : undefined;
        return Array.isArray(catalog) ? catalog.filter(isCatalogEntry) : [];
      } catch {
        return [];
      }
    }),
  );
  return [...ownCatalog, ...found.flat()];
};

/** The local files that export a catalog by convention: `shiplane/adapters/*.ts`. */
const LOCAL_FOLDER = "shiplane/adapters";

/**
 * What `shiplane schema` offers: the installed catalog, then every local file shiplane.yml names
 * or `shiplane/adapters/` holds that exports a catalog. A local file that does not load is skipped.
 */
export const schemaCatalog = async (
  root: string,
  aliases?: Record<string, string>,
): Promise<CatalogEntry[]> => {
  const folder = path.join(root, LOCAL_FOLDER);
  const inFolder = fs.existsSync(folder)
    ? fs
        .readdirSync(folder)
        .filter((file) => /\.(ts|mts|js|mjs)$/.test(file))
        .map((file) => `./${LOCAL_FOLDER}/${file}`)
    : [];
  const yamlFile = YAML_CONFIG_FILES.map((file) => path.join(root, file)).find((file) =>
    fs.existsSync(file),
  );
  const named = yamlFile
    ? localsIn(parse(fs.readFileSync(yamlFile, "utf8"), { prettyErrors: false }))
    : [];
  const local = await Promise.all(
    [...new Set([...named, ...inFolder])].map(async (use) => {
      try {
        return await localEntries(root, [use], aliases);
      } catch {
        return [];
      }
    }),
  );
  return [...(await installedCatalog(root)), ...local.flat()];
};
