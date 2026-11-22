import fs from "node:fs";
import path from "node:path";

import { tsConfig } from "../adapters/config/ts-config.adapter";

/** The nearest folder up from here with a release config, else the git root, else here. */
export const findRoot = (from: string): string => {
  const ancestors = (dir: string): string[] => {
    const parent = path.dirname(dir);
    return parent === dir ? [dir] : [dir, ...ancestors(parent)];
  };
  const chain = ancestors(path.resolve(from));
  const config = tsConfig();
  return (
    chain.find((dir) => config.find(dir) !== null) ??
    chain.find((dir) => fs.existsSync(path.join(dir, ".git"))) ??
    path.resolve(from)
  );
};
