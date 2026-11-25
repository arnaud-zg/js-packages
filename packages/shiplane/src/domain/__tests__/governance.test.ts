import { describe, expect, it } from "vitest";

import { releaseSource } from "../governance";

describe("where a release may start from", () => {
  const main = { branch: "main", head: "abc", originMain: "abc" };

  it("given main in sync with origin, when building, then it may start", () => {
    expect(releaseSource("build", "preview", main)).toEqual({ allowed: true });
  });

  it("given a feature branch, when building, then it is refused: the binary would ship unmerged code", () => {
    expect(releaseSource("build", "preview", { ...main, branch: "feat/x" })).toEqual({
      allowed: false,
      why: "not-main",
    });
  });

  it("given a detached checkout at exactly the release's tag, when building, then it may start", () => {
    const atTag = { branch: "HEAD", head: "tagged", originMain: "abc" };

    expect(releaseSource("build", "preview", atTag, { tagCommit: "tagged" })).toEqual({
      allowed: true,
    });
    expect(releaseSource("build", "preview", atTag, { tagCommit: "other" })).toEqual({
      allowed: false,
      why: "not-main",
    });
  });

  it("given main behind origin, when building, then it is refused until pulled", () => {
    expect(releaseSource("build", "preview", { ...main, originMain: "def" })).toEqual({
      allowed: false,
      why: "behind-main",
    });
  });

  it("given a feature branch, when updating preview, then testers may get it", () => {
    expect(releaseSource("update", "preview", { ...main, branch: "feat/x" })).toEqual({
      allowed: true,
    });
  });

  it("given a repository whose default branch is master, when building from master, then it may start", () => {
    const master = { branch: "master", head: "abc", originMain: "abc" };

    expect(releaseSource("build", "preview", master, { defaultBranch: "master" })).toEqual({
      allowed: true,
    });
  });

  it("given a repository whose default branch is master, when building from main, then it is refused", () => {
    expect(releaseSource("build", "preview", main, { defaultBranch: "master" })).toEqual({
      allowed: false,
      why: "not-main",
    });
  });

  it("given a feature branch, when updating production, then it is refused", () => {
    expect(releaseSource("update", "production", { ...main, branch: "feat/x" })).toEqual({
      allowed: false,
      why: "not-main",
    });
  });
});
