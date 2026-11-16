import type { Shell, ShellResult } from "shiplane/plugin";
import { describe, expect, it } from "vitest";

import { githubHost } from "../github-code-host.adapter";

const ok = (stdout = ""): ShellResult => ({ status: 0, stdout, stderr: "" });
const REPO = ok('{"url":"https://github.com/o/r"}');

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

/** The notes `gh release create` was given. */
const notesOf = (calls: string[][]) => {
  const create = calls.find(([command, sub]) => command === "release" && sub === "create") ?? [];
  return create[create.indexOf("--notes") + 1];
};

describe("publishing release notes on GitHub", () => {
  it("given the tag before, when the notes are published, then they end on a Full Changelog link comparing the two", async () => {
    const { shell, calls } = replying(REPO, ok());

    await githubHost("/repo", shell).createRelease("pkg@0.1.3", "- A fix", true, "pkg@0.1.2");

    expect(notesOf(calls)).toBe(
      "- A fix\n\n**Full Changelog**: https://github.com/o/r/compare/pkg@0.1.2...pkg@0.1.3",
    );
  });

  it("given a first release, when the notes are published, then they are the changelog alone", async () => {
    const { shell, calls } = replying(ok());

    await githubHost("/repo", shell).createRelease("pkg@0.1.0", "- First", true);

    expect(notesOf(calls)).toBe("- First");
    expect(calls).toHaveLength(1);
  });
});
