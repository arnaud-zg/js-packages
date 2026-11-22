import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

import type { ConfigReader } from "../../ports/config.port";

const EXTENSIONS = ["ts", "mts", "js", "mjs"];

/** The config's names, the one from before shiplane last: still read, listed to rename. */
const CONFIG_FILES = [
  ...EXTENSIONS.map((extension) => `shiplane.config.${extension}`),
  ...EXTENSIONS.map((extension) => `release.config.${extension}`),
];

// The name a config imports the CLI under.
const NAMES = ["shiplane"];

const resolves = (specifier: string) => {
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch {
    return null;
  }
};

// One alias per entry: a bare "shiplane" alias would also rewrite "shiplane/fly" into a path
// under index.js.
const selfAliases = (): Record<string, string> => {
  const own = NAMES.find((name) => resolves(name) !== null);
  if (!own) return {};
  return Object.fromEntries(
    ["", "/plugin", "/testing"].flatMap((sub) => {
      const target = resolves(`${own}${sub}`);
      return target ? NAMES.map((name) => [`${name}${sub}`, target]) : [];
    }),
  );
};

/** Imports a TypeScript or JavaScript file as a config does, `shiplane` resolved by `aliases`. */
export const importTs = (file: string, aliases?: Record<string, string>): Promise<unknown> =>
  createJiti(import.meta.url, {
    alias: aliases ?? selfAliases(),
    moduleCache: false,
    fsCache: false,
  }).import(file);

/**
 * `shiplane.config.ts` (or .mts, .js, .mjs), run through jiti: its default export, as written.
 * `aliases` says where `shiplane` resolves from inside the config; by default, this very package.
 */
export const tsConfig = ({ aliases }: { aliases?: Record<string, string> } = {}): ConfigReader => ({
  find: (root) =>
    CONFIG_FILES.map((file) => path.join(root, file)).find((file) => fs.existsSync(file)) ?? null,
  read: async (file) => {
    const jiti = createJiti(import.meta.url, {
      alias: aliases ?? selfAliases(),
      moduleCache: false,
      fsCache: false,
    });
    return jiti.import(file, { default: true });
  },
});
