import type { FileResult, Health } from "./analyzeFile";
import type { BudgetReport, CheckedFile, ExitCode } from "./budgetReport";
import type { Config } from "./config";
import type { SimilarityPair } from "./similarity";
import { toHealth } from "./analyzeFile";
import { adaptiveThreshold, coefficientOfVariation, percentile } from "./robustStats";
import { computePareto, parseSections } from "./sections";

const HEALTH_ICON = { good: "✓", normal: "~", warning: "⚠", bad: "✗" } satisfies Record<
  Health,
  string
>;

const HEALTH_LABEL = {
  good: "GOOD",
  normal: "NORMAL",
  warning: "WARNING",
  bad: "BAD",
} satisfies Record<Health, string>;

const VERDICT = {
  0: "\n✓ All files within budget.",
  1: "\n✗ Token budget exceeded.",
  2: "\n~ Advisory: optimization opportunities detected (see above). Exit 2.",
} satisfies Record<ExitCode, string>;

interface GroupView {
  title: string;
  advisoryLabel: string;
  summaryLabel: string;
}

const REFERENCE_VIEW: GroupView = {
  title: "Reference docs (on-demand):",
  advisoryLabel: "Refs",
  summaryLabel: "References:",
};

const SUBDIR_VIEW: GroupView = {
  title: "Subdirectory CLAUDE.md (context-sensitive):",
  advisoryLabel: "Subdir",
  summaryLabel: "Subdir:",
};

const BAR_WIDTH = 10;

