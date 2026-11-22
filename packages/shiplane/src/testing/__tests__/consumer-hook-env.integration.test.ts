import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ConsumerRepository } from "../consumer";
import { consumerRepository } from "../consumer";

let repository: ConsumerRepository | undefined;
let decoy: string | undefined;
afterEach(() => {
  delete process.env.GIT_DIR;
  repository?.remove();
  if (decoy) fs.rmSync(decoy, { recursive: true, force: true });
});

describe("a consumer repository built inside a git hook", () => {
  it("given GIT_DIR names another repository, as a pre-push hook sets it, when the consumer repository is built, then that repository is left as it was", () => {
    // A pre-push hook run from a linked worktree gets GIT_DIR=<repo>/.git/worktrees/<name>.
    decoy = fs.mkdtempSync(path.join(os.tmpdir(), "hook-repo-"));
    const main = path.join(decoy, "main");
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", main]);
    const identity = ["-c", "user.name=a", "-c", "user.email=a@b.c", "-c", "commit.gpgsign=false"];
    execFileSync("git", ["-C", main, ...identity, "commit", "--quiet", "--allow-empty", "-m", "a"]);
    execFileSync("git", ["-C", main, "worktree", "add", "--quiet", path.join(decoy, "wt")]);
    process.env.GIT_DIR = path.join(main, ".git", "worktrees", "wt");

    repository = consumerRepository({ files: { "README.md": "# acme\n" } });

    const config = (key: string) =>
      execFileSync("git", ["config", "--file", path.join(main, ".git", "config"), key], {
        encoding: "utf8",
      }).trim();
    expect(config("core.bare")).toBe("false");
    expect(repository.git(["remote", "get-url", "origin"])).toMatch(/origin\.git$/);
  });
});
