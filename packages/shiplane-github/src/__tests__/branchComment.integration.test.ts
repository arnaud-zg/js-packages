import type { Shell, ShellResult } from "shiplane/plugin";
import { describe, expect, it } from "vitest";

import { githubHost } from "../github-code-host.adapter";

const ok = (stdout = ""): ShellResult => ({ status: 0, stdout, stderr: "" });

const replying = (...results: ShellResult[]) => {
  const calls: string[][] = [];
  const shell: Shell = {
    capture: (_command, args) => {
      calls.push([...args]);
      return Promise.resolve(results.shift() ?? ok());
    },
    attach: () => Promise.resolve(0),
    env: () => undefined,
  };
  return { shell, calls };
};

const MARKER = "<!-- shiplane:branch-release -->";
const PR = { number: 42, url: "https://github.com/o/r/pull/42" };

describe("the pull request of a branch", () => {
  it("given a branch with an open pull request, when it is read, then it is that pull request", async () => {
    const { shell, calls } = replying(
      ok('[{"number":42,"url":"https://github.com/o/r/pull/42","headRefOid":"abc"}]'),
    );

    await expect(githubHost("/repo", shell).prForBranch("feat/x")).resolves.toEqual({
      number: 42,
      url: "https://github.com/o/r/pull/42",
      head: "abc",
    });
    expect(calls[0]).toEqual(expect.arrayContaining(["--head", "feat/x", "--state", "open"]));
  });

  it("given a branch with no open pull request, when it is read, then there is none", async () => {
    const { shell } = replying(ok("[]"));

    await expect(githubHost("/repo", shell).prForBranch("feat/x")).resolves.toBeNull();
  });
});

describe("one comment per pull request, kept up to date", () => {
  it("given a comment holding the marker, when upserted, then that comment is edited", async () => {
    const { shell, calls } = replying(
      ok(`{"id":7,"body":"hello"}\n{"id":9,"body":${JSON.stringify(`${MARKER}\nold`)}}\n`),
      ok(),
    );

    await githubHost("/repo", shell).upsertComment({
      on: PR,
      marker: MARKER,
      body: `${MARKER}\nnew`,
    });

    expect(calls[1]).toEqual([
      "api",
      "-X",
      "PATCH",
      "repos/{owner}/{repo}/issues/comments/9",
      "-f",
      `body=${MARKER}\nnew`,
    ]);
  });

  it("given no comment holding the marker, when upserted, then a comment is posted", async () => {
    const { shell, calls } = replying(ok(`{"id":7,"body":"hello"}\n`), ok());

    await githubHost("/repo", shell).upsertComment({
      on: PR,
      marker: MARKER,
      body: `${MARKER}\nnew`,
    });

    expect(calls[1]).toEqual([
      "api",
      "-X",
      "POST",
      "repos/{owner}/{repo}/issues/42/comments",
      "-f",
      `body=${MARKER}\nnew`,
    ]);
  });
});
