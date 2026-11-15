import { describe, expect, it } from "vitest";

import { adaptiveThreshold, coefficientOfVariation, mad, median, percentile } from "../robustStats";

describe("median", () => {
  it("returns middle value for odd-length array", () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it("returns average of two middle values for even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("handles unsorted input", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe("mad", () => {
  it("returns 0 for identical values", () => {
    expect(mad([5, 5, 5], 5)).toBe(0);
  });

  it("returns correct MAD for known dataset", () => {
    // [1, 1, 2, 2, 4, 6, 9] median=2 MAD=1
    expect(mad([1, 1, 2, 2, 4, 6, 9], 2)).toBe(1);
  });
});

describe("percentile", () => {
  it("returns max for p=100", () => {
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it("returns min for p=0 (or lowest)", () => {
    expect(percentile([1, 2, 3, 4, 5], 1)).toBeGreaterThanOrEqual(1);
  });

  it("returns approximately correct p95", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 95)).toBeGreaterThanOrEqual(94);
    expect(percentile(arr, 95)).toBeLessThanOrEqual(96);
  });

  it("returns 0 for empty array", () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe("coefficientOfVariation", () => {
  it("returns 0 for identical values", () => {
    expect(coefficientOfVariation([5, 5, 5, 5])).toBe(0);
  });

  it("returns higher value for more spread out data", () => {
    const spread = [1, 100, 200, 300];
    const tight = [98, 100, 102, 100];
    expect(coefficientOfVariation(spread)).toBeGreaterThan(coefficientOfVariation(tight));
  });

  it("returns 0 for single-element array", () => {
    expect(coefficientOfVariation([42])).toBe(0);
  });
});

describe("adaptiveThreshold", () => {
  it("returns 0 for fewer than 3 values", () => {
    expect(adaptiveThreshold([1000, 2000])).toBe(0);
  });

  it("returns median + 1.5*MAD", () => {
    // median([100, 200, 300]) = 200, MAD = median([100, 0, 100]) = 100
    // adaptive = 200 + 1.5 * 100 = 350
    expect(adaptiveThreshold([100, 200, 300])).toBe(350);
  });

  it("is resistant to outliers", () => {
    // Without outlier: [100, 110, 120, 130] → median=115, MAD=15 → 115+22.5=137.5
    // With outlier: [100, 110, 120, 130, 10000] → median=120, MAD=20 → 120+30=150
    // The adaptive threshold stays low despite the outlier (unlike mean+stddev which would spike)
    const withOutlier = adaptiveThreshold([100, 110, 120, 130, 10000]);
    const meanPlusStddev = (() => {
      const vals = [100, 110, 120, 130, 10000];
      const mean = vals.reduce((a, b) => a + b) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      return mean + 1.5 * std;
    })();
    expect(withOutlier).toBeLessThan(meanPlusStddev);
  });
});
