/**
 * expo-pnpm-catalog check
 *
 * Mirrors what `expo-doctor` would see in CI: temporarily resolves all
 * `catalog:*` references to concrete versions — across every workspace
 * package, not just the Expo app — so that `npx expo-doctor` can read the
 * full dependency surface correctly, then restores the original file.
 */
import { execSync } from "child_process";
import path from "path";

import type { CatalogPaths } from "./catalogUtils";
import type { ExpoAppManifest } from "./expoAppManifest";
import type { ExpoAppManifestFile } from "./expoAppManifest.ports";
import type { InterruptGuard } from "./interruptGuard";
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
import { WorkspaceCatalogExpoScanner } from "./workspaceCatalogExpoScanner";

export type CheckOptions = {
  dryRun: boolean;
  /** Restores the Expo app's package.json if the run is interrupted; the CLI wires process signals. */
  interrupts?: InterruptGuard;
};

type DoctorRun = {
  manifestFile: ExpoAppManifestFile;
  resolved: ExpoAppManifest;
  appDir: string;
  interrupts: InterruptGuard;
};

function runExpoDoctor({ manifestFile, resolved, appDir, interrupts }: DoctorRun): boolean {
  const spinner = startDimSpinner("Starting expo-doctor...");

  return interrupts.run({
    onInterrupt: () => manifestFile.restore(),
    work: () => {
      try {
        manifestFile.write(resolved);
        spinner.stop();
        printSeparator();

        execSync("npx expo-doctor", {
          cwd: appDir,
          stdio: "inherit",
          env: { ...process.env, APP_VARIANT: "development" },
        });

        return true;
      } catch {
        return false;
      } finally {
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
  const scanner = new WorkspaceCatalogExpoScanner(paths.rootDir, workspace.getWorkspaceDirs());

  const appLabel = path.relative(paths.rootDir, paths.appDir) || ".";
  const appCount = manifest.catalogPackages().size;
  const extra = scanner.scan(workspace.getAllCatalogVersions(), paths.packageJsonPath);

  printScanHeader(appCount, extra, manifest, options.dryRun, appLabel);
  printBlankLine();

  const resolved = ExpoManifestResolver.from(manifest)
    .withCatalogResolution(workspace)
    .mergeExtraPackages(extra.versions)
    .build();

  if (options.dryRun) {
    printDryRunTable(manifest, extra, resolved.data.dependencies ?? {}, appLabel);
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
