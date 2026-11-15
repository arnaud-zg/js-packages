import { describe, expect, it } from "vitest";

import { estimateTokens } from "../tokenEstimate";

describe("estimateTokens", () => {
  it("counts prose at ~1 token per 4 chars", () => {
    const prose = "This is a normal English sentence without any special markdown.";
    const tokens = estimateTokens(prose);
    // 63 chars / 4.0 ≈ 16 tokens — allow ±20% tolerance
    expect(tokens).toBeGreaterThan(12);
    expect(tokens).toBeLessThan(20);
  });

  it("counts code blocks at a higher token rate than equivalent prose", () => {
    const codeBlock =
      "```typescript\nconst x: Record<string, number> = {};\nconst y = x['key'] ?? 0;\n```";
    const equivalentProse = "the quick brown fox jumps over the lazy dog and then some";
    expect(estimateTokens(codeBlock)).toBeGreaterThan(estimateTokens(equivalentProse));
  });

  it("counts table rows at higher rate than prose", () => {
    const table =
      "| Column A | Column B | Column C |\n| -------- | -------- | -------- |\n| value 1  | value 2  | value 3  |";
    const prose = "Column A Column B Column C value one value two value three";
    // same chars, table should cost more per char
    expect(estimateTokens(table) / table.length).toBeGreaterThan(
      estimateTokens(prose) / prose.length,
    );
  });

  it("counts headings as structural", () => {
    const headings = "# Title\n## Section\n### Subsection\n";
    const tokens = estimateTokens(headings);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(20);
  });

  it("returns more tokens for identical text in code vs prose context", () => {
    const content = "```\nfoo bar baz qux\n```";
    const prose = "foo bar baz qux";
    expect(estimateTokens(content)).toBeGreaterThan(estimateTokens(prose));
  });
});
