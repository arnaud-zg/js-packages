import { describe, expect, it } from "vitest";

import { TEST_FLOW } from "../../testing/flow";
import { releaseSource } from "../governance";

describe("where a release may start from", () => {
  const main = { branch: "main", head: "abc", originMain: "abc" };

  it("given main in sync with origin, when building, then it may start", () => {
    expect(releaseSource("build", "staging", main, { flow: TEST_FLOW })).toEqual({ allowed: true });
  });

  it("given a feature branch, when building, then it is refused: the binary would ship unmerged code", () => {
    expect(
      releaseSource("build", "staging", { ...main, branch: "feat/x" }, { flow: TEST_FLOW }),
    ).toEqual({
      allowed: false,
      why: "not-main",
    });
  });

  it("given a detached checkout at exactly the release's tag, when building, then it may start", () => {
    const atTag = { branch: "HEAD", head: "tagged", originMain: "abc" };

    expect(
      releaseSource("build", "staging", atTag, {
        flow: TEST_FLOW,
        tagCommit: "tagged",
      }),
    ).toEqual({
      allowed: true,
    });
    expect(
      releaseSource("build", "staging", atTag, {
        flow: TEST_FLOW,
        tagCommit: "other",
      }),
    ).toEqual({
      allowed: false,
      why: "not-main",
    });
  });

  it("given main behind origin, when building, then it is refused until pulled", () => {
    expect(
      releaseSource("build", "staging", { ...main, originMain: "def" }, { flow: TEST_FLOW }),
    ).toEqual({
      allowed: false,
      why: "behind-main",
    });
  });

  it("given a feature branch, when updating staging, then testers may get it", () => {
    expect(
      releaseSource("update", "staging", { ...main, branch: "feat/x" }, { flow: TEST_FLOW }),
    ).toEqual({
      allowed: true,
    });
  });

  it("given a repository whose default branch is master, when building from master, then it may start", () => {
    const master = { branch: "master", head: "abc", originMain: "abc" };

    expect(
      releaseSource("build", "staging", master, {
        flow: TEST_FLOW,
        defaultBranch: "master",
      }),
    ).toEqual({
      allowed: true,
    });
  });

  it("given a repository whose default branch is master, when building from main, then it is refused", () => {
    expect(
      releaseSource("build", "staging", main, {
        flow: TEST_FLOW,
        defaultBranch: "master",
      }),
    ).toEqual({
      allowed: false,
      why: "not-main",
    });
  });

  it("given a feature branch, when updating prod, then it is refused", () => {
    expect(
      releaseSource("update", "prod", { ...main, branch: "feat/x" }, { flow: TEST_FLOW }),
    ).toEqual({
      allowed: false,
      why: "not-main",
    });
  });
});
