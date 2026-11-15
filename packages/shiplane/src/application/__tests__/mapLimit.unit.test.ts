import { describe, expect, it } from "vitest";

import { mapLimit } from "../mapLimit";

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((done) => setImmediate(done));
};

describe("running work a few at a time", () => {
  it("given six items and a limit of two, when they run, then two at most run at once and results keep input order", async () => {
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const work = mapLimit([1, 2, 3, 4, 5, 6], 2, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((done) => releases.unshift(done));
      running -= 1;
      return item * 10;
    });

    for (let round = 0; round < 3; round += 1) {
      await settle();
      releases.splice(0).forEach((release) => release());
    }

    expect(await work).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it("given one item that rejects, when they run, then the whole run rejects with its error", async () => {
    const work = mapLimit(["a", "b", "c"], 2, (item) =>
      item === "b" ? Promise.reject(new Error("b broke")) : Promise.resolve(item),
    );

    await expect(work).rejects.toThrow("b broke");
  });

  it("given no items, when they run, then the result is empty", async () => {
    expect(await mapLimit([], 4, () => Promise.resolve(1))).toEqual([]);
  });
});
