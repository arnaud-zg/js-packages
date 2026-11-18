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
import { WorkspaceCatalogScanner } from "./workspaceCatalogScanner";

export type SyncOptions = {
  dryRun: boolean;
  yes: boolean;
};

type InstallFixRun = {
  manifestFile: ExpoAppManifestFile;
  resolved: ExpoAppManifest;
  appDir: string;
};

function runExpoInstallFix({ manifestFile, resolved, appDir }: InstallFixRun): ExpoAppManifest {
  const spinner = startDimSpinner("Running expo install --fix...");

  try {
    manifestFile.write(resolved);
    spinner.stop();
    printSeparator();

    // Stryker disable next-line ObjectLiteral: dropping cwd would run the real npx expo install in the repo
    execSync("npx expo install --fix", {
      cwd: appDir,
      stdio: "inherit",
      // Stryker disable next-line ObjectLiteral: an empty env loses the test's fake PATH, so the real npx runs
      env: { ...process.env, APP_VARIANT: "development" },
    });

    printSeparator();

    return manifestFile.load();
  } finally {
    manifestFile.restore();
  }
}

type UpdateInputs = {
  catalogPackages: ReadonlySet<string>;
  excludedPackages: ReadonlySet<string>;
  allCatalogVersions: Record<string, string>;
  fixedManifest: ExpoAppManifest;
};

function computeUpdates({
  catalogPackages,
  excludedPackages,
  allCatalogVersions,
  fixedManifest,
}: UpdateInputs): CatalogUpdate[] {
  const fixedDeps = {
    ...fixedManifest.data.dependencies,
    ...fixedManifest.data.devDependencies,
  };

  const updates: CatalogUpdate[] = [];
  for (const name of catalogPackages) {
    const current = allCatalogVersions[name];
    if (excludedPackages.has(name) || current === undefined) continue;
    const update = CatalogUpdate.between({ name, from: current, to: fixedDeps[name] ?? "" });
    if (update) updates.push(update);
  }

  return updates;
}

type YamlUpdate = {
  workspaceFile: CatalogWorkspaceFile;
  workspace: CatalogWorkspace;
  updates: CatalogUpdate[];
};

function applyUpdatesToYaml({ workspaceFile, workspace, updates }: YamlUpdate): void {
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
  // Stryker disable next-line ObjectLiteral: dropping cwd would run the real pnpm install in the repo
  execSync("pnpm install", { cwd: rootDir, stdio: "inherit" });
  printSeparator();
}

export async function runSync(paths: CatalogPaths, options: SyncOptions): Promise<void> {
  printSyncHeader(options.dryRun);

  const workspaceFile = createCatalogWorkspaceFile(paths.workspaceYamlPath);
  const workspace = workspaceFile.load();
  const manifestFile = createExpoAppManifestFile(paths.packageJsonPath);
  const manifest = manifestFile.load();
  const scanner = new WorkspaceCatalogScanner(paths.rootDir, workspace.getWorkspaceDirs());

  const appPackages = manifest.catalogPackages();
  const extraPackages = scanner.scan(workspace.getAllCatalogVersions(), paths.packageJsonPath);
  const catalogPackages = new Set([...appPackages, ...Object.keys(extraPackages.versions)]);

  printSyncScope({
    packageCount: catalogPackages.size,
    extraOnlyCount: catalogPackages.size - appPackages.size,
  });

  const resolved = ExpoManifestResolver.from(manifest)
    .withCatalogResolution(workspace)
    .mergeExtraPackages(extraPackages.versions)
    .build();

  const fixedManifest = runExpoInstallFix({ manifestFile, resolved, appDir: paths.appDir });
  const updates = computeUpdates({
    catalogPackages,
    excludedPackages: manifest.excludedPackages(),
    allCatalogVersions: workspace.getAllCatalogVersions(),
    fixedManifest,
  });

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
  applyUpdatesToYaml({ workspaceFile, workspace, updates });
  runPnpmInstall(paths.rootDir);
  printSyncDone();
}
