#!/usr/bin/env node
import { Command } from "commander";

import type { Config } from "./config";
import { budgetReport, checkedFileAt } from "./budgetReport";
import { defaultConfigPath, loadConfig } from "./config";
import { createContextFiles } from "./contextFiles.adapter";
import { printDeadRefWarnings, printExplain, printHumanReport, printJson } from "./reportPrinter";

interface CheckOptions {
  json?: boolean;
  explain?: string;
}

function loadConfigOrReport(): Config | null {
  try {
    return loadConfig();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`✗ Invalid ${defaultConfigPath()}: ${reason}`);
    return null;
  }
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function runCheck(opts: CheckOptions): void {
  const config = loadConfigOrReport();
  if (!config) {
    process.exitCode = 1;
    return;
  }
  const files = createContextFiles();
  const rootContent = files.read(config.root.file);
  if (rootContent === null) {
    fail(`✗ Root context file not found: ${config.root.file}`);
    return;
  }
  const report = budgetReport({ config, rootContent, files });
  printDeadRefWarnings({ deadRefs: report.deadRefs, rootFile: config.root.file });

  if (opts.explain) {
    const target = checkedFileAt({ report, path: opts.explain });
    if (!target) {
      fail(`✗ File not found in results: ${opts.explain}`);
      return;
    }
    printExplain(target);
    return;
  }

  const printReport = opts.json ? printJson : printHumanReport;
  printReport({ report, config });
  if (report.exitCode !== 0) process.exitCode = report.exitCode;
}

const program = new Command()
  .name("context-budget")
  .description("Token-budget analysis for AI agent context files (CLAUDE.md, AGENTS.md, etc.)");

program
  .command("check")
  .description("Analyze context files against their token budgets")
  .option("--json", "output machine-readable JSON instead of the human-readable report")
  .option("--explain <path>", "print a detailed breakdown for a single file")
  .action((opts: CheckOptions) => {
    runCheck(opts);
  });

program.parse(process.argv);
