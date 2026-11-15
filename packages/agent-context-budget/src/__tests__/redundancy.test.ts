import { describe, expect, it } from "vitest";

import {
  computeGzipRatio,
  computeRedundancyScore,
  computeShannonEntropy,
  computeTTR,
  detectStructuralNoise,
  redundancyLevelFromGzip,
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
