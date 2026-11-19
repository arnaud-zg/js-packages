import { describe, expect, it } from "vitest";

import { ageProblem, isSnapshotTag, staleSnapshotTags } from "../snapshotTags";

const NOW = new Date("2026-10-12T09:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("which tags a shiplane snapshot left", () => {
  it("given a branch snapshot under its branch's tag, when read, then it is a snapshot tag", () => {
    expect(isSnapshotTag({ tag: "feat-x", version: "0.6.0-feat-x.ae08284" })).toBe(true);
    expect(isSnapshotTag({ tag: "branch-v2", version: "0.6.0-v2.ae08284" })).toBe(true);
    expect(isSnapshotTag({ tag: "snapshot", version: "0.6.0-feat-x.g0123456" })).toBe(true);
  });

  it("given latest, a numbered channel or a tag of the team's own, when read, then none is a snapshot tag", () => {
    expect(isSnapshotTag({ tag: "latest", version: "0.6.0-latest.ae08284" })).toBe(false);
    expect(isSnapshotTag({ tag: "beta", version: "0.6.0-beta.2" })).toBe(false);
    expect(isSnapshotTag({ tag: "next", version: "0.6.0" })).toBe(false);
    expect(isSnapshotTag({ tag: "canary", version: "0.6.0-feat-x.ae08284" })).toBe(false);
  });
});

describe("which snapshot tags are old enough to remove", () => {
  const tags = [
    { tag: "latest", version: "0.5.2", publishedAt: daysAgo(90) },
    { tag: "old-branch", version: "0.6.0-old-branch.ae08284", publishedAt: daysAgo(45) },
    { tag: "fresh-branch", version: "0.6.0-fresh-branch.bc12345", publishedAt: daysAgo(3) },
    { tag: "beta", version: "0.6.0-beta.2", publishedAt: daysAgo(200) },
    { tag: "no-time", version: "0.6.0-no-time.cd12345", publishedAt: null },
  ];

  it("given 30 days by default, when read, then only the old snapshot's tag goes, with its age", () => {
    expect(staleSnapshotTags({ tags, now: NOW })).toEqual([{ ...tags[1], days: 45 }]);
  });

  it("given a shorter age, when read, then a younger snapshot's tag goes too", () => {
    expect(staleSnapshotTags({ tags, now: NOW, olderThanDays: 2 }).map(({ tag }) => tag)).toEqual([
      "old-branch",
      "fresh-branch",
    ]);
  });

  it("given a snapshot tag on the version latest points at, when read, then it is kept", () => {
    const onLatest = [
      { tag: "latest", version: "0.6.0-main.ae08284", publishedAt: daysAgo(60) },
      { tag: "main", version: "0.6.0-main.ae08284", publishedAt: daysAgo(60) },
    ];

    expect(staleSnapshotTags({ tags: onLatest, now: NOW })).toEqual([]);
  });

  it("given an age under 7 days or not a whole number, when checked, then it is refused", () => {
    expect(ageProblem(30)).toBeNull();
    expect(ageProblem(7)).toBeNull();
    expect(ageProblem(6)).toMatch(/7 or more/);
    expect(ageProblem(Number.NaN)).toMatch(/whole number/);
  });
});
