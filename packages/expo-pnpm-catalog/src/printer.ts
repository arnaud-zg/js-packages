import readline from "readline";
import type { Ora } from "ora";
import chalk from "chalk";
import ora from "ora";

import type { CatalogUpdate } from "./catalogUpdate";

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

export type DryRunRow = { name: string; version: string; source: string };

export function printDryRunTable(rows: DryRunRow[]): void {
  const nameWidth = Math.max(...rows.map(({ name }) => name.length), 20);
  const versionWidth = Math.max(...rows.map(({ version }) => version.length), 10);

  console.info(
    "  " +
      chalk.dim("Package".padEnd(nameWidth + 2)) +
      chalk.dim("Version".padEnd(versionWidth + 4)) +
      chalk.dim("Source"),
  );
  console.info("  " + chalk.dim("─".repeat(nameWidth + versionWidth + 20)));

  for (const { name, version, source } of rows) {
    console.info(
      "  " +
        chalk.white(name.padEnd(nameWidth + 2)) +
        chalk.cyan(version.padEnd(versionWidth + 4)) +
        chalk.dim(source),
    );
  }

  console.info("");
  console.info(chalk.yellow("  [dry run]") + chalk.dim(" — nothing was written or run"));
}

export type ExtraOnlyPackage = { name: string; usedBy: string[] };

export type ScanHeader = {
  appCount: number;
  extraOnly: ExtraOnlyPackage[];
  isDryRun: boolean;
  appLabel: string;
};

export function printScanHeader({ appCount, extraOnly, isDryRun, appLabel }: ScanHeader): void {
  const totalCount = appCount + extraOnly.length;

  console.info(
    chalk.bold("  Expo catalog check") +
      chalk.dim(` — ${totalCount} packages`) +
      (isDryRun ? chalk.yellow("  [dry run]") : ""),
  );

  if (extraOnly.length === 0) return;

  console.info(
    chalk.dim(
      `  ${appCount} from ${appLabel} · ${extraOnly.length} additional from other workspace packages`,
    ),
  );
  for (const { name, usedBy } of extraOnly) {
    console.info(chalk.dim(`    + ${name}`) + chalk.dim.italic(` (${usedBy.join(", ")})`));
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
