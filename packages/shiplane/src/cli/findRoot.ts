import fs from "node:fs";
import path from "node:path";

import { tsConfig } from "../adapters/config/ts-config.adapter";
import { YAML_CONFIG_FILES } from "../adapters/config/yaml-config.adapter";

/** The nearest folder up from here with a release config, else the git root, else here. */
export const findRoot = (from: string): string => {
  const ancestors = (dir: string): string[] => {
    const parent = path.dirname(dir);
    return parent === dir ? [dir] : [dir, ...ancestors(parent)];
  };
  const chain = ancestors(path.resolve(from));
  const config = tsConfig();
  const holdsConfig = (dir: string) =>
    config.find(dir) !== null ||
    YAML_CONFIG_FILES.some((file) => fs.existsSync(path.join(dir, file)));
  return (
    chain.find(holdsConfig) ??
    chain.find((dir) => fs.existsSync(path.join(dir, ".git"))) ??
    path.resolve(from)
  );
};
