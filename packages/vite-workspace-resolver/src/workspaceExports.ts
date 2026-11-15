import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Package } from "resolve.exports";
import { exports as resolveExportsMap } from "resolve.exports";

import { parseSpecifier } from "./parseSpecifier";
import { readPackageManifest } from "./readPackageManifest";

// Vite's own Plugin type drags its version-fragile CSS/PostCSS type graph into this build.
export type WorkspaceExportsPlugin = {
  name: string;
  enforce: "pre";
  resolveId: (source: string) => string | null;
};

export type WorkspaceExportsOptions = {
  /** Directories under `rootDir` whose direct children are workspace packages. */
  groups?: string[];
};

type WorkspacePackage = {
  dir: string;
  packageJson: Package;
};

type WorkspacePackages = Map<string, WorkspacePackage>;

const DEFAULT_GROUPS = ["packages"];
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx"];

const scanGroup = ({ groupDir, packages }: { groupDir: string; packages: WorkspacePackages }) => {
  for (const entry of readdirSync(groupDir)) {
    const dir = join(groupDir, entry);
    const packageJson = readPackageManifest(join(dir, "package.json"));
    if (packageJson) {
      packages.set(packageJson.name, { dir, packageJson });
    }
  }
};

const scanWorkspacePackages = ({
  rootDir,
  groups,
}: {
  rootDir: string;
  groups: string[];
}): WorkspacePackages => {
  const packages: WorkspacePackages = new Map();
  const groupDirs = groups.map((group) => join(rootDir, group)).filter(existsSync);
  for (const groupDir of groupDirs) {
    scanGroup({ groupDir, packages });
  }
  return packages;
};

const resolveWithExtension = (filePath: string): string | null => {
  const extension = SOURCE_EXTENSIONS.find((candidate) => existsSync(filePath + candidate));
  return extension === undefined ? null : filePath + extension;
};

// resolve.exports owns the exports-map algorithm (conditions, wildcards); never hand-roll it.
const resolveExportSubpath = ({
  workspacePackage,
  subpath,
}: {
  workspacePackage: WorkspacePackage;
  subpath: string;
}): string | null => {
  try {
    const [target] = resolveExportsMap(workspacePackage.packageJson, subpath) ?? [];
    return target ? join(workspacePackage.dir, target) : null;
  } catch {
    return null;
  }
};

// See docs/vite-workspace-resolver/explanation.md for why Vite needs this plugin.
export const workspaceExports = (
  rootDir: string,
  { groups = DEFAULT_GROUPS }: WorkspaceExportsOptions = {},
): WorkspaceExportsPlugin => {
  const packages = scanWorkspacePackages({ rootDir, groups });

  return {
    name: "workspace-exports",
    enforce: "pre",
    resolveId(source) {
      const specifier = parseSpecifier(source);
      const workspacePackage = specifier && packages.get(specifier.packageName);
      if (!workspacePackage) {
        return null;
      }
      if (specifier.deepSrcPath) {
        return resolveWithExtension(join(workspacePackage.dir, "src", specifier.deepSrcPath));
      }
      return resolveExportSubpath({ workspacePackage, subpath: specifier.subpath });
    },
  };
};