function bar(ratio: number): string {
  const filled = Math.min(Math.round(ratio * BAR_WIDTH), BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function resultsOf(entries: CheckedFile[]): FileResult[] {
  return entries.map(({ result }) => result);
}

function printSection({ title, results }: { title: string; results: FileResult[] }): void {
  console.info(`\n${title}`);
  for (const r of results) {
    const pct = Math.round(r.ratio * 100);
    const noiseTag = r.noiseFlagged ? " ⚠ noise" : "";
    const redundancyTag = r.redundancyLevel === "shrink" ? " ⚠ redundant" : "";
    console.info(
      `  ${HEALTH_ICON[r.health]} ${r.path.padEnd(52)} ${String(r.tokens).padStart(5)} tokens  ${bar(r.ratio)}  ${pct}%  ${HEALTH_LABEL[r.health]}${noiseTag}${redundancyTag}`,
    );
  }
}

function printPareto({ result, content }: Omit<CheckedFile, "group">): void {
  const pareto = computePareto(parseSections(content), result.tokens, result.ratio);
  if (pareto.length === 0) return;

  console.info(`\n  Pareto breakdown — ${result.path}`);
  for (const s of pareto.slice(0, 5)) {
    const pct = Math.round(s.pct * 100);
    const flag = s.flagExtract ? "  ← EXTRACT" : "";
    const indent = "  ".repeat(Math.max(0, s.level - 1));
    console.info(
      `    ${indent}${"#".repeat(s.level)} ${s.heading.padEnd(44 - indent.length)} ${String(s.tokens).padStart(5)} tokens  ${pct}%${flag}`,
    );
  }
  if (pareto.length <= 5) return;
  const rest = pareto.slice(5).reduce((s, p) => s + p.tokens, 0);
  console.info(`    … ${pareto.length - 5} more sections — ${rest} tokens combined`);
}

function printSimilarityFlags(result: FileResult): void {
  if (!result.similarityFlags || result.similarityFlags.length === 0) return;
  console.info(`  Similarity flags:`);
  for (const sf of result.similarityFlags) {
    console.info(
      `    ${sf.flag.toUpperCase().padEnd(16)} J=${sf.jaccard.toFixed(2)}  vs  ${sf.other}`,
    );
  }
}

export function printExplain({ result, content }: CheckedFile): void {
  console.info(`\n=== Detailed report: ${result.path} ===`);
  const pct = Math.round(result.ratio * 100);
  console.info(
    `  Tokens: ${result.tokens.toLocaleString()} / ${result.threshold.toLocaleString()}  ${bar(result.ratio)}  ${pct}%  ${HEALTH_LABEL[result.health]}`,
  );
  console.info(`  Gzip ratio:       ${result.gzipRatio}  (${result.redundancyLevel})`);
  console.info(
    `  Structural noise: ${result.noiseTokens} tokens (${Math.round((result.noisePct ?? 0) * 100)}%)${result.noiseFlagged ? "  ← FLAG: reformat" : ""}`,
  );
  console.info(
    `  Type-Token Ratio: ${result.ttr}${(result.ttr ?? 1) < 0.35 ? "  ← low (repetitive)" : ""}`,
  );
  console.info(`  Redundancy Score: ${result.redundancyScore}`);
  printSimilarityFlags(result);
  printPareto({ result, content });
}

function printAdaptiveAdvisory({
  label,
  results,
  hardThreshold,
}: {
  label: string;
  results: FileResult[];
  hardThreshold: number;
}): void {
  if (results.length < 3) return;
  const tokenCounts = results.map((r) => r.tokens);
  const adaptive = adaptiveThreshold(tokenCounts);
  if (adaptive <= 0 || adaptive >= hardThreshold) return;
  const p95val = percentile(tokenCounts, 95);
  const cv = coefficientOfVariation(tokenCounts);
  const cvTag = cv > 0.5 ? "  ← uneven (high CV)" : "";
  console.info(
    `  ${label}: p95 ${p95val} tokens  adaptive outlier line ${adaptive}  CV ${cv.toFixed(2)}${cvTag}`,
  );
}

interface GroupInReport {
  view: GroupView;
  entries: CheckedFile[];
  threshold: number;
}

function printGroup({ view, entries, threshold }: GroupInReport): void {
  if (entries.length === 0) return;
  const results = resultsOf(entries);
  printSection({ title: view.title, results });
  printAdaptiveAdvisory({ label: view.advisoryLabel, results, hardThreshold: threshold });
}

function printRoot({ root, normalBelow }: { root?: CheckedFile; normalBelow: number }): void {
  if (!root) return;
  printSection({ title: "Root (always loaded):", results: [root.result] });
  if (root.result.ratio >= normalBelow) printPareto(root);
}

function printDeadRefs(deadRefs: string[]): void {
  if (deadRefs.length === 0) return;
  console.info(`\n⚠ Dead references (${deadRefs.length}):`);
  for (const r of deadRefs) console.info(`  × ${r}`);
}

function printOrphans({ orphans, rootFile }: { orphans: string[]; rootFile: string }): void {
  if (orphans.length === 0) return;
  console.info(`\n⚠ Orphaned planning files not referenced in ${rootFile} (${orphans.length}):`);
  for (const o of orphans) console.info(`  ? ${o}`);
}

function printSimilarity(pairs: SimilarityPair[]): void {
  if (pairs.length === 0) return;
  console.info(`\n=== Similarity Report ===`);
  for (const p of pairs) {
    const icon = p.flag === "duplication" ? "✗" : "~";
    console.info(
      `  ${icon} ${p.flag.toUpperCase().padEnd(16)} J=${p.jaccard.toFixed(2)}  ${p.fileA}  ↔  ${p.fileB}`,
    );
  }
}

function printRootSummary(root: CheckedFile | undefined): void {
  if (!root) return;
  const { result } = root;
  const pct = Math.round(result.ratio * 100);
  console.info(
    `  Root:       ${result.tokens.toLocaleString()} / ${result.threshold.toLocaleString()} tokens  ${bar(result.ratio)}  ${pct}%  ${HEALTH_LABEL[result.health]}`,
  );
}

function printGroupSummary({
  view,
  entries,
  threshold,
  health,
}: GroupInReport & { health: Config["health"] }): void {
  if (entries.length === 0) return;
  const tokenCounts = resultsOf(entries).map((r) => r.tokens);
  const p95val = percentile(tokenCounts, 95);
  const p95ratio = p95val / threshold;
  const pct = Math.round(p95ratio * 100);
  const cv = coefficientOfVariation(tokenCounts);
  const label = HEALTH_LABEL[toHealth({ ratio: p95ratio, ...health })];
  console.info(
    `  ${view.summaryLabel.padEnd(12)}p95 ${p95val} / ${threshold} tokens  ${bar(p95ratio)}  ${pct}%  ${label}  CV=${cv.toFixed(2)}`,
  );
}

function printThresholds(health: Config["health"]): void {
  const goodPct = Math.round(health.goodBelow * 100);
  const normalPct = Math.round(health.normalBelow * 100);
  console.info(
    `\n  Thresholds:  GOOD ≤ ${goodPct}%  |  NORMAL ≤ ${normalPct}%  |  WARNING ≤ 100%  |  BAD > 100%`,
  );
}

export function printDeadRefWarnings({
  deadRefs,
  rootFile,
}: {
  deadRefs: string[];
  rootFile: string;
}): void {
  for (const ref of deadRefs) {
    console.warn(`⚠ ${ref}: not found (dead reference in ${rootFile})`);
  }
}

export function printJson({ report }: { report: BudgetReport }): void {
  const payload = {
    root: report.groups.root[0]?.result,
    references: resultsOf(report.groups.reference),
    subdir: resultsOf(report.groups.subdir),
    similarityPairs: report.pairs,
    orphans: report.orphans,
    deadRefs: report.deadRefs,
  };
  console.info(JSON.stringify(payload, null, 2));
}

export function printHumanReport({
  report,
  config,
}: {
  report: BudgetReport;
  config: Config;
}): void {
  const { health } = config;
  const [root] = report.groups.root;
  const references = {
    view: REFERENCE_VIEW,
    entries: report.groups.reference,
    threshold: config.references.threshold,
  };
  const subdir = {
    view: SUBDIR_VIEW,
    entries: report.groups.subdir,
    threshold: config.subdir.threshold,
  };
  console.info("=== CLAUDE.md Token Budget ===");
  printRoot({ root, normalBelow: health.normalBelow });
  printGroup(references);
  printGroup(subdir);
  printDeadRefs(report.deadRefs);
  printOrphans({ orphans: report.orphans, rootFile: config.root.file });
  printSimilarity(report.pairs);

  console.info("\n=== Health Summary ===");
  printRootSummary(root);
  printGroupSummary({ ...references, health });
  printGroupSummary({ ...subdir, health });
  printThresholds(health);
  console.info(VERDICT[report.exitCode]);
}
