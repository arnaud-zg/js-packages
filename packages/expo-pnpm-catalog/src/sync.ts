/**
 * expo-pnpm-catalog sync
 *
 * Uses `expo install --fix` (same engine as expo-doctor) to determine the
 * correct dependency versions for the current Expo SDK across the entire
 * workspace, then writes those versions back into the matching `catalogs.*`
 * section of pnpm-workspace.yaml while preserving all `catalog:*` references
 * in every package.json.
 */
import { execSync } from "child_process";

import type { CatalogPaths } from "./catalogUtils";
import type { CatalogWorkspace } from "./catalogWorkspace";
import type { CatalogWorkspaceFile } from "./catalogWorkspace.ports";
import type { ExpoAppManifest } from "./expoAppManifest";
import type { ExpoAppManifestFile } from "./expoAppManifest.ports";
import { CatalogUpdate } from "./catalogUpdate";
import { createCatalogWorkspaceFile } from "./catalogWorkspace.adapter";
import { createExpoAppManifestFile } from "./expoAppManifest.adapter";
import { ExpoManifestResolver } from "./expoManifestResolver";
import {
  confirmApply,
  printAborted,
  printAlreadyInSync,
  printBlankLine,
  printDryRunPending,
  printSeparator,
  printSyncDone,
  printSyncHeader,
  printSyncScope,
  printUpdatesTable,
  startDimSpinner,
  withYamlUpdateSpinner,
} from "./printer";
import { WorkspaceCatalogExpoScanner } from "./workspaceCatalogExpoScanner";

export type SyncOptions = {
  dryRun: boolean;
  yes: boolean;
};

// ── expo install --fix runner ─────────────────────────────────────────────────

function runExpoInstallFix(
  manifestFile: ExpoAppManifestFile,
  resolved: ExpoAppManifest,
  appDir: string,
): ExpoAppManifest {
  const spinner = startDimSpinner("Running expo install --fix...");

  try {
    manifestFile.write(resolved);
    spinner.stop();
    printSeparator();

    execSync("npx expo install --fix", {
      cwd: appDir,
      stdio: "inherit",
      env: { ...process.env, APP_VARIANT: "development" },
    });

    printSeparator();

    return manifestFile.load();
  } finally {
    manifestFile.restore();
  }
}

// ── Update computation ────────────────────────────────────────────────────────

function computeUpdates(
  catalogPackages: Set<string>,
  excludedPackages: Set<string>,
  allCatalogVersions: Record<string, string>,
  fixedManifest: ExpoAppManifest,
): CatalogUpdate[] {
  const fixedDeps = {
    ...fixedManifest.data.dependencies,
    ...fixedManifest.data.devDependencies,
  };

  const updates: CatalogUpdate[] = [];
  for (const name of catalogPackages) {
    const current = allCatalogVersions[name];
    if (excludedPackages.has(name) || current === undefined) continue;
    const update = CatalogUpdate.between(name, current, fixedDeps[name] ?? "");
    if (update) updates.push(update);
  }

  return updates;
}

// ── Apply updates ─────────────────────────────────────────────────────────────

function applyUpdatesToYaml(
  workspaceFile: CatalogWorkspaceFile,
  workspace: CatalogWorkspace,
  updates: CatalogUpdate[],
): void {
  withYamlUpdateSpinner(() => {
    let updated = workspace;
    for (const { name, to } of updates) {
      updated = updated.writeVersion(name, to);
    }
    workspaceFile.save(updated);
  });
}

function runPnpmInstall(rootDir: string): void {
  printSeparator();
  execSync("pnpm install", { cwd: rootDir, stdio: "inherit" });
  printSeparator();
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runSync(paths: CatalogPaths, options: SyncOptions): Promise<void> {
  printSyncHeader(options.dryRun);

  const workspaceFile = createCatalogWorkspaceFile(paths.workspaceYamlPath);
  const workspace = workspaceFile.load();
  const manifestFile = createExpoAppManifestFile(paths.packageJsonPath);
  const manifest = manifestFile.load();
  const scanner = new WorkspaceCatalogExpoScanner(paths.rootDir, workspace.getWorkspaceDirs());

  const catalogPackages = manifest.catalogPackages();
  const extraPackages = scanner.scan(workspace.getAllCatalogVersions(), paths.packageJsonPath);
  const extraOnlyCount = Object.keys(extraPackages.versions).filter(
    (name) => !catalogPackages.has(name),
  ).length;

  for (const name of Object.keys(extraPackages.versions)) {
    catalogPackages.add(name);
  }

  printSyncScope({ packageCount: catalogPackages.size, extraOnlyCount });

  const resolved = ExpoManifestResolver.from(manifest)
    .withCatalogResolution(workspace)
    .mergeExtraPackages(extraPackages.versions)
    .build();

  const fixedManifest = runExpoInstallFix(manifestFile, resolved, paths.appDir);
  const updates = computeUpdates(
    catalogPackages,
    manifest.excludedPackages(),
    workspace.getAllCatalogVersions(),
    fixedManifest,
  );

  if (updates.length === 0) {
    printAlreadyInSync();
    return;
  }

  printUpdatesTable(updates);

  if (options.dryRun) {
    printDryRunPending(updates.length);
    return;
  }

  if (!options.yes && !(await confirmApply(updates.length))) {
    printAborted();
    return;
  }

  printBlankLine();
  applyUpdatesToYaml(workspaceFile, workspace, updates);
  runPnpmInstall(paths.rootDir);
  printSyncDone();
}
