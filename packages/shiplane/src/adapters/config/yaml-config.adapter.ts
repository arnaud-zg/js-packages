import fs from "node:fs";
import path from "node:path";
import { LineCounter, parseDocument } from "yaml";

import type { CatalogEntry } from "../../ports/catalog.port";
import type { ConfigReader } from "../../ports/config.port";
import { isCatalogEntry } from "../../application/config/catalog";
import { isRecord } from "../../application/config/values";
import {
  isLocal,
  YAML_CONFIG_FILES,
  yamlDeclaration,
} from "../../application/config/yamlDeclaration";
import { ConfigError } from "../../ports/config.port";
import { importTs } from "./ts-config.adapter";

export { YAML_CONFIG_FILES };

/** Every local file the flow, the modules and the features name: `./x.ts` or `use: ./x.ts`. */
export const localsIn = (document: unknown): string[] => {
  const walk = (value: unknown): string[] => {
    if (typeof value === "string") return isLocal(value) ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(walk);
    return isRecord(value) ? Object.values(value).flatMap(walk) : [];
  };
  if (!isRecord(document)) return [];
  return [document.flow, document.modules, document.features].flatMap(walk);
};

/** Each local file's catalog, every entry named by the file's path from the root, `./x.ts`. */
export const localEntries = async (
  root: string,
  uses: readonly string[],
  aliases?: Record<string, string>,
): Promise<CatalogEntry[]> => {
  const files = [...new Set(uses)];
  const loaded = await Promise.all(
    files.map(async (use) => {
      const file = path.join(root, use);
      if (!fs.existsSync(file)) {
        throw new ConfigError(`${use} does not exist`, {
          hint: "use: takes a path from the repository root, such as ./shiplane/adapters/my-host.ts",
        });
      }
      const exported = await importTs(file, aliases);
      const catalog = isRecord(exported) ? exported.catalog : undefined;
      if (!Array.isArray(catalog) || !catalog.every(isCatalogEntry)) {
        throw new ConfigError(`${use} exports no catalog`, {
          hint: "export const catalog = [adapterEntry({ ... })], with adapterEntry from shiplane/plugin",
        });
      }
      return catalog.map((entry) => ({ ...entry, name: use }));
    }),
  );
  return loaded.flat();
};

/**
 * `shiplane.yml`: each adapter, module and feature named from `catalog`, what the plugins installed
 * in the repository give, or from a local file. `aliases` say where `shiplane` resolves from inside
 * a local file. A problem carries its line.
 */
export const yamlConfig = ({
  catalog,
  aliases,
}: {
  catalog: (root: string) => Promise<readonly CatalogEntry[]>;
  aliases?: Record<string, string>;
}): ConfigReader => ({
  find: (root) =>
    YAML_CONFIG_FILES.map((file) => path.join(root, file)).find((file) => fs.existsSync(file)) ??
    null,
  read: async (file) => {
    const lines = new LineCounter();
    const document = parseDocument(fs.readFileSync(file, "utf8"), { lineCounter: lines });
    const [broken] = document.errors;
    if (broken) {
      const error = new ConfigError(broken.message.split("\n")[0] ?? "not valid YAML", {
        hint: "check the indentation and the colons on that line",
      });
      error.line = broken.linePos?.[0].line;
      throw error;
    }
    const plain: unknown = document.toJS();
    const root = path.dirname(file);
    try {
      return yamlDeclaration(plain, [
        ...(await catalog(root)),
        ...(await localEntries(root, localsIn(plain), aliases)),
      ]);
    } catch (error) {
      if (error instanceof ConfigError) {
        // The nearest node the path reaches: a value that is missing points at its parent.
        for (let depth = error.path.length; depth > 0; depth -= 1) {
          const node: unknown = document.getIn(error.path.slice(0, depth), true);
          if (isRecord(node) && Array.isArray(node.range) && typeof node.range[0] === "number") {
            error.line = lines.linePos(node.range[0]).line;
            break;
          }
        }
      }
      throw error;
    }
  },
});
