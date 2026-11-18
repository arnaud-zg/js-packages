import { describe, expect, it } from "vitest";

import { analyzeFile, sha1 } from "../index";

// 33 rule lines of "---" cost 33 × 4 chars / 2.2 = 60 tokens.
const SIXTY_TOKENS = Array.from({ length: 33 }, () => "---").join("\n");

describe("rating a file against its budget", () => {
  it.each([
    { threshold: 120, health: "good" },
    { threshold: 80, health: "normal" },
    { threshold: 60, health: "warning" },
    { threshold: 59, health: "bad" },
  ])(
    "given a file landing on a band's upper edge (threshold $threshold), when analysed, then it is rated $health",
    ({ threshold, health }) => {
      const bands = { goodBelow: 0.5, normalBelow: 0.75 };

      expect(analyzeFile(SIXTY_TOKENS, { threshold, ...bands }).health).toBe(health);
    },
  );

  it("given a file over its budget, when analysed alone, then it warns and leaves failing to the caller", () => {
    const result = analyzeFile(SIXTY_TOKENS, { threshold: 10 });

    expect(result).toMatchObject({ health: "bad", status: "warn", path: "" });
  });

  it("given a file within its budget, when analysed, then its status is ok", () => {
    expect(analyzeFile(SIXTY_TOKENS, { threshold: 1000 }).status).toBe("ok");
  });

  it("given no bands configured, when a file fills exactly 60% of its budget, then the default good band still holds it", () => {
    expect(analyzeFile(SIXTY_TOKENS, { threshold: 100 }).health).toBe("good");
  });

  it("given no bands configured, when a file fills just under 85% of its budget, then the default normal band holds it", () => {
    expect(analyzeFile(SIXTY_TOKENS, { threshold: 71 }).health).toBe("normal");
  });
});

describe("fingerprinting a file's content to tell when it changed", () => {
  it("given a text, when fingerprinted, then it gets the standard SHA-1 hex digest", () => {
    expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});
