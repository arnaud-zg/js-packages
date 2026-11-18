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

// Each line costs its length plus its newline, at the rate of its kind:
// prose 4 chars a token, code 2.8, structure (fences, tables, rules, headings) 2.2.
function repeatLines(count: number, line: string): string {
  return Array.from({ length: count }, () => line).join("\n");
}

describe("estimating what each kind of markdown line costs an agent", () => {
  it("given only horizontal rules, when estimated, then every rule costs its length plus newline at the structural rate", () => {
    expect(estimateTokens(repeatLines(22, "---"))).toBe(40);
  });

  it("given only headings, when estimated, then every heading costs its length plus newline at the structural rate", () => {
    expect(estimateTokens(repeatLines(22, "## H"))).toBe(50);
  });

  it("given only table rows, when estimated, then a row opening with a pipe costs the structural rate", () => {
    expect(estimateTokens(repeatLines(22, "| a"))).toBe(40);
  });

  it("given a fenced code block, when estimated, then its lines cost the code rate and its fences the structural rate", () => {
    const block = ["```", repeatLines(28, "abcdefghi"), "```"].join("\n");

    expect(estimateTokens(block)).toBe(104);
  });

  it("given an indented tilde fence, when estimated, then it still opens and closes a code block", () => {
    const block = ["  ~~~", repeatLines(28, "abcdefghi"), "  ~~~"].join("\n");

    expect(estimateTokens(block)).toBe(105);
  });

  it("given lines holding only spaces, when estimated, then each costs one character of prose", () => {
    expect(estimateTokens(repeatLines(20, "    "))).toBe(5);
  });

  it("given lines that only look like markdown structure, when estimated, then they cost the prose rate", () => {
    const lookalikes = [
      "see --- here",
      "--- text",
      "***bold***",
      "#hashtag",
      "see # x",
      "a |",
      "see ```x``` inline",
      "a ~~~ b",
    ].join("\n");

    expect(estimateTokens(lookalikes)).toBe(20);
  });
});
