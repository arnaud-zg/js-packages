import { describe, expect, it } from "vitest";

import {
  BRANCH_COMMENT_MARKER,
  branchChoice,
  branchComment,
  branchSlug,
  branchTag,
  branchVersion,
  comments,
  installSpec,
  repositoryOfPr,
} from "../branchRelease";

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
  const choice = (
    overrides: Partial<Parameters<typeof branchChoice>[0]> = {},
  ): ReturnType<typeof branchChoice> =>
    branchChoice({
      onDefaultBranch: false,
      onDefault: "release",
      yes: false,
      interactive: true,
      ...overrides,
    });

  it("given plain shiplane on the default branch, when deciding, then it is the normal release", () => {
    expect(choice({ onDefaultBranch: true })).toBe("release");
  });

  it("given shiplane branch on the default branch, when deciding, then it publishes a test version without asking", () => {
    expect(choice({ onDefaultBranch: true, onDefault: "publish" })).toBe("publish");
  });

  it("given a branch in a terminal, when deciding, then the person is asked", () => {
    expect(choice()).toBe("ask");
  });

  it("given --yes or no terminal, when deciding, then it publishes without asking", () => {
    expect(choice({ yes: true })).toBe("publish");
    expect(choice({ interactive: false })).toBe("publish");
  });
});

describe("what a tester installs", () => {
  it("given a test version, when installed, then it is the exact version", () => {
    expect(installSpec({ name: "kit", version: "1.0.0-feat-x.ae08284", tag: "feat-x" })).toBe(
      "kit@1.0.0-feat-x.ae08284",
    );
  });

  it("given a version on latest, when installed, then it is the bare name", () => {
    expect(installSpec({ name: "kit", version: "1.0.0", tag: "latest" })).toBe("kit");
  });
});

describe("the pull request comment of a branch release", () => {
  const KIT = {
    name: "@acme/kit",
    version: "0.5.2-feat-x.ae08284",
    tag: "snapshot",
    onNpmjs: true,
  };
  const UI = { ...KIT, name: "@acme/ui", version: "1.2.0-feat-x.ae08284" };
  const comment = (overrides: Partial<Parameters<typeof branchComment>[0]> = {}) =>
    branchComment({
      sha: "ae08284f00d1",
      branch: "feat/x",
      repository: "https://host.test/acme/repo",
      published: [KIT, UI],
      others: ["api"],
      ...overrides,
    });

  it("given published packages, when written, then it opens with its marker and says it is a test build of that commit", () => {
    const lines = comment().split("\n");

    expect(lines[0]).toBe(BRANCH_COMMENT_MARKER);
    expect(lines[1]).toBe("### 📦 Published on npm for testing");
    expect(lines[2]).toContain(
      "Built from [`ae08284`](https://host.test/acme/repo/commit/ae08284f00d1) on `feat/x`.",
    );
  });

  it("given packages on the public npm registry, when written, then each row links its npm page and version", () => {
    expect(comment()).toContain(
      "| [@acme/kit](https://www.npmjs.com/package/@acme/kit) | [0.5.2-feat-x.ae08284](https://www.npmjs.com/package/@acme/kit/v/0.5.2-feat-x.ae08284) | `npm i @acme/kit@0.5.2-feat-x.ae08284` |",
    );
  });

  it("given a package published to another registry, when written, then its name and version are plain text", () => {
    expect(comment({ published: [{ ...KIT, onNpmjs: false }] })).toContain(
      "| @acme/kit | 0.5.2-feat-x.ae08284 | `npm i @acme/kit@0.5.2-feat-x.ae08284` |",
    );
  });

  it("given several snapshots, when written, then every install names the exact version, for npm, pnpm and yarn", () => {
    const body = comment();

    expect(body).not.toContain("@snapshot");
    expect(body).toContain("pnpm add @acme/kit@0.5.2-feat-x.ae08284 @acme/ui@1.2.0-feat-x.ae08284");
    expect(body).toContain("yarn add @acme/kit@0.5.2-feat-x.ae08284 @acme/ui@1.2.0-feat-x.ae08284");
  });

  it("given a numbered channel, when written, then it installs the exact version and offers the channel's tag to follow", () => {
    const beta = { ...KIT, version: "0.6.0-beta.2", tag: "beta" };
    const body = comment({ published: [beta], channel: "beta" });

    expect(body).toContain("`npm i @acme/kit@0.6.0-beta.2`");
    expect(body).toContain(
      "To follow each new beta instead, install the tag: `npm i @acme/kit@beta`.",
    );
  });

  it("given a pending unit that is not an npm package, when written, then it says its test release is not available yet", () => {
    expect(comment()).toContain(
      "Test release not available yet: `api` (npm packages only for now).",
    );
  });

  it("given every changed unit published, when written, then there is no not-published line", () => {
    expect(comment({ others: [] })).not.toContain("not available yet");
  });

  it("given no repository address, when written, then the commit is named without a link", () => {
    expect(comment({ repository: null })).toContain("Built from `ae08284` on `feat/x`.");
  });

  it("given the comment, when written, then it ends by saying each run edits it", () => {
    expect(comment().trimEnd().split("\n").at(-1)).toBe(
      "<sub>Updated by shiplane on each run, same comment.</sub>",
    );
  });

  it("given the table preset, when written, then it is the default comment", () => {
    expect(comment({ template: comments.table })).toBe(comment());
  });

  it("given the compact preset, when written, then it is one line under the marker", () => {
    expect(comment({ template: comments.compact, published: [KIT] })).toBe(
      `${BRANCH_COMMENT_MARKER}\n📦 Test version of \`feat/x\` ([\`ae08284\`](https://host.test/acme/repo/commit/ae08284f00d1)): \`npm i @acme/kit@0.5.2-feat-x.ae08284\`\n`,
    );
  });

  it("given text of its own, when written, then its placeholders are filled and the marker is still on top", () => {
    expect(comment({ template: "Try it: {install}" })).toBe(
      `${BRANCH_COMMENT_MARKER}\nTry it: \`npm i @acme/kit@0.5.2-feat-x.ae08284 @acme/ui@1.2.0-feat-x.ae08284\``,
    );
  });
});

describe("a repository's address, from its pull request", () => {
  it("given a pull request address, when read, then it is the repository's", () => {
    expect(repositoryOfPr("https://host.test/acme/repo/pull/42")).toBe(
      "https://host.test/acme/repo",
    );
  });

  it("given an address that is not a pull request's, when read, then there is none", () => {
    expect(repositoryOfPr("https://example.com/merge/42")).toBeNull();
  });
});
