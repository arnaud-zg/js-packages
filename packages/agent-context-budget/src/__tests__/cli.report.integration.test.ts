import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let originalCwd: string;
let infoLines: string[];

async function runCli(args: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ["node", "cli.js", "check", ...args];
  await import("../cli");
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(tmpDir, file)), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, file), content);
}

function output(): string[] {
  return infoLines.flatMap((line) => line.split("\n"));
}

// A repository with every kind of finding: a root over budget, references of uneven size, two
// identical subdirectory files, a dead reference and an orphaned planning doc.
function writeRepositoryWithEveryFinding(): void {
  let root = "# Root\n\nIntro words here.\n\n";
  for (let i = 1; i <= 7; i++) {
    root += `## Part ${i}\n\n${"Alpha beta gamma delta epsilon zeta eta theta. ".repeat(i * 2)}\n\n`;
  }
  root +=
    "See `.planning/codebase/ONE.md`, `.planning/codebase/TWO.md`, `.planning/codebase/THREE.md`, " +
    "`.planning/codebase/BIG.md` and `.planning/codebase/GONE.md`.\n";
  write("CLAUDE.md", root);
  write(
    ".planning/codebase/ONE.md",
    `# One\n\n${"Some short reference text about things. ".repeat(3)}`,
  );
  write(
    ".planning/codebase/TWO.md",
    `# Two\n\n${"Another short reference text about items. ".repeat(3)}`,
  );
  write(
    ".planning/codebase/THREE.md",
    `# Three\n\n${"Yet more reference text about stuff here. ".repeat(3)}`,
  );
  write(
    ".planning/codebase/BIG.md",
    `# Big\n\n${"Large reference doc sentence number one keeps going. ".repeat(60)}`,
  );
  write(".planning/codebase/STRAY.md", "# Stray\n\nNot linked.");
  const duplicated = Array.from(
    { length: 20 },
    (_, i) => `Agents read this file at start of session ${"x".repeat(i + 2)}.`,
  ).join("\n");
  write("packages/a/CLAUDE.md", duplicated);
  write("packages/b/CLAUDE.md", duplicated);
  write(
    "agent-context-budget.config.json",
    JSON.stringify({
      root: { threshold: 500 },
      references: { threshold: 880 },
      subdir: { threshold: 400 },
    }),
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-budget-report-test-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  infoLines = [];
  vi.spyOn(console, "info").mockImplementation((line: string) => {
    infoLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("the human-readable budget report", () => {
  it("given a repository with every kind of finding, when checked, then each file is listed with its tokens, bar, share and health", async () => {
    writeRepositoryWithEveryFinding();

    await runCli([]);

    expect(output()).toEqual(
      expect.arrayContaining([
        "=== CLAUDE.md Token Budget ===",
        "Root (always loaded):",
        "  ✗ CLAUDE.md                                              742 tokens  ██████████  148%  BAD ⚠ redundant",
        "Reference docs (on-demand):",
        "  ⚠ .planning/codebase/BIG.md                              798 tokens  █████████░  91%  WARNING ⚠ redundant",
        "  ✓ .planning/codebase/ONE.md                               33 tokens  ░░░░░░░░░░  4%  GOOD",
        "  ✓ .planning/codebase/THREE.md                             36 tokens  ░░░░░░░░░░  4%  GOOD",
        "  ✓ .planning/codebase/TWO.md                               35 tokens  ░░░░░░░░░░  4%  GOOD",
        "Subdirectory CLAUDE.md (context-sensitive):",
        "  ~ packages/a/CLAUDE.md                                   278 tokens  ███████░░░  70%  NORMAL ⚠ redundant",
        "  ~ packages/b/CLAUDE.md                                   278 tokens  ███████░░░  70%  NORMAL ⚠ redundant",
      ]),
    );
    expect(process.exitCode).toBe(1);
  });

  it("given a root file past the normal band, when checked, then its five largest sections are listed largest first and the rest summed", async () => {
    writeRepositoryWithEveryFinding();

    await runCli([]);

    const lines = output();
    const start = lines.indexOf("  Pareto breakdown — CLAUDE.md");
    expect(lines.slice(start, start + 7)).toEqual([
      "  Pareto breakdown — CLAUDE.md",
      "      ## Part 7                                       204 tokens  27%  ← EXTRACT",
      "      ## Part 6                                       142 tokens  19%",
      "      ## Part 5                                       118 tokens  16%",
      "      ## Part 4                                        95 tokens  13%",
      "      ## Part 3                                        71 tokens  10%",
      "    … 3 more sections — 77 tokens combined",
    ]);
  });

  it("given references of uneven size, when checked, then the advisory names their p95, the adaptive outlier line and the high spread", async () => {
    writeRepositoryWithEveryFinding();

    await runCli([]);

    expect(output()).toContain(
      "  Refs: p95 798 tokens  adaptive outlier line 38  CV 1.47  ← uneven (high CV)",
    );
  });

  it("given a dead reference, an orphan and two identical files, when checked, then each gets its own section", async () => {
    writeRepositoryWithEveryFinding();

    await runCli([]);

    expect(output()).toEqual(
      expect.arrayContaining([
        "⚠ Dead references (1):",
        "  × .planning/codebase/GONE.md",
        "⚠ Orphaned planning files not referenced in CLAUDE.md (1):",
        "  ? .planning/codebase/STRAY.md",
        "=== Similarity Report ===",
        "  ✗ DUPLICATION      J=1.00  packages/a/CLAUDE.md  ↔  packages/b/CLAUDE.md",
      ]),
    );
  });

  it("given a repository with every kind of finding, when checked, then the health summary rates the root and each group's p95 and ends on the verdict", async () => {
    writeRepositoryWithEveryFinding();

    await runCli([]);

    const lines = output();
    const start = lines.indexOf("=== Health Summary ===");
    expect(lines.slice(start)).toEqual([
      "=== Health Summary ===",
      "  Root:       742 / 500 tokens  ██████████  148%  BAD",
      "  References: p95 798 / 880 tokens  █████████░  91%  WARNING  CV=1.47",
      "  Subdir:     p95 278 / 400 tokens  ███████░░░  70%  NORMAL  CV=0.00",
      "",
      "  Thresholds:  GOOD ≤ 60%  |  NORMAL ≤ 85%  |  WARNING ≤ 100%  |  BAD > 100%",
      "",
      "✗ Token budget exceeded.",
    ]);
  });

  it("given only advisories and no file over budget, when checked, then it exits 2 with the advisory verdict", async () => {
    write("CLAUDE.md", "# Root\n\nSee `.planning/codebase/GONE.md` for details.");

    await runCli([]);

    expect(process.exitCode).toBe(2);
    expect(output().at(-1)).toBe(
      "~ Advisory: optimization opportunities detected (see above). Exit 2.",
    );
  });

  it("given a root file within the normal band, when checked, then no Pareto breakdown is printed", async () => {
    write("CLAUDE.md", "# Small\n\n## Part\n\nJust a few words.");

    await runCli([]);

    expect(output().some((line) => line.includes("Pareto breakdown"))).toBe(false);
    expect(output()).toContain(
      "  ✓ CLAUDE.md                                               12 tokens  ░░░░░░░░░░  0%  GOOD",
    );
  });

  it("given three references of even size, when checked, then the advisory shows no uneven-spread warning", async () => {
    write(
      "CLAUDE.md",
      "# Root\n\nSee `.planning/codebase/A.md`, `.planning/codebase/B.md`, `.planning/codebase/C.md`.",
    );
    for (const name of ["A", "B", "C"]) {
      write(`.planning/codebase/${name}.md`, `# ${name}\n\nSome reference text about ${name}.`);
    }

    await runCli([]);

    expect(output()).toContain("  Refs: p95 9 tokens  adaptive outlier line 9  CV 0.00");
  });
});

describe("finding the context files on disk", () => {
  it("given subdirectory files, a non-markdown planning file and a referenced folder, when checked as JSON, then only readable markdown files are reported, sorted", async () => {
    write("CLAUDE.md", "# Root\n\nSee `.planning/codebase/folder.md` for details.");
    fs.mkdirSync(path.join(tmpDir, ".planning/codebase/folder.md"), { recursive: true });
    write(".planning/codebase/notes.txt", "not markdown");
    write(".planning/codebase/stray.md", "# Stray\n\nNot linked.");
    write("packages/zeta/CLAUDE.md", "# Zeta\n\nZeta words.");
    write("packages/alpha/CLAUDE.md", "# Alpha\n\nAlpha words.");
    write("packages/empty/README.md", "# No context file here");
    write("apps/web/CLAUDE.md", "# Web\n\nWeb words.");

    await runCli(["--json"]);

    const payload = JSON.parse(infoLines[0] ?? "") as {
      references: { path: string }[];
      subdir: { path: string }[];
      orphans: string[];
      deadRefs: string[];
    };
    expect(payload.references).toEqual([]);
    expect(payload.deadRefs).toEqual([]);
    expect(payload.orphans).toEqual([".planning/codebase/stray.md"]);
    expect(payload.subdir.map((r) => r.path)).toEqual([
      "apps/web/CLAUDE.md",
      "packages/alpha/CLAUDE.md",
      "packages/zeta/CLAUDE.md",
    ]);
  });
});

describe("the detailed report of one file", () => {
  it("given a file duplicated in another folder, when explained, then its metrics, similarity flag and sections are printed", async () => {
    writeRepositoryWithEveryFinding();

    await runCli(["--explain", "packages/b/CLAUDE.md"]);

    expect(output()).toEqual([
      "",
      "=== Detailed report: packages/b/CLAUDE.md ===",
      "  Tokens: 278 / 400  ███████░░░  70%  NORMAL",
      "  Gzip ratio:       0.093  (shrink)",
      "  Structural noise: 0 tokens (0%)",
      "  Type-Token Ratio: 0.156  ← low (repetitive)",
      "  Redundancy Score: 0.809",
      "  Similarity flags:",
      "    DUPLICATION      J=1.00  vs  packages/a/CLAUDE.md",
      "",
      "  Pareto breakdown — packages/b/CLAUDE.md",
      "     (preamble)                                     278 tokens  100%",
    ]);
  });

  it("given a file padded with rules, comments and table separators, when explained, then the structural noise is flagged for reformatting", async () => {
    const noisy = [
      "# Noisy",
      "",
      "Plain words about the project and its layout.",
      "",
      "---",
      "",
      "<!-- a comment nobody reads -->",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "",
      "",
      "Varied unique vocabulary keeps repetition low here.",
    ].join("\n");
    write("CLAUDE.md", noisy);

    await runCli(["--explain", "CLAUDE.md"]);

    expect(output()).toEqual(
      expect.arrayContaining([
        "  Tokens: 55 / 3,500  ░░░░░░░░░░  2%  GOOD",
        "  Gzip ratio:       0.857  (dense)",
        "  Structural noise: 24 tokens (44%)  ← FLAG: reformat",
        "  Type-Token Ratio: 1",
        "  Redundancy Score: 0.12",
      ]),
    );
  });
});
