import { describe, expect, it } from "vitest";

import {
  BRANCH_COMMENT_MARKER,
  branchChoice,
  branchComment,
  branchSlug,
  branchTag,
  branchVersion,
} from "../branchRelease";

const PR = { number: 42, url: "https://github.com/acme/repo/pull/42" };

describe("a branch's name, as a version and an npm tag read it", () => {
  it("given slashes, capitals and underscores, when slugged, then each run of them is one dash", () => {
    expect(branchSlug("feat/X_y")).toBe("feat-x-y");
  });

  it("given dashes or symbols at either end, when slugged, then they are trimmed", () => {
    expect(branchSlug("--fix//login!!")).toBe("fix-login");
  });

  it("given a very long name, when slugged, then it keeps 40 characters and never ends on a dash", () => {
    const slug = branchSlug(`feat/${"a".repeat(34)}-tail-of-a-very-long-branch-name`);

    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe(`feat-${"a".repeat(34)}`);
  });

  it("given a name of symbols only, when slugged, then it still names a branch", () => {
    expect(branchSlug("///")).toBe("branch");
  });
});

describe("a branch release's version", () => {
  it("given the current version, the branch and the head, when versioned, then it is <current>-<slug>.<short sha>", () => {
    expect(branchVersion({ current: "0.5.2", branch: "feat/x", sha: "ae08284f00d" })).toBe(
      "0.5.2-feat-x.ae08284",
    );
  });

  it("given a head whose short sha is all digits with a leading zero, when versioned, then it stays valid semver", () => {
    expect(branchVersion({ current: "1.0.0", branch: "fix", sha: "0123456789" })).toBe(
      "1.0.0-fix.g0123456",
    );
  });
});

describe("a branch release's npm dist-tag", () => {
  it("given a plain slug, when tagged, then the tag is the slug", () => {
    expect(branchTag("feat-x")).toBe("feat-x");
  });

  it("given a slug npm reads as a semver range, when tagged, then it is prefixed so npm takes it", () => {
    expect(branchTag("v2")).toBe("branch-v2");
    expect(branchTag("1")).toBe("branch-1");
    expect(branchTag("x")).toBe("branch-x");
  });

  it("given latest, when tagged, then it never moves latest", () => {
    expect(branchTag("latest")).toBe("branch-latest");
  });

  it("given a slug that only starts like a version, when tagged, then it is kept", () => {
    expect(branchTag("v2-feature")).toBe("v2-feature");
  });
});

describe("what running on a branch does", () => {
  it("given the default branch, when deciding, then it is the normal release", () => {
    expect(branchChoice({ onDefault: true, pr: null, yes: false, interactive: true })).toBe(
      "release",
    );
  });

  it("given a branch with no open pull request, when deciding, then nothing is published", () => {
    expect(branchChoice({ onDefault: false, pr: null, yes: true, interactive: true })).toBe(
      "no-pr",
    );
  });

  it("given a branch with an open pull request in a terminal, when deciding, then the person is asked", () => {
    expect(branchChoice({ onDefault: false, pr: PR, yes: false, interactive: true })).toBe("ask");
  });

  it("given --yes or no terminal, when deciding, then it publishes without asking", () => {
    expect(branchChoice({ onDefault: false, pr: PR, yes: true, interactive: true })).toBe(
      "publish",
    );
    expect(branchChoice({ onDefault: false, pr: PR, yes: false, interactive: false })).toBe(
      "publish",
    );
  });
});

describe("the pull request comment of a branch release", () => {
  it("given published packages, when written, then it opens with its marker and has one install line each", () => {
    expect(
      branchComment({
        sha: "ae08284f00d",
        published: [{ name: "@acme/kit", version: "0.6.0-feat-x.ae08284", tag: "feat-x" }],
      }),
    ).toBe(
      [
        BRANCH_COMMENT_MARKER,
        "### Branch release for ae08284",
        "| Package | Version | Install |",
        "| --- | --- | --- |",
        "| @acme/kit | 0.6.0-feat-x.ae08284 | `npm i @acme/kit@feat-x` |",
        "",
      ].join("\n"),
    );
  });
});
