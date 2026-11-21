import type { CatalogEntry } from "../ports/catalog.port";
import type { Files } from "../ports/files.port";
import type { Output } from "../ports/terminal.port";
import { CONFIG_SCHEMA_FILE, configSchemaText, SCHEMA_MODELINE } from "./config/configSchema";
import { paint } from "./say";

const YAML_FILES = ["shiplane.yml", "shiplane.yaml"];

/**
 * `shiplane schema`: writes the editor schema of shiplane.yml for the plugins installed and the
 * adapters of this repository, and points shiplane.yml at it when it does not yet.
 */
export const writeConfigSchema = (
  { files, output }: { files: Files; output: Output },
  catalog: readonly CatalogEntry[],
): boolean => {
  files.write(CONFIG_SCHEMA_FILE, configSchemaText(catalog));
  const count = (kind: CatalogEntry["kind"]) =>
    catalog.filter((entry) => entry.kind === kind).length;
  output.line(
    `${paint("green", "◇")}  Wrote ${CONFIG_SCHEMA_FILE}: ${count("adapter")} adapters, ${count("module")} modules, ${count("feature")} features`,
  );
  const config = YAML_FILES.find((file) => files.exists(file));
  const text = config ? files.read(config) : null;
  if (config && text !== null && !text.includes("yaml-language-server: $schema=")) {
    files.write(config, `${SCHEMA_MODELINE}\n${text}`);
    output.line(`${paint("green", "◇")}  ${config} points your editor at it`);
  }
  return true;
};
