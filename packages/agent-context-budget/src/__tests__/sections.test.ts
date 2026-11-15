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
