import { describe, expect, it } from "vitest";

import {
  computeGzipRatio,
  computeRedundancyScore,
  computeShannonEntropy,
  computeTTR,
  detectStructuralNoise,
  redundancyLevelFromGzip,
  stripMarkdown,
} from "../redundancy";

describe("computeGzipRatio", () => {
  it("returns a ratio between 0 and 1 for sufficiently large content", () => {
    // Gzip adds a fixed header (~18 bytes) so content must be large enough to compress below raw
    const content = "# Documentation\n\n" + "This is a typical markdown sentence. ".repeat(30);
    const ratio = computeGzipRatio(content);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("returns lower ratio for highly repetitive content", () => {
    const repetitive = "hello world ".repeat(200);
    const unique = Array.from({ length: 100 }, (_, i) => `uniqueword${i}`).join(" ");
    expect(computeGzipRatio(repetitive)).toBeLessThan(computeGzipRatio(unique));
  });
});

describe("redundancyLevelFromGzip", () => {
  it("flags ratio below 0.30 as shrink", () => {
    expect(redundancyLevelFromGzip(0.2)).toBe("shrink");
    expect(redundancyLevelFromGzip(0.29)).toBe("shrink");
  });

  it("flags ratio above 0.55 as dense", () => {
    expect(redundancyLevelFromGzip(0.6)).toBe("dense");
    expect(redundancyLevelFromGzip(0.8)).toBe("dense");
  });

  it("returns ok for middle range", () => {
    expect(redundancyLevelFromGzip(0.4)).toBe("ok");
    expect(redundancyLevelFromGzip(0.55)).toBe("ok");
  });
});

describe("detectStructuralNoise", () => {
  it("counts horizontal rules as noise", () => {
    const content = "Some text.\n\n---\n\nMore text.\n\n───────────\n\nEnd.";
    const result = detectStructuralNoise(content);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("counts HTML comments as noise", () => {
    const content = "<!-- This is a comment -->\nActual content here.";
    const result = detectStructuralNoise(content);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("counts table separator rows as noise", () => {
    const content = "| A | B |\n|---|---|\n| 1 | 2 |";
    const result = detectStructuralNoise(content);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("flags content when noise exceeds 10% of tokens", () => {
    const horizRules = "---\n".repeat(50);
    const content = horizRules + "word ".repeat(50);
    const result = detectStructuralNoise(content);
    expect(result.flagged).toBe(true);
  });

  it("does not flag clean content", () => {
    const content =
      "# Title\n\nThis is a clean document with prose and no noise.\n\nAnother paragraph here.\n";
    const result = detectStructuralNoise(content);
    expect(result.flagged).toBe(false);
  });

  it("exposes pct between 0 and 1", () => {
    const content = "Some text here with no noise at all.";
    const result = detectStructuralNoise(content);
    expect(result.pct).toBeGreaterThanOrEqual(0);
    expect(result.pct).toBeLessThanOrEqual(1);
  });
});

describe("computeTTR", () => {
  it("returns 1 for content with all unique words", () => {
    const unique = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu";
    expect(computeTTR(unique)).toBe(1);
  });

  it("returns lower ratio for repetitive content", () => {
    const repetitive = "word word word word word word word word word word word word word word";
    const diverse = "one two three four five six seven eight nine ten eleven twelve";
    expect(computeTTR(repetitive)).toBeLessThan(computeTTR(diverse));
  });

  it("returns 1 for short content (below minimum word count)", () => {
    expect(computeTTR("hi")).toBe(1);
  });
});

describe("computeShannonEntropy", () => {
  it("returns higher entropy for uniform distribution", () => {
    // Use distinct real words (no digits, which get stripped by regex) so each is a unique token
    const uniform =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon";
    const skewed = "the the the the the the cat cat cat sat";
    expect(computeShannonEntropy(uniform)).toBeGreaterThan(computeShannonEntropy(skewed));
  });

  it("returns 0 for empty content", () => {
    expect(computeShannonEntropy("")).toBe(0);
  });

  it("returns a non-negative number", () => {
    expect(computeShannonEntropy("hello world hello")).toBeGreaterThanOrEqual(0);
  });
});

describe("computeRedundancyScore", () => {
  it("returns higher score for redundant content (low gzip, low TTR)", () => {
    const highRedundancy = computeRedundancyScore(0.15, 0.1, 1.0, 10.0);
    const lowRedundancy = computeRedundancyScore(0.65, 0.85, 9.0, 10.0);
    expect(highRedundancy).toBeGreaterThan(lowRedundancy);
  });

  it("returns value between 0 and 1", () => {
    const score = computeRedundancyScore(0.4, 0.6, 4.0, 8.0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("weighing redundancy", () => {
  it("given gzip, type-token and entropy readings, when scored, then it weighs them 0.5, 0.3 and 0.2", () => {
    expect(computeRedundancyScore(0.4, 0.6, 2, 4)).toBeCloseTo(0.52);
  });

  it("given no entropy ceiling, when scored, then the entropy term counts as fully redundant", () => {
    expect(computeRedundancyScore(0.4, 0.6, 2, 0)).toBeCloseTo(0.62);
  });

  it("given a gzip ratio of exactly 0.30, when classified, then it is ok rather than shrink", () => {
    expect(redundancyLevelFromGzip(0.3)).toBe("ok");
  });

  it("given exactly ten words, half of them repeats, when measured, then the type-token ratio is 0.5", () => {
    expect(computeTTR("one two three four five one two three four five")).toBe(0.5);
  });

  it("given two words seen equally often, when measured, then the entropy is one bit", () => {
    expect(computeShannonEntropy("alpha beta alpha beta")).toBe(1);
  });
});

describe("measuring structural noise", () => {
  it("given eleven horizontal rules between prose lines, when measured, then each rule and its newline count as noise", () => {
    const content = Array.from({ length: 11 }, () => "---\nplain words").join("\n");

    expect(detectStructuralNoise(content).tokens).toBe(20);
  });

  it("given eleven table separator rows, when measured, then each row and its newline count as noise", () => {
    const content = Array.from({ length: 11 }, () => "|---|---|\n| a | b |").join("\n");

    expect(detectStructuralNoise(content).tokens).toBe(50);
  });

  it("given runs of five newlines, when measured, then every newline beyond two counts as noise", () => {
    const content = Array.from({ length: 11 }, () => "words").join("\n\n\n\n\n");

    expect(detectStructuralNoise(content).tokens).toBe(14);
  });

  it("given lines that only look like rules or separators, when measured, then nothing counts as noise", () => {
    const content = ["text ---", "--- text", "---x", "x |---|", "|---| x", "end"].join("\n");

    expect(detectStructuralNoise(content)).toEqual({ tokens: 0, pct: 0, flagged: false });
  });

  it("given empty content, when measured, then the share of noise is 0", () => {
    expect(detectStructuralNoise("")).toEqual({ tokens: 0, pct: 0, flagged: false });
  });
});

describe("stripping markdown before counting words", () => {
  it("given code, comments, headings, tables and emphasis, when stripped, then only the lower-cased prose is left", () => {
    const md = [
      "# Title Here",
      "Keep **Bold** and _this_ [link](url).",
      "```",
      "hidden code",
      "```",
      "Drop `inline code` now.",
      "<!-- secret",
      "comment -->",
      "| table | row |",
      "#hashtag stays",
    ].join("\n");

    expect(stripMarkdown(md)).toBe(
      "title here\nkeep bold and this linkurl.\n\ndrop  now.\n\n\n#hashtag stays",
    );
  });
});
