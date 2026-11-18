import { describe, expect, it } from "vitest";

import { computePareto, parseSections } from "../sections";

describe("parseSections", () => {
  it("splits markdown into heading-delimited sections", () => {
    const md = `# Heading 1\n\nSome text here.\n\n## Heading 2\n\nMore text.\n`;
    const sections = parseSections(md);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.some((s) => s.heading === "Heading 1")).toBe(true);
    expect(sections.some((s) => s.heading === "Heading 2")).toBe(true);
  });

  it("assigns token counts to each section", () => {
    const md = `# Big Section\n\n${"word ".repeat(100)}\n\n## Small\n\nHi.\n`;
    const sections = parseSections(md);
    const big = sections.find((s) => s.heading === "Big Section");
    const small = sections.find((s) => s.heading === "Small");
    expect(big?.tokens).toBeGreaterThan(small?.tokens ?? Infinity);
  });

  it("does not split on headings inside code fences", () => {
    const md = `# Real Heading\n\n\`\`\`md\n# Fake Heading\n\`\`\`\n`;
    const sections = parseSections(md);
    expect(sections.some((s) => s.heading === "Fake Heading")).toBe(false);
    expect(sections.some((s) => s.heading === "Real Heading")).toBe(true);
  });

  it("records section heading levels", () => {
    const md = `# H1\n\ntext\n\n## H2\n\nmore text\n`;
    const sections = parseSections(md);
    expect(sections.find((s) => s.heading === "H1")?.level).toBe(1);
    expect(sections.find((s) => s.heading === "H2")?.level).toBe(2);
  });
});

describe("computePareto", () => {
  it("flags sections that account for ≥20% of file tokens when file is ≥85% full", () => {
    const sections = [
      { heading: "Big", level: 1, tokens: 800 },
      { heading: "Medium", level: 2, tokens: 200 },
      { heading: "Small", level: 2, tokens: 100 },
    ];
    const fileTokens = 1100;
    const fileRatio = 0.95; // over 85%
    const pareto = computePareto(sections, fileTokens, fileRatio);
    const big = pareto.find((p) => p.heading === "Big");
    expect(big?.flagExtract).toBe(true);
    expect(pareto.find((p) => p.heading === "Small")?.flagExtract).toBe(false);
  });

  it("does NOT flag when file ratio is below 85%", () => {
    const sections = [{ heading: "Big", level: 1, tokens: 800 }];
    const pareto = computePareto(sections, 1000, 0.5);
    expect(pareto[0]?.flagExtract).toBe(false);
  });

  it("sorts sections by token count descending", () => {
    const sections = [
      { heading: "Small", level: 2, tokens: 100 },
      { heading: "Big", level: 1, tokens: 900 },
    ];
    const pareto = computePareto(sections, 1000, 0.9);
    expect(pareto[0]?.heading).toBe("Big");
  });

  it("computes percentage of file for each section", () => {
    const sections = [{ heading: "Half", level: 1, tokens: 500 }];
    const pareto = computePareto(sections, 1000, 0.5);
    expect(pareto[0]?.pct).toBeCloseTo(0.5);
  });
});

describe("splitting a file into sections", () => {
  it("given text before the first heading, when parsed, then it forms a level-0 preamble section ahead of the headings", () => {
    const md = "Intro line.\n# One\nBody one.\n## Two words\nBody two.";

    expect(parseSections(md)).toEqual([
      { heading: "(preamble)", level: 0, tokens: 3 },
      { heading: "One", level: 1, tokens: 3 },
      { heading: "Two words", level: 2, tokens: 3 },
    ]);
  });

  it("given a file that opens on a heading, when parsed, then no empty preamble section is added", () => {
    expect(parseSections("# Only\nBody.").map((s) => s.heading)).toEqual(["Only"]);
  });

  it("given an indented heading, when parsed, then it still starts a section", () => {
    expect(parseSections("  ## Indented  \nBody.").map((s) => s.heading)).toEqual(["Indented"]);
  });

  it("given inline backticks, a tilde mid-line and a hash mid-line, when parsed, then none opens a fence or a section", () => {
    const md = "# Start\nsee ```x``` here\na ~~~ b\nsee # x\n## End\nBody.";

    expect(parseSections(md).map((s) => s.heading)).toEqual(["Start", "End"]);
  });
});

describe("ranking sections for extraction", () => {
  it("given a section of exactly 20% in a file exactly 85% full, when ranked, then it is flagged for extraction", () => {
    const pareto = computePareto([{ heading: "Fifth", level: 1, tokens: 20 }], 100, 0.85);

    expect(pareto).toEqual([
      { heading: "Fifth", level: 1, tokens: 20, pct: 0.2, flagExtract: true },
    ]);
  });

  it("given a section just under 20% in a full file, when ranked, then it is not flagged", () => {
    const pareto = computePareto([{ heading: "Small", level: 1, tokens: 19 }], 100, 0.95);

    expect(pareto[0]?.flagExtract).toBe(false);
  });

  it("given a file of zero tokens, when ranked, then shares are 0 and nothing is flagged", () => {
    const pareto = computePareto([{ heading: "Empty", level: 1, tokens: 0 }], 0, 1);

    expect(pareto).toEqual([{ heading: "Empty", level: 1, tokens: 0, pct: 0, flagExtract: false }]);
  });
});
