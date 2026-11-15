import { describe, expect, it } from "vitest";

import type { ContextFiles } from "../contextFiles.ports";
import { budgetReport } from "../budgetReport";
import { ConfigSchema } from "../config";

const PROSE =
  "Agents read this file at the start of every session to learn how the repository is laid out.";

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

describe("budgetReport", () => {
  it("given a root file within budget and nothing else, when reported, then it exits 0", () => {
    const report = budgetReport({ config, rootContent: PROSE, files: inMemoryFiles({}) });

    expect(report.exitCode).toBe(0);
    expect(report.groups.root.map(({ result }) => result.status)).toEqual(["ok"]);
  });

  it("given a root file over its threshold, when reported, then it fails with exit 1", () => {
    const tight = ConfigSchema.parse({ root: { threshold: 5 } });

    const report = budgetReport({ config: tight, rootContent: PROSE, files: inMemoryFiles({}) });

    expect(report.exitCode).toBe(1);
    expect(report.groups.root[0]?.result.status).toBe("error");
  });

  it("given a reference to a missing doc, when reported, then it lists the dead ref and exits 2", () => {
    const rootContent = `${PROSE}\nSee \`docs/gone.md\`.`;

    const report = budgetReport({ config, rootContent, files: inMemoryFiles({}) });

    expect(report.deadRefs).toEqual(["docs/gone.md"]);
    expect(report.exitCode).toBe(2);
  });

  it("given a planning doc the root never links, when reported, then it is an orphan and exits 2", () => {
    const files = inMemoryFiles({}, ["docs/orphan.md"]);

    const report = budgetReport({ config, rootContent: PROSE, files });

    expect(report.orphans).toEqual(["docs/orphan.md"]);
    expect(report.exitCode).toBe(2);
  });

  it("given two identical subdirectory files, when reported, then both carry the duplication flag", () => {
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
});
