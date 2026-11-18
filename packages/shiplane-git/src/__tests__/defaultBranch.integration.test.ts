import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { systemShell } from "shiplane/testing";
import { afterAll, describe, expect, it } from "vitest";

import { gitSourceControl } from "../git-source-control.adapter";

const made: string[] = [];
afterAll(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** A bare origin whose one commit is on `branch`, and a folder to check it out next to it. */
const origin = (branch: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-git-default-"));
  made.push(dir);
  const seed = path.join(dir, "seed");
  const bare = path.join(dir, "origin.git");
  fs.mkdirSync(seed);
  git(["init", "--quiet", "--bare", `--initial-branch=${branch}`, bare], dir);
  git(["init", "--quiet", `--initial-branch=${branch}`], seed);
  git(
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "chore: start",
    ],
    seed,
  );
  git(["remote", "add", "origin", bare], seed);
  git(["push", "--quiet", "origin", branch], seed);
  return { dir, seed, bare };
};

const defaultBranchOf = (root: string) =>
  gitSourceControl().create({ root, shell: systemShell }).defaultBranch();

describe("the branch releases start from", () => {
  it("given a clone of a repository whose default branch is master, when read, then it is master, from origin/HEAD", async () => {
    const { dir, bare } = origin("master");
    git(["clone", "--quiet", bare, "clone"], dir);

    expect(await defaultBranchOf(path.join(dir, "clone"))).toBe("master");
  });

  it("given a checkout with no origin/HEAD and a master branch, when read, then it is master", async () => {
    const { seed } = origin("master");

    expect(await defaultBranchOf(seed)).toBe("master");
  });

  it("given a checkout with no origin/HEAD and a main branch, when read, then it is main", async () => {
    const { seed } = origin("main");

    expect(await defaultBranchOf(seed)).toBe("main");
  });

  it("given a clone of a repository whose default branch is develop, when read, then it is develop, from origin/HEAD", async () => {
    const { dir, bare } = origin("develop");
    git(["clone", "--quiet", bare, "clone"], dir);

    expect(await defaultBranchOf(path.join(dir, "clone"))).toBe("develop");
  });

  it("given a checkout with no origin/HEAD and both main and master, when read, then it is main", async () => {
    const { seed } = origin("master");
    git(["branch", "main"], seed);

    expect(await defaultBranchOf(seed)).toBe("main");
  });

  it("given a checkout with only origin's master and no local one, when read, then it is master", async () => {
    const { seed } = origin("master");
    git(["switch", "--quiet", "-c", "work"], seed);
    git(["branch", "--quiet", "-D", "master"], seed);

    expect(await defaultBranchOf(seed)).toBe("master");
  });

  it("given a checkout with a local master never pushed, when read, then it is master", async () => {
    const { seed } = origin("master");
    git(["remote", "remove", "origin"], seed);

    expect(await defaultBranchOf(seed)).toBe("master");
  });

  it("given a checkout with neither main nor master, when read, then it falls back to main", async () => {
    const { seed } = origin("trunk");

    expect(await defaultBranchOf(seed)).toBe("main");
  });

  it("given a main branch named in the config, when read, then it is that one", async () => {
    const { seed } = origin("master");
    const source = gitSourceControl({ main: "trunk" }).create({ root: seed, shell: systemShell });

    expect(await source.defaultBranch()).toBe("trunk");
  });
});
