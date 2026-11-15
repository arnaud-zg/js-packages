import { execSync } from "child_process";
import path from "path";

import type { CatalogPaths, ExtraPackages } from "./catalogUtils";
import type { ExpoAppManifest } from "./expoAppManifest";
import type { ExpoAppManifestFile } from "./expoAppManifest.ports";
import type { InterruptGuard } from "./interruptGuard";
import type { DryRunRow, ExtraOnlyPackage } from "./printer";
import { isCatalogRef } from "./catalogUtils";
import { createCatalogWorkspaceFile } from "./catalogWorkspace.adapter";
import { createExpoAppManifestFile } from "./expoAppManifest.adapter";
import { ExpoManifestResolver } from "./expoManifestResolver";
import { noInterruptGuard } from "./interruptGuard";
import {
  printBlankLine,
  printDoctorResult,
  printDryRunTable,
  printScanHeader,
  printSeparator,
  startDimSpinner,
} from "./printer";
import { WorkspaceCatalogScanner } from "./workspaceCatalogScanner";

export type CheckOptions = {
  dryRun: boolean;
  /** Restores the Expo app's package.json if the run is interrupted; the CLI wires process signals. */
  interrupts?: InterruptGuard;
};

type PackageOrigin = {
  packageName: string;
  extra: ExtraPackages;
  manifest: ExpoAppManifest;
};

function isExtraOnly({ packageName, extra, manifest }: PackageOrigin): boolean {
  const allDeps = { ...manifest.data.dependencies, ...manifest.data.devDependencies };
  const isDeclaredInApp = packageName in allDeps && isCatalogRef(allDeps[packageName] ?? "");
  return packageName in extra.versions && !isDeclaredInApp;
}

function resolveSource({ appLabel, ...origin }: PackageOrigin & { appLabel: string }): string {
  return isExtraOnly(origin)
    ? (origin.extra.byPackage[origin.packageName] ?? []).join(", ")
    : appLabel;
}

function extraOnlyPackages({
  extra,
  manifest,
}: Omit<PackageOrigin, "packageName">): ExtraOnlyPackage[] {
  return Object.keys(extra.byPackage)
    .filter((packageName) => isExtraOnly({ packageName, extra, manifest }))
    .map((packageName) => ({ name: packageName, usedBy: extra.byPackage[packageName] ?? [] }));
}

type DryRunTable = Omit<PackageOrigin, "packageName"> & {
  resolvedDeps: Record<string, string>;
  appLabel: string;
};

function dryRunRows({ resolvedDeps, ...context }: DryRunTable): DryRunRow[] {
  return Object.entries(resolvedDeps)
    .filter(([, version]) => !isCatalogRef(version))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([packageName, version]) => ({
      name: packageName,
      version,
      source: resolveSource({ packageName, ...context }),
    }));
}

type DoctorRun = {
  manifestFile: ExpoAppManifestFile;
  resolved: ExpoAppManifest;
  appDir: string;
  interrupts: InterruptGuard;
};

function expoDoctorPasses(appDir: string): boolean {
  try {
    execSync("npx expo-doctor", {
      cwd: appDir,
      stdio: "inherit",
      env: { ...process.env, APP_VARIANT: "development" },
    });
    return true;
  } catch {
    return false;
  }
}

function runExpoDoctor({ manifestFile, resolved, appDir, interrupts }: DoctorRun): boolean {
  const spinner = startDimSpinner("Starting expo-doctor...");

  return interrupts.run({
    onInterrupt: () => manifestFile.restore(),
    work: () => {
      try {
        manifestFile.write(resolved);
        spinner.stop();
        printSeparator();
        return expoDoctorPasses(appDir);
      } finally {
        spinner.stop();
        manifestFile.restore();
      }
    },
  });
}

export function runCheck(paths: CatalogPaths, options: CheckOptions): boolean {
  printBlankLine();

  const workspace = createCatalogWorkspaceFile(paths.workspaceYamlPath).load();
  const manifestFile = createExpoAppManifestFile(paths.packageJsonPath);
  const manifest = manifestFile.load();
  const scanner = new WorkspaceCatalogScanner(paths.rootDir, workspace.getWorkspaceDirs());

  const appLabel = path.relative(paths.rootDir, paths.appDir) || ".";
  const extra = scanner.scan(workspace.getAllCatalogVersions(), paths.packageJsonPath);

  printScanHeader({
    appCount: manifest.catalogPackages().size,
    extraOnly: extraOnlyPackages({ extra, manifest }),
    isDryRun: options.dryRun,
    appLabel,
  });
  printBlankLine();

  const resolved = ExpoManifestResolver.from(manifest)
    .withCatalogResolution(workspace)
    .mergeExtraPackages(extra.versions)
    .build();

  if (options.dryRun) {
    printDryRunTable(
      dryRunRows({ extra, manifest, resolvedDeps: resolved.data.dependencies ?? {}, appLabel }),
    );
    return true;
  }

  const passed = runExpoDoctor({
    manifestFile,
    resolved,
    appDir: paths.appDir,
    interrupts: options.interrupts ?? noInterruptGuard,
  });
  printDoctorResult(passed);
  printBlankLine();
  return passed;
}
