import { describe, expect, it } from "vitest";

import type { ContextFiles } from "../contextFiles.ports";
import { budgetReport, checkedFileAt } from "../budgetReport";
import { ConfigSchema } from "../config";

const PROSE =
  "Agents read this file at the start of every session to learn how the repository is laid out.";

// Distinct letter-only words, so prose built from them neither repeats nor compresses well.
const VOCABULARY = Array.from(
  { length: 110 },
  (_, i) =>
    `w${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}x`,
);

function inMemoryFiles(contents: Record<string, string>, planning: string[] = []): ContextFiles {
  return {
    read: (path) => contents[path] ?? null,
    exists: (path) => path in contents,
    claudeMdUnder: (dirs) =>
      Object.keys(contents)
        .filter((path) => dirs.some((dir) => path.startsWith(`${dir}/`)))
        .sort(),
    markdownIn: () => planning,
  };
}

const config = ConfigSchema.parse({ root: { referencePattern: "`(docs/[^`]+\\.md)`" } });

describe("checking a repository's context files against their budgets", () => {
  it("given a root file within budget and nothing else, when the repository is checked, then the run passes", () => {
    const report = budgetReport({ config, rootContent: PROSE, files: inMemoryFiles({}) });

    expect(report.exitCode).toBe(0);
    expect(report.groups.root.map(({ result }) => result.status)).toEqual(["ok"]);
  });

  it("given a root file over its budget, when the repository is checked, then the run fails", () => {
    const tight = ConfigSchema.parse({ root: { threshold: 5 } });

    const report = budgetReport({ config: tight, rootContent: PROSE, files: inMemoryFiles({}) });

    expect(report.exitCode).toBe(1);
    expect(report.groups.root[0]?.result.status).toBe("error");
  });

  it("given the root links a doc that does not exist, when the repository is checked, then the dead link is raised as an advisory", () => {
    const rootContent = `${PROSE}\nSee \`docs/gone.md\`.`;

    const report = budgetReport({ config, rootContent, files: inMemoryFiles({}) });

    expect(report.deadRefs).toEqual(["docs/gone.md"]);
    expect(report.exitCode).toBe(2);
  });

  it("given a planning doc the root never links, when the repository is checked, then it is raised as an orphan advisory", () => {
    const files = inMemoryFiles({}, ["docs/orphan.md"]);

    const report = budgetReport({ config, rootContent: PROSE, files });

    expect(report.orphans).toEqual(["docs/orphan.md"]);
    expect(report.exitCode).toBe(2);
  });

  it("given two identical subdirectory files, when the repository is checked, then each is flagged as a duplicate of the other", () => {
    const long = Array.from({ length: 20 }, (_, i) => `${PROSE} Section ${"x".repeat(i + 2)}.`);
    const files = inMemoryFiles({
      "packages/a/CLAUDE.md": long.join("\n"),
      "packages/b/CLAUDE.md": long.join("\n"),
    });

    const report = budgetReport({ config, rootContent: PROSE, files });

    expect(report.pairs.map((pair) => pair.flag)).toEqual(["duplication"]);
    expect(report.groups.subdir.map(({ result }) => result.similarityFlags?.[0]?.other)).toEqual([
      "packages/b/CLAUDE.md",
      "packages/a/CLAUDE.md",
    ]);
    expect(report.exitCode).toBe(2);
  });

  it("given the root links missing docs twice and out of order, when the repository is checked, then each dead link is listed once, sorted", () => {
    const rootContent = `${PROSE}\nSee \`docs/z.md\`, \`docs/b.md\`, \`docs/a.md\` and \`docs/b.md\`.`;
    const files = inMemoryFiles({ "docs/z.md": PROSE });

    const report = budgetReport({ config, rootContent, files });

    expect(report.deadRefs).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("given the root links one planning doc and not another, when the repository is checked, then only the unlinked one is an orphan", () => {
    const rootContent = `${PROSE}\nSee \`docs/linked.md\`.`;
    const files = inMemoryFiles({ "docs/linked.md": PROSE }, ["docs/linked.md", "docs/stray.md"]);

    const report = budgetReport({ config, rootContent, files });

    expect(report.orphans).toEqual(["docs/stray.md"]);
  });

  it("given a reference pattern without a capture group, when the repository is checked, then no link is followed and the run passes", () => {
    const noGroup = ConfigSchema.parse({ root: { referencePattern: "docs/[a-z]+\\.md" } });

    const report = budgetReport({
      config: noGroup,
      rootContent: `${PROSE}\nSee docs/gone.md.`,
      files: inMemoryFiles({}),
    });

    expect(report.deadRefs).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("given a linked doc over its budget, when the repository is checked, then it only warns and the run still passes", () => {
    const tightRefs = ConfigSchema.parse({
      root: { referencePattern: "`(docs/[^`]+\\.md)`" },
      references: { threshold: 5 },
    });
    const rootContent = `${PROSE}\nSee \`docs/long.md\`.`;

    const report = budgetReport({
      config: tightRefs,
      rootContent,
      files: inMemoryFiles({ "docs/long.md": VOCABULARY.slice(0, 20).join(" ") }),
    });

    expect(report.groups.reference.map(({ result }) => result.status)).toEqual(["warn"]);
    expect(report.exitCode).toBe(0);
  });

  it("given a root file thick with table separators, when the repository is checked, then the formatting noise alone raises an advisory", () => {
    const noisy = `${PROSE}\n${"|---|---|\n".repeat(10)}`;

    const report = budgetReport({ config, rootContent: noisy, files: inMemoryFiles({}) });

    expect(report.groups.root[0]?.result.noiseFlagged).toBe(true);
    expect(report.exitCode).toBe(2);
  });

  it("given two identical files of varied prose, when the repository is checked, then the duplication alone raises an advisory", () => {
    const varied = VOCABULARY.slice(0, 80).join(" ");
    const files = inMemoryFiles({ "packages/a/CLAUDE.md": varied, "packages/b/CLAUDE.md": varied });

    const report = budgetReport({ config, rootContent: PROSE, files });

    expect(report.groups.subdir.map(({ result }) => result.redundancyLevel)).not.toContain(
      "shrink",
    );
    expect(report.pairs.map((pair) => pair.flag)).toEqual(["duplication"]);
    expect(report.exitCode).toBe(2);
  });

  it("given two files sharing only part of their prose, when the repository is checked, then they are suggested for merging and the run passes", () => {
    const a = VOCABULARY.slice(0, 80).join(" ");
    const b = [...VOCABULARY.slice(0, 50), ...VOCABULARY.slice(80, 110)].join(" ");
    const files = inMemoryFiles({ "packages/a/CLAUDE.md": a, "packages/b/CLAUDE.md": b });

    const report = budgetReport({ config, rootContent: PROSE, files });

    expect(report.pairs.map((pair) => pair.flag)).toEqual(["merge-candidate"]);
    expect(report.exitCode).toBe(0);
  });

  it("given a subdirectory file the root also links, when its detailed report is looked up, then it shows the subdirectory budget and its duplicate", () => {
    const linking = ConfigSchema.parse({
      root: { referencePattern: "`(packages/[^`]+\\.md)`" },
      references: { threshold: 1000 },
      subdir: { threshold: 3000 },
    });
    const varied = VOCABULARY.slice(0, 80).join(" ");
    const files = inMemoryFiles({ "packages/a/CLAUDE.md": varied, "packages/b/CLAUDE.md": varied });
    const rootContent = `${PROSE}\nSee \`packages/b/CLAUDE.md\`.`;

    const report = budgetReport({ config: linking, rootContent, files });
    const target = checkedFileAt({ report, path: "packages/b/CLAUDE.md" });

    expect(target?.group).toBe("subdir");
    expect(target?.result.threshold).toBe(3000);
    expect(report.groups.reference[0]?.result.similarityFlags).toBeUndefined();
    expect(target?.result.similarityFlags?.map((flag) => flag.other)).toContain(
      "packages/a/CLAUDE.md",
    );
  });
});
