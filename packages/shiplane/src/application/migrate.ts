import path from "node:path";

import type { CatalogEntry } from "../ports/catalog.port";
import type { Files } from "../ports/files.port";
import type { Output } from "../ports/terminal.port";
import type { Release } from "./config/loadRelease";
import { YAML_CONFIG_FILE } from "./config/yamlDeclaration";
import { yamlFromDeclaration } from "./config/yamlFromDeclaration";
import { paint } from "./say";

/** What migrate reads and loads, as `cli/main` wires them for this repository. */
export interface MigratePorts {
  /** The TS config's path, or null when the repository holds none. */
  tsFile: string | null;
  /** What the TS config declares, as written. */
  declared: () => Promise<unknown>;
  catalog: readonly CatalogEntry[];
  /** The release from the TS config alone, or from shiplane.yml alone. */
  load: (from: "ts" | "yaml") => Promise<Release>;
}

/** What a release composes, as `plugins --json` shows it, plus every setting YAML carries. */
const composed = (release: Release) =>
  JSON.stringify({
    flow: [
      release.flow.sourceControl.name,
      release.flow.codeHost.name,
      release.flow.ciPipeline.name,
      release.flow.versioning.name,
      release.flow.approval,
    ],
    modules: release.modules.map(({ name, kind, provider }) => [name, kind, provider]),
    features: release.features.map(({ name }) => name),
    units: release.units.map(({ name, module }) => [name, module]),
    settings: [
      release.tagFormat,
      release.via,
      release.testComment,
      release.testRelease,
      release.prepare,
      release.display,
    ],
  });

/**
 * `shiplane migrate`: writes shiplane.yml from shiplane.config.ts, loads it back, and removes the TS
 * config once both compose the same release. What YAML cannot hold is listed and nothing is written.
 */
export const migrate = async (
  { files, output }: { files: Files; output: Output },
  ports: MigratePorts,
): Promise<boolean> => {
  const fail = (message: string, hint?: string) => {
    output.line(`${paint("red", "✗")}  ${message}`);
    if (hint) output.line(`   ${paint("dim", hint)}`);
    return false;
  };
  if (files.exists(YAML_CONFIG_FILE))
    return fail(
      `${YAML_CONFIG_FILE} already exists`,
      "shiplane migrate writes it from shiplane.config.ts; remove one of them",
    );
  if (!ports.tsFile)
    return fail(
      "no shiplane.config.ts to migrate",
      "shiplane setup --format yaml writes a shiplane.yml",
    );
  const tsName = path.basename(ports.tsFile);

  const fromTs = await ports.load("ts");
  if (fromTs.problems.length > 0) {
    fromTs.problems.forEach(({ file, line, message }) =>
      output.line(
        `${paint("red", "✗")}  ${line === undefined ? file : `${file}:${line}`}  ${message}`,
      ),
    );
    return fail(`${tsName} has problems: fix them, then migrate`);
  }

  const { text, unconverted, check } = yamlFromDeclaration(await ports.declared(), ports.catalog);
  if (unconverted.length > 0) {
    unconverted.forEach(({ at, message, hint }) => {
      output.line(`${paint("red", "✗")}  ${paint("bold", at)}  ${message}`);
      if (hint) output.line(`   ${paint("dim", hint)}`);
    });
    return fail(
      `Nothing written: YAML cannot hold ${unconverted.length === 1 ? "this" : "these"}. Change ${unconverted.length === 1 ? "it" : "them"} in ${tsName}, or keep it.`,
    );
  }

  files.write(YAML_CONFIG_FILE, text);
  const fromYaml = await ports.load("yaml");
  if (fromYaml.problems.length > 0 || composed(fromYaml) !== composed(fromTs)) {
    files.remove(YAML_CONFIG_FILE);
    fromYaml.problems.forEach(({ file, line, message }) =>
      output.line(
        `${paint("red", "✗")}  ${line === undefined ? file : `${file}:${line}`}  ${message}`,
      ),
    );
    return fail(
      `${YAML_CONFIG_FILE} would not release what ${tsName} does: nothing changed`,
      "please report it, with both configs",
    );
  }
  files.remove(tsName);
  output.line(
    `${paint("green", "◇")}  Wrote ${YAML_CONFIG_FILE}: the same release as ${tsName}, which is removed`,
  );
  check.forEach((line) => output.line(`${paint("yellow", "!")}  ${line}`));
  output.line(paint("dim", `   git restore ${tsName} brings it back`));
  return true;
};
