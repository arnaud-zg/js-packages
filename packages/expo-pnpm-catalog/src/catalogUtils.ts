import type { WorkspaceYaml } from "./schemas";

/** Fallback top-level workspace directories when pnpm-workspace.yaml declares none. */
export const DEFAULT_WORKSPACE_DIRS = ["apps", "packages", "tooling"] as const;

/** Filesystem locations resolved for a single check/sync run. */
export type CatalogPaths = {
  /** Root of the pnpm workspace (directory containing pnpm-workspace.yaml). */
  rootDir: string;
  /** Directory of the Expo app being checked/synced. */
  appDir: string;
  /** Absolute path to pnpm-workspace.yaml. */
  workspaceYamlPath: string;
  /** Absolute path to the Expo app's package.json. */
  packageJsonPath: string;
};

export type { PackageJson, WorkspaceYaml } from "./schemas";

export type ExtraPackages = {
  /** Which workspace packages declare each catalog package */
  byPackage: Record<string, string[]>;
  /** Resolved version from the catalogs for each package */
  versions: Record<string, string>;
};

export function isCatalogRef(version: string): boolean {
  return version.startsWith("catalog:");
}

/** The root `catalog:` is merged last so it wins over a named catalog on collision. */
export function getAllCatalogVersions(workspace: WorkspaceYaml): Record<string, string> {
  const result: Record<string, string> = {};
  for (const catalog of Object.values(workspace.catalogs ?? {})) {
    Object.assign(result, catalog);
  }
  Object.assign(result, workspace.catalog ?? {});
  return result;
}

type CatalogEntry = {
  name: string;
  version: string;
  workspace: WorkspaceYaml;
};

function resolveVersion({ name, version, workspace }: CatalogEntry): string {
  if (version === "catalog:") return workspace.catalog?.[name] ?? version;
  if (version.startsWith("catalog:")) {
    const catalogName = version.slice("catalog:".length);
    return workspace.catalogs?.[catalogName]?.[name] ?? version;
  }
  return version;
}

export function resolveCatalogRefs(
  deps: Record<string, string>,
  workspace: WorkspaceYaml,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, version] of Object.entries(deps)) {
    resolved[name] = resolveVersion({ name, version, workspace });
  }
  return resolved;
}

export type YamlVersionUpdate = {
  content: string;
  packageName: string;
  newVersion: string;
};

/** A line-level replace rather than a YAML round trip, so comments and formatting survive. */
export function updateVersionInYaml({
  content,
  packageName,
  newVersion,
}: YamlVersionUpdate): string {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^([ \\t]+(?:"${escapedName}"|${escapedName}):\\s*)(.+)$`);

  return content
    .split("\n")
    .map((line) => {
      const match = line.match(pattern);
      return match ? `${match[1]}"${newVersion}"` : line;
    })
    .join("\n");
}
