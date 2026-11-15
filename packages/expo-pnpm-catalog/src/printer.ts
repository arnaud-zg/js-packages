import readline from "readline";
import type { Ora } from "ora";
import chalk from "chalk";
import ora from "ora";

import type { CatalogUpdate } from "./catalogUpdate";
import type { ExtraPackages } from "./catalogUtils";
import type { ExpoAppManifest } from "./expoAppManifest";
import { isCatalogRef } from "./catalogUtils";

const SEPARATOR = chalk.dim("─".repeat(60));

export function printSeparator(): void {
  console.info(SEPARATOR);
}

export function printBlankLine(): void {
  console.info("");
}

export function startDimSpinner(text: string): Ora {
  return ora(chalk.dim(text)).start();
}

// ── check ─────────────────────────────────────────────────────────────────────

function isExtraOnly(
  packageName: string,
  extra: ExtraPackages,
  manifest: ExpoAppManifest,
): boolean {
  const allDeps = { ...manifest.data.dependencies, ...manifest.data.devDependencies };
  const isDeclaredInApp = packageName in allDeps && isCatalogRef(allDeps[packageName] ?? "");
  return packageName in extra.versions && !isDeclaredInApp;
}

function resolveSource(
  packageName: string,
  extra: ExtraPackages,
  manifest: ExpoAppManifest,
  appLabel: string,
): string {
  return isExtraOnly(packageName, extra, manifest)
    ? (extra.byPackage[packageName] ?? []).join(", ")
    : appLabel;
}

export function printDryRunTable(
  manifest: ExpoAppManifest,
  extra: ExtraPackages,
  resolvedDeps: Record<string, string>,
  appLabel: string,
): void {
  const entries = Object.entries(resolvedDeps)
    .filter(([, version]) => !version.startsWith("catalog:"))
    .sort(([a], [b]) => a.localeCompare(b));

  const nameWidth = Math.max(...entries.map(([name]) => name.length), 20);
  const versionWidth = Math.max(...entries.map(([, version]) => version.length), 10);

  console.info(
    "  " +
      chalk.dim("Package".padEnd(nameWidth + 2)) +
      chalk.dim("Version".padEnd(versionWidth + 4)) +
      chalk.dim("Source"),
  );
  console.info("  " + chalk.dim("─".repeat(nameWidth + versionWidth + 20)));

  for (const [packageName, version] of entries) {
    console.info(
      "  " +
        chalk.white(packageName.padEnd(nameWidth + 2)) +
        chalk.cyan(version.padEnd(versionWidth + 4)) +
        chalk.dim(resolveSource(packageName, extra, manifest, appLabel)),
    );
  }

  console.info("");
  console.info(chalk.yellow("  [dry run]") + chalk.dim(" — nothing was written or run"));
}

export function printScanHeader(
  appCount: number,
  extra: ExtraPackages,
  manifest: ExpoAppManifest,
  isDryRun: boolean,
  appLabel: string,
): void {
  const extraOnlyNames = Object.keys(extra.byPackage).filter((name) =>
    isExtraOnly(name, extra, manifest),
  );
  const totalCount = appCount + extraOnlyNames.length;

  console.info(
    chalk.bold("  Expo catalog check") +
      chalk.dim(` — ${totalCount} packages`) +
      (isDryRun ? chalk.yellow("  [dry run]") : ""),
  );

  if (extraOnlyNames.length === 0) return;

  console.info(
    chalk.dim(
      `  ${appCount} from ${appLabel} · ${extraOnlyNames.length} additional from other workspace packages`,
    ),
  );
  for (const name of extraOnlyNames) {
    console.info(
      chalk.dim(`    + ${name}`) +
        chalk.dim.italic(` (${(extra.byPackage[name] ?? []).join(", ")})`),
    );
  }
}

export function printDoctorResult(passed: boolean): void {
  console.info(SEPARATOR);
  console.info("");

  if (passed) {
    console.info(chalk.green("  ✓ All checks passed"));
    return;
  }

  console.info(chalk.red("  ✗ expo-doctor reported issues"));
  console.info(
    chalk.yellow("  → Run ") +
      chalk.bold("expo-pnpm-catalog sync") +
      chalk.yellow(" to fix version drift"),
  );
}

// ── sync ──────────────────────────────────────────────────────────────────────

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

export function printSyncHeader(isDryRun: boolean): void {
  console.info("");
  console.info(chalk.bold("  Expo catalog sync") + (isDryRun ? chalk.yellow("  [dry run]") : ""));
  console.info("");
}

export function printSyncScope({
  packageCount,
  extraOnlyCount,
}: {
  packageCount: number;
  extraOnlyCount: number;
}): void {
  console.info(chalk.dim(`  Scanning ${packageCount} catalog packages across workspace...`));
  if (extraOnlyCount > 0) {
    console.info(chalk.dim(`  Including ${extraOnlyCount} packages from other workspace packages`));
  }
  console.info("");
}

export function printAlreadyInSync(): void {
  console.info("");
  console.info(chalk.green("  ✓ catalogs are already in sync with the Expo SDK."));
  console.info("");
}

export function printUpdatesTable(updates: CatalogUpdate[]): void {
  const nameWidth = Math.max(...updates.map((u) => u.name.length), 20);
  const fromWidth = Math.max(...updates.map((u) => u.from.length), 8);

  console.info("");
  console.info(
    "  " +
      chalk.dim("Package".padEnd(nameWidth + 2)) +
      chalk.dim("From".padEnd(fromWidth + 4)) +
      chalk.dim("To"),
  );
  console.info("  " + chalk.dim("─".repeat(nameWidth + fromWidth + 20)));

  for (const { name, from, to } of updates) {
    console.info(
      "  " +
        chalk.white(name.padEnd(nameWidth + 2)) +
        chalk.yellow(from.padEnd(fromWidth + 4)) +
        chalk.dim("→  ") +
        chalk.green(to),
    );
  }

  console.info("");
}

export function printDryRunPending(updateCount: number): void {
  console.info(
    chalk.yellow(`  ${updateCount} update${plural(updateCount)} pending`) +
      chalk.dim(" — dry run, nothing written"),
  );
  console.info("");
}

export async function confirmApply(updateCount: number): Promise<boolean> {
  const message = chalk.bold(
    `  Apply ${updateCount} update${plural(updateCount)} to pnpm-workspace.yaml?`,
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} ${chalk.dim("[Y/n] ")}`, (input) => {
      rl.close();
      resolve(input.trim().toLowerCase());
    });
  });
  return answer === "" || answer === "y" || answer === "yes";
}

export function printAborted(): void {
  console.info("");
  console.info(chalk.yellow("  Aborted."));
  console.info("");
}

export function withYamlUpdateSpinner(work: () => void): void {
  const spinner = ora("Updating pnpm-workspace.yaml...").start();
  work();
  spinner.succeed(chalk.green("pnpm-workspace.yaml updated"));
}

export function printSyncDone(): void {
  console.info("");
  console.info(chalk.green("  ✓ Done — catalog and lockfile are in sync."));
  console.info("");
}
