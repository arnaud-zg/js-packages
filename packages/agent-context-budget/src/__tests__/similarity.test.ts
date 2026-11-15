import { describe, expect, it } from "vitest";

import { computeGzipRatio } from "../redundancy";
import { extractShingles, findSimilarFiles, jaccardFromMinHash, minHash } from "../similarity";

describe("tiny or empty files", () => {
  it("given two files too short to form a shingle, when compared, then they are not flagged as duplicates", () => {
    const pairs = findSimilarFiles([
      { path: "a.md", content: "Short note." },
      { path: "b.md", content: "Another one here." },
    ]);

    expect(pairs).toEqual([]);
  });

  it("given an empty shingle set, when estimating Jaccard, then similarity is 0", () => {
    expect(jaccardFromMinHash(minHash(new Set()), minHash(new Set()))).toBe(0);
  });

  it("given empty content, when computing the gzip ratio, then it is a finite number", () => {
    expect(Number.isFinite(computeGzipRatio(""))).toBe(true);
  });
});

describe("extractShingles", () => {
  it("returns empty set for content with fewer than k words", () => {
    const shingles = extractShingles("one two three", 5);
    expect(shingles.size).toBe(0);
  });

  it("returns non-empty set for content with enough words", () => {
    const text = "the quick brown fox jumps over the lazy dog and then some";
    expect(extractShingles(text, 5).size).toBeGreaterThan(0);
  });

  it("produces same shingles for identical content", () => {
    const text = "hello world this is a test sentence";
    const a = extractShingles(text);
    const b = extractShingles(text);
    expect(a).toEqual(b);
  });

  it("produces different shingles for different content", () => {
    const a = extractShingles("alpha beta gamma delta epsilon zeta eta theta");
    const b = extractShingles("one two three four five six seven eight nine");
    const intersection = new Set([...a].filter((x) => b.has(x)));
    expect(intersection.size).toBe(0);
  });
});

describe("minHash", () => {
  it("produces a signature of the specified length", () => {
    const shingles = new Set(["a b c d e", "b c d e f", "c d e f g"]);
    const sig = minHash(shingles, 64);
    expect(sig.length).toBe(64);
  });

  it("produces identical signatures for the same shingle set", () => {
    const shingles = new Set(["hello world test", "world test foo", "test foo bar"]);
    expect(minHash(shingles)).toEqual(
      minHash(new Set(["hello world test", "world test foo", "test foo bar"])),
    );
  });
});

describe("jaccardFromMinHash", () => {
  it("returns 1 for identical signatures", () => {
    const shingles = extractShingles("the quick brown fox jumps over the lazy dog");
    const sig = minHash(shingles);
    expect(jaccardFromMinHash(sig, sig)).toBe(1);
  });

  it("returns a value between 0 and 1", () => {
    const a = minHash(extractShingles("alpha beta gamma delta epsilon zeta eta theta iota"));
    const b = minHash(extractShingles("one two three four five six seven eight nine ten eleven"));
    const j = jaccardFromMinHash(a, b);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(j).toBeLessThanOrEqual(1);
  });
});

// Helper: sentence built from real words (no digits that get stripped by the shingle extractor)
function sentence(words: string[]): string {
  return words.join(" ");
}

const WORDS_A = [
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "and",
  "then",
  "some",
  "more",
  "words",
  "that",
  "are",
  "all",
  "unique",
  "adding",
  "content",
  "here",
  "budget",
  "estimation",
  "report",
  "agent",
  "session",
  "turbo",
  "repo",
  "monorepo",
  "nestjs",
  "expo",
  "react",
  "native",
  "hexagonal",
  "architecture",
  "ports",
  "adapters",
  "command",
  "query",
  "separation",
  "event",
  "sourcing",
  "projection",
  "handler",
  "repository",
  "domain",
  "service",
  "module",
  "schema",
  "validation",
  "token",
  "budget",
];

const WORDS_B = [
  "completely",
  "different",
  "vocabulary",
  "nothing",
  "shared",
  "between",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "sigma",
  "upsilon",
  "omega",
  "abstract",
  "concrete",
  "implementation",
  "interface",
  "protocol",
  "strategy",
  "pattern",
  "factory",
  "observer",
  "decorator",
  "builder",
  "specification",
  "proxy",
  "chain",
  "responsibility",
  "state",
  "mediator",
  "memento",
  "visitor",
  "iterator",
  "composite",
  "flyweight",
  "bridge",
  "facade",
  "template",
  "method",
  "algorithm",
  "structure",
  "behavior",
  "creational",
];

describe("findSimilarFiles", () => {
  it("returns empty array for completely dissimilar files", () => {
    // Repeat each vocabulary enough times to produce many shingles
    const contentA = sentence([...WORDS_A, ...WORDS_A, ...WORDS_A]);
    const contentB = sentence([...WORDS_B, ...WORDS_B, ...WORDS_B]);
    const files = [
      { path: "a.md", content: contentA },
      { path: "b.md", content: contentB },
    ];
    const pairs = findSimilarFiles(files);
    expect(pairs.length).toBe(0);
  });

  it("flags identical files as duplication", () => {
    const shared = sentence([...WORDS_A, ...WORDS_A, ...WORDS_A]);
    const files = [
      { path: "a.md", content: shared },
      { path: "b.md", content: shared },
    ];
    const pairs = findSimilarFiles(files);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]?.flag).toBe("duplication");
  });

  it("flags highly similar files as merge-candidate or duplication", () => {
    // File b is ~90% the same as file a (append a small tail of different words)
    const base = sentence([...WORDS_A, ...WORDS_A, ...WORDS_A]);
    const tail = sentence(WORDS_B.slice(0, 5));
    const files = [
      { path: "a.md", content: base },
      { path: "b.md", content: base + " " + tail },
    ];
    const pairs = findSimilarFiles(files);
    expect(pairs.length).toBeGreaterThan(0);
    expect(["merge-candidate", "duplication"]).toContain(pairs[0]?.flag);
  });

  it("sorts pairs by jaccard descending", () => {
    const base = sentence([...WORDS_A, ...WORDS_A, ...WORDS_A]);
    const files = [
      { path: "a.md", content: base },
      { path: "b.md", content: base },
      { path: "c.md", content: base + " " + sentence(WORDS_B) },
    ];
    const pairs = findSimilarFiles(files);
    if (pairs.length >= 2) {
      expect(pairs[0]?.jaccard).toBeGreaterThanOrEqual(pairs[1]?.jaccard ?? 0);
    }
  });
});
