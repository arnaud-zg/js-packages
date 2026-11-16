import type { FileResult } from "./analyzeFile";
import type { Config } from "./config";
import type { ContextFiles } from "./contextFiles.ports";
import type { SimilarityPair } from "./similarity";
import { analyzeFile } from "./analyzeFile";
import { findSimilarFiles } from "./similarity";

export type Group = "root" | "reference" | "subdir";
export type ExitCode = 0 | 1 | 2;

export interface CheckedFile {
  group: Group;
  result: FileResult;
  content: string;
}

export interface BudgetReport {
  groups: Record<Group, CheckedFile[]>;
  pairs: SimilarityPair[];
  orphans: string[];
  deadRefs: string[];
  exitCode: ExitCode;
}

interface Candidate {
  group: Group;
  path: string;
  content: string;
  threshold: number;
  failOnExceed: boolean;
}

interface Budget {
  threshold: number;
  failOnExceed: boolean;
}

function extractReferences({
  content,
  referencePattern,
}: {
  content: string;
  referencePattern: string;
}): string[] {
  const pattern = new RegExp(referencePattern, "g");
  const refs = [...content.matchAll(pattern)]
    .map((m) => m[1])
    .filter((ref): ref is string => ref !== undefined);
  return [...new Set(refs)];
}

function readable({
  files,
  group,
  paths,
  budget,
}: {
  files: ContextFiles;
  group: Group;
  paths: string[];
  budget: Budget;
}): Candidate[] {
  const { threshold, failOnExceed } = budget;
  return paths
    .map((path) => ({ group, path, content: files.read(path) ?? "", threshold, failOnExceed }))
    .filter((candidate) => candidate.content !== "");
}

function checkFile({ candidate, config }: { candidate: Candidate; config: Config }): FileResult {
  const { path, content, threshold, failOnExceed } = candidate;
  const metrics = analyzeFile(content, {
    threshold,
    goodBelow: config.health.goodBelow,
    normalBelow: config.health.normalBelow,
  });
  const status = metrics.health === "bad" ? (failOnExceed ? "error" : "warn") : "ok";
  return { ...metrics, path, status };
}

function similarityFlagsFor({
  pairs,
  path,
}: {
  pairs: SimilarityPair[];
  path: string;
}): NonNullable<FileResult["similarityFlags"]> {
  return pairs.flatMap((pair) => [
    ...(pair.fileA === path ? [{ other: pair.fileB, jaccard: pair.jaccard, flag: pair.flag }] : []),
    ...(pair.fileB === path ? [{ other: pair.fileA, jaccard: pair.jaccard, flag: pair.flag }] : []),
  ]);
}

// Flags land on the last entry for a path, the one `--explain` shows.
function withSimilarityFlags({
  entries,
  pairs,
}: {
  entries: CheckedFile[];
  pairs: SimilarityPair[];
}): CheckedFile[] {
  const lastIndexByPath = new Map(entries.map((entry, index) => [entry.result.path, index]));
  return entries.map((entry, index) => {
    const flags = similarityFlagsFor({ pairs, path: entry.result.path });
    if (lastIndexByPath.get(entry.result.path) !== index || flags.length === 0) return entry;
    return { ...entry, result: { ...entry.result, similarityFlags: flags } };
  });
}

function exitCodeFor({
  results,
  pairs,
  orphans,
  deadRefs,
}: {
  results: FileResult[];
  pairs: SimilarityPair[];
  orphans: string[];
  deadRefs: string[];
}): ExitCode {
  if (results.some((r) => r.status === "error")) return 1;
  const hasAdvisory =
    results.some((r) => r.noiseFlagged || r.redundancyLevel === "shrink") ||
    pairs.some((p) => p.flag === "duplication") ||
    orphans.length > 0 ||
    deadRefs.length > 0;
  return hasAdvisory ? 2 : 0;
}

function byGroup(entries: CheckedFile[]): Record<Group, CheckedFile[]> {
  const inGroup = (group: Group) => entries.filter((entry) => entry.group === group);
  return { root: inGroup("root"), reference: inGroup("reference"), subdir: inGroup("subdir") };
}

function candidatesFor({
  config,
  rootContent,
  refs,
  files,
}: {
  config: Config;
  rootContent: string;
  refs: string[];
  files: ContextFiles;
}): Candidate[] {
  const { root, references, subdir } = config;
  const subdirPaths = files.claudeMdUnder(subdir.dirs);
  return [
    {
      group: "root",
      path: root.file,
      content: rootContent,
      threshold: root.threshold,
      failOnExceed: true,
    },
    ...readable({ files, group: "reference", paths: refs, budget: references }),
    ...readable({ files, group: "subdir", paths: subdirPaths, budget: subdir }),
  ];
}

export function budgetReport({
  config,
  rootContent,
  files,
}: {
  config: Config;
  rootContent: string;
  files: ContextFiles;
}): BudgetReport {
  const { referencePattern } = config.root;
  const refs = extractReferences({ content: rootContent, referencePattern }).sort();
  const candidates = candidatesFor({ config, rootContent, refs, files });
  const deadRefs = refs.filter((ref) => !files.exists(ref));
  const orphans = files.markdownIn(config.planningDir).filter((file) => !refs.includes(file));
  const pairs = findSimilarFiles(candidates.map(({ path, content }) => ({ path, content })));
  const checked = candidates.map((candidate) => ({
    group: candidate.group,
    result: checkFile({ candidate, config }),
    content: candidate.content,
  }));
  const entries = withSimilarityFlags({ entries: checked, pairs });
  const results = entries.map(({ result }) => result);
  return {
    groups: byGroup(entries),
    pairs,
    orphans,
    deadRefs,
    exitCode: exitCodeFor({ results, pairs, orphans, deadRefs }),
  };
}

// The last match, as when a path was listed twice its last entry carries the similarity flags.
export function checkedFileAt({
  report,
  path,
}: {
  report: BudgetReport;
  path: string;
}): CheckedFile | undefined {
  const { root, reference, subdir } = report.groups;
  return [...root, ...reference, ...subdir].reverse().find((entry) => entry.result.path === path);
}
