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

function extractReferences(content: string, referencePattern: string): string[] {
  const pattern = new RegExp(referencePattern, "g");
  const refs = [...content.matchAll(pattern)]
    .map((m) => m[1])
    .filter((ref): ref is string => ref !== undefined);
  return [...new Set(refs)];
}

function readable(files: ContextFiles, group: Group, paths: string[], budget: Budget): Candidate[] {
  return paths
    .map((path) => ({ group, path, content: files.read(path) ?? "", ...budget }))
    .filter((candidate) => candidate.content !== "");
}

function checkFile(
  path: string,
  content: string,
  threshold: number,
  failOnExceed: boolean,
  config: Config,
): FileResult {
  const metrics = analyzeFile(content, {
    threshold,
    goodBelow: config.health.goodBelow,
    normalBelow: config.health.normalBelow,
  });
  const status = metrics.health === "bad" ? (failOnExceed ? "error" : "warn") : "ok";
  return { ...metrics, path, status };
}

function similarityFlagsFor(
  pairs: SimilarityPair[],
  path: string,
): NonNullable<FileResult["similarityFlags"]> {
  return pairs.flatMap((pair) => [
    ...(pair.fileA === path ? [{ other: pair.fileB, jaccard: pair.jaccard, flag: pair.flag }] : []),
    ...(pair.fileB === path ? [{ other: pair.fileA, jaccard: pair.jaccard, flag: pair.flag }] : []),
  ]);
}

// A path listed twice keeps one result per path, the last, as the original Map lookup did.
function withSimilarityFlags(entries: CheckedFile[], pairs: SimilarityPair[]): CheckedFile[] {
  const lastIndexByPath = new Map(entries.map((entry, index) => [entry.result.path, index]));
  return entries.map((entry, index) => {
    const flags = similarityFlagsFor(pairs, entry.result.path);
    if (lastIndexByPath.get(entry.result.path) !== index || flags.length === 0) return entry;
    return { ...entry, result: { ...entry.result, similarityFlags: flags } };
  });
}

function exitCodeFor(
  results: FileResult[],
  similarPairs: SimilarityPair[],
  orphans: string[],
  deadRefs: string[],
): ExitCode {
  if (results.some((r) => r.status === "error")) return 1;
  const hasAdvisory =
    results.some((r) => r.noiseFlagged || r.redundancyLevel === "shrink") ||
    similarPairs.some((p) => p.flag === "duplication") ||
    orphans.length > 0 ||
    deadRefs.length > 0;
  return hasAdvisory ? 2 : 0;
}

function inGroup(entries: CheckedFile[], group: Group): CheckedFile[] {
  return entries.filter((entry) => entry.group === group);
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
  const refs = extractReferences(rootContent, config.root.referencePattern).sort();
  const candidates: Candidate[] = [
    {
      group: "root",
      path: config.root.file,
      content: rootContent,
      threshold: config.root.threshold,
      failOnExceed: true,
    },
    ...readable(files, "reference", refs, config.references),
    ...readable(files, "subdir", files.claudeMdUnder(config.subdir.dirs), config.subdir),
  ];
  const deadRefs = refs.filter((ref) => !files.exists(ref));
  const orphans = files.markdownIn(config.planningDir).filter((file) => !refs.includes(file));
  const pairs = findSimilarFiles(candidates.map(({ path, content }) => ({ path, content })));
  const checked = candidates.map(({ group, path, content, threshold, failOnExceed }) => ({
    group,
    result: checkFile(path, content, threshold, failOnExceed, config),
    content,
  }));
  const entries = withSimilarityFlags(checked, pairs);
  return {
    groups: {
      root: inGroup(entries, "root"),
      reference: inGroup(entries, "reference"),
      subdir: inGroup(entries, "subdir"),
    },
    pairs,
    orphans,
    deadRefs,
    exitCode: exitCodeFor(
      entries.map(({ result }) => result),
      pairs,
      orphans,
      deadRefs,
    ),
  };
}

/** The file `--explain` names; the last one when a path was listed twice. */
export function checkedFileAt(report: BudgetReport, path: string): CheckedFile | undefined {
  const entries = [...report.groups.root, ...report.groups.reference, ...report.groups.subdir];
  return entries.reverse().find((entry) => entry.result.path === path);
}
