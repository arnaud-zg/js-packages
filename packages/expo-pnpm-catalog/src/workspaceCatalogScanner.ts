/**
 * Scans every workspace package for catalog: references (any catalog),
 * excluding a given package.json path (typically the Expo app itself).
 */
import fs from "fs";
import path from "path";

import type { ExtraPackages } from "./catalogUtils";
import { DEFAULT_WORKSPACE_DIRS, isCatalogRef } from "./catalogUtils";
import { PackageJsonSchema, parseOrThrow } from "./schemas";

type CatalogScan = {
  allCatalogVersions: Record<string, string>;
  result: ExtraPackages;
};

type DirectoryScan = CatalogScan & { directoryPath: string; skipPath: string };

type PackageJsonScan = CatalogScan & { packageJsonPath: string };

export class WorkspaceCatalogScanner {
  constructor(
    private readonly rootDir: string,
    private readonly workspaceDirs: readonly string[] = DEFAULT_WORKSPACE_DIRS,
  ) {}

  scan(allCatalogVersions: Record<string, string>, skipPath: string): ExtraPackages {
    const result: ExtraPackages = { byPackage: {}, versions: {} };
    for (const dir of this.workspaceDirs) {
      this.scanDirectory({
        directoryPath: path.resolve(this.rootDir, dir),
        allCatalogVersions,
        skipPath,
        result,
      });
    }
    return result;
  }

  private scanDirectory({ directoryPath, skipPath, ...scan }: DirectoryScan): void {
    if (!fs.existsSync(directoryPath)) return;
    for (const entry of fs.readdirSync(directoryPath)) {
      const packageJsonPath = path.resolve(directoryPath, entry, "package.json");
      if (packageJsonPath === skipPath || !fs.existsSync(packageJsonPath)) continue;
      this.scanPackageJson({ packageJsonPath, ...scan });
    }
  }

  private scanPackageJson({ packageJsonPath, allCatalogVersions, result }: PackageJsonScan): void {
    const pkg = parseOrThrow({
      schema: PackageJsonSchema,
      value: JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")),
      source: packageJsonPath,
    });
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const sourceName = pkg.name ?? path.basename(path.dirname(packageJsonPath));

    for (const [name, version] of Object.entries(allDeps)) {
      const catalogVersion = allCatalogVersions[name];
      if (!isCatalogRef(version) || catalogVersion === undefined) continue;
      (result.byPackage[name] ??= []).push(sourceName);
      result.versions[name] = catalogVersion;
    }
  }
}

/** @deprecated Renamed to `WorkspaceCatalogScanner`: it scans every catalog, not only `catalogs.expo`. */
export const WorkspaceCatalogExpoScanner = WorkspaceCatalogScanner;
export type WorkspaceCatalogExpoScanner = WorkspaceCatalogScanner;
