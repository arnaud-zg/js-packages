import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { systemShell } from "shiplane/testing";
import { afterAll, describe, expect, it } from "vitest";

import type { GitOptions } from "../git-source-control.adapter";
import { gitSourceControl } from "../git-source-control.adapter";

const made: string[] = [];
afterAll(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const git = (args: string[], cwd: string) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

const IDENTITY = [
  ["user.name", "Release Test"],
  ["user.email", "release@example.com"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
  ["core.hooksPath", "/dev/null"],
] as const;

/** A checkout of main with one commit, pushed to a bare origin, and a second clone of that origin. */
const repository = (options: GitOptions = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-git-integration-"));
  made.push(dir);
  const root = path.join(dir, "checkout");
  const origin = path.join(dir, "origin.git");
  fs.mkdirSync(root);
  git(["init", "--quiet", "--bare", "--initial-branch=main", origin], dir);
  git(["init", "--quiet", "--initial-branch=main"], root);
  for (const [key, value] of IDENTITY) git(["config", key, value], root);
  fs.writeFileSync(path.join(root, "README.md"), "# app\n");
  git(["add", "README.md"], root);
  git(["commit", "--quiet", "-m", "chore: start"], root);
  git(["remote", "add", "origin", origin], root);
  git(["push", "--quiet", "-u", "origin", "main"], root);

  const write = (file: string, text: string, cwd = root) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  };
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const commitAll = (subject: string, cwd = root) => {
    git(["add", "--all"], cwd);
    git(["commit", "--quiet", "-m", subject], cwd);
    return git(["rev-parse", "HEAD"], cwd);
  };
  // Someone else's checkout, pushing to the same origin.
  const teammate = () => {
    const other = path.join(dir, `teammate-${made.length}-${Date.now()}`);
    git(["clone", "--quiet", origin, other], dir);
    for (const [key, value] of IDENTITY) git(["config", key, value], other);
    return other;
  };
  const onOrigin = (ref: string) => {
    try {
      return git(["rev-parse", "--verify", "--quiet", ref], origin);
    } catch {
      return null;
    }
  };
  const port = gitSourceControl({ retryDelays: [], ...options }).create({
    root,
    shell: systemShell,
  });
  return { dir, root, origin, port, write, read, commitAll, teammate, onOrigin };
};

describe("checking the checkout is ready to release", () => {
  it("given a teammate pushed to main, when shiplane checks where the checkout stands, then it sees origin's main on their commit while the checkout stays behind", async () => {
    const { root, port, teammate, write, commitAll } = repository();
    const before = git(["rev-parse", "HEAD"], root);
    const other = teammate();
    write("teammate.md", "hi\n", other);
    const theirs = commitAll("docs: teammate", other);
    git(["push", "--quiet", "origin", "main"], other);

    expect(await port.position()).toEqual({ branch: "main", head: before, originMain: theirs });
  });

  it("given a tracked file edited, when shiplane checks the checkout before a release, then it reports uncommitted changes", async () => {
    const { port, write } = repository();
    write("README.md", "# edited\n");

    expect(await port.isClean()).toBe(false);
  });

  it("given a file edited and another created, when shiplane lists what is uncommitted, then it names both", async () => {
    const { port, write } = repository();
    write("README.md", "# edited\n");
    write("src/new.ts", "export {};\n");

    expect(await port.changedFiles()).toEqual(["README.md", "src/new.ts"]);
  });
});

describe("working out what goes into a release", () => {
  it("given a manifest bumped to 1.1.0 in an earlier commit, when shiplane looks for the release that set that version, then it finds that commit and its subject", async () => {
    const { port, write, commitAll } = repository();
    write("apps/web/package.json", '{\n  "version": "1.0.0"\n}\n');
    commitAll("chore: add web");
    write("apps/web/package.json", '{\n  "version": "1.1.0"\n}\n');
    const sha = commitAll("chore(release): web 1.1.0");
    write("apps/web/index.ts", "export {};\n");
    commitAll("feat(web): index");

    expect(await port.versionCommit("apps/web", "package.json", "1.1.0")).toEqual({
      sha,
      subject: "chore(release): web 1.1.0",
    });
  });

  it("given a version no manifest ever held, when shiplane looks for the release that set it, then it finds none", async () => {
    const { port, write, commitAll } = repository();
    write("apps/web/package.json", '{\n  "version": "1.0.0"\n}\n');
    commitAll("chore: add web");

    expect(await port.versionCommit("apps/web", "package.json", "2.0.0")).toBeNull();
  });

  it("given two commits since the last release, when the release gathers its changes, then it lists each newest first with the files it touched", async () => {
    const { root, port, write, commitAll } = repository();
    const start = git(["rev-parse", "HEAD"], root);
    write("a.md", "a\n");
    commitAll("feat: a");
    write("b.md", "b\n");
    write("c.md", "c\n");
    const end = commitAll("feat: b and c");

    expect(await port.commitsBetween(start, end)).toEqual([
      { subject: "feat: b and c", files: ["b.md", "c.md"] },
      { subject: "feat: a", files: ["a.md"] },
    ]);
  });

  it("given a commit that touched two files, when the release asks what changed since the commit before, then it names those two", async () => {
    const { root, port, write, commitAll } = repository();
    const start = git(["rev-parse", "HEAD"], root);
    write("README.md", "# changed\n");
    write("docs/new.md", "new\n");
    const end = commitAll("docs: more");

    expect(await port.diffNames(start, end)).toEqual(["README.md", "docs/new.md"]);
  });

  it("given a file changed since the last release, when the release reads it as it was then, then it gets the old text, and nothing for a file that did not exist yet", async () => {
    const { root, port, write, commitAll } = repository();
    const start = git(["rev-parse", "HEAD"], root);
    write("README.md", "# changed\n");
    write("later.md", "later\n");
    commitAll("docs: change");

    expect(await port.fileAt(start, "README.md")).toBe("# app");
    expect(await port.fileAt(start, "later.md")).toBeNull();
  });

  it("given a teammate pushed a release tag, when shiplane reads the versions already released, then that tag is among them", async () => {
    const { port, teammate } = repository();
    const other = teammate();
    git(["tag", "-a", "web@1.0.0", "-m", "web 1.0.0"], other);
    git(["push", "--quiet", "origin", "web@1.0.0"], other);

    expect(await port.tags()).toEqual(new Set(["web@1.0.0"]));
  });
});

describe("committing a release", () => {
  it("given a formatter in the config, when files are committed with a body, then the commit holds the formatted files and both title and body", async () => {
    // Formats only inside the test's checkout, so it never touches a file anywhere else.
    const formatter = [
      "sh",
      "-c",
      '[ -f .test-checkout ] || exit 1; for file; do printf "formatted\\n" > "$file"; done',
      "format",
    ];
    const { root, port, write, read } = repository({ format: formatter });
    write(".test-checkout", "");
    git(["add", ".test-checkout"], root);
    git(["commit", "--quiet", "-m", "test: mark the checkout"], root);
    write("CHANGELOG.md", "raw\n");

    await port.commit(["CHANGELOG.md"], "chore(release): web 1.1.0", "Bumps web.");

    expect(read("CHANGELOG.md")).toBe("formatted\n");
    expect(git(["show", "HEAD:CHANGELOG.md"], root)).toBe("formatted");
    expect(git(["log", "-1", "--format=%B"], root)).toBe("chore(release): web 1.1.0\n\nBumps web.");
    expect(await port.isClean()).toBe(true);
  });

  it("given a pre-commit hook that refuses, when a release commit skips hooks, then it is made anyway", async () => {
    const { root, port, write } = repository();
    const hooks = path.join(root, "..", "hooks");
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    git(["config", "core.hooksPath", hooks], root);
    write("notes.md", "notes\n");

    await port.commit(["notes.md"], "chore(release): a title longer than the hooks allow", "", {
      skipHooks: true,
    });

    expect(git(["log", "-1", "--format=%B"], root)).toBe(
      "chore(release): a title longer than the hooks allow",
    );
  });

  it("given a pre-commit hook that refuses, when a commit keeps the hooks, then it fails and nothing is committed", async () => {
    const { root, port, write } = repository();
    const hooks = path.join(root, "..", "hooks");
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    git(["config", "core.hooksPath", hooks], root);
    write("notes.md", "notes\n");

    await expect(port.commit(["notes.md"], "docs: notes")).rejects.toThrow(/git commit/);
    expect(git(["log", "-1", "--format=%s"], root)).toBe("chore: start");
  });

  it("given commits are signed with an SSH key, when a release is tagged, then the tag carries a signature", async () => {
    const { dir, root, port } = repository();
    const key = path.join(dir, "signing");
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], { stdio: "pipe" });
    git(["config", "gpg.format", "ssh"], root);
    git(["config", "user.signingkey", `${key}.pub`], root);
    git(["config", "commit.gpgsign", "true"], root);

    await port.tag("web@1.1.0", git(["rev-parse", "HEAD"], root), "web 1.1.0");

    expect(git(["cat-file", "tag", "web@1.1.0"], root)).toContain("BEGIN SSH SIGNATURE");
  });
});

describe("publishing a release", () => {
  it("given a release branch, when it is pushed, then origin has it and the checkout tracks it", async () => {
    const { root, port, write, commitAll, onOrigin } = repository();
    await port.createBranch("release/web");
    write("CHANGELOG.md", "## 1.1.0\n");
    const sha = commitAll("chore(release): web 1.1.0");

    await port.push("release/web");

    expect(onOrigin("refs/heads/release/web")).toBe(sha);
    expect(git(["rev-parse", "--abbrev-ref", "@{upstream}"], root)).toBe("origin/release/web");
  });

  it("given a pushed release branch, when shiplane cleans it up after the release, then neither origin nor the checkout keeps it", async () => {
    const { root, port, onOrigin } = repository();
    await port.createBranch("release/web");
    await port.push("release/web");
    await port.switchTo("main");

    await port.deleteRemoteBranch("release/web");
    await port.deleteBranch("release/web");

    expect(onOrigin("refs/heads/release/web")).toBeNull();
    expect(git(["branch", "--list", "release/web"], root)).toBe("");
  });

  it("given two release tags, when they are pushed, then origin has both", async () => {
    const { root, port, onOrigin } = repository();
    const sha = git(["rev-parse", "HEAD"], root);
    await port.tag("web@1.1.0", sha, "web 1.1.0");
    await port.tag("api@2.0.0", sha, "api 2.0.0");

    await port.pushTags(["web@1.1.0", "api@2.0.0"]);

    expect(onOrigin("web@1.1.0^{commit}")).toBe(sha);
    expect(onOrigin("api@2.0.0^{commit}")).toBe(sha);
  });

  it("given a teammate pushed to main, when main is pulled, then the checkout is on their commit", async () => {
    const { root, port, teammate, write, commitAll } = repository();
    const other = teammate();
    write("teammate.md", "hi\n", other);
    const theirs = commitAll("docs: teammate", other);
    git(["push", "--quiet", "origin", "main"], other);

    await port.pull();

    expect(git(["rev-parse", "HEAD"], root)).toBe(theirs);
  });

  it("given origin is gone, when a release branch is pushed, then it fails naming git push", async () => {
    const { origin, port } = repository();
    fs.rmSync(origin, { recursive: true, force: true });

    await expect(port.push("main")).rejects.toThrow(/^git push exited with/);
  });
});

describe("undoing a release that failed", () => {
  it("given a version bumped and a changelog created, when the release is discarded, then the version is back and the changelog is gone, but other untracked files stay", async () => {
    const { root, port, write, read } = repository();
    write("README.md", "# bumped\n");
    write("CHANGELOG.md", "## 1.1.0\n");
    write("scratch.md", "mine\n");

    await port.discard(["CHANGELOG.md"]);

    expect(read("README.md")).toBe("# app\n");
    expect(fs.existsSync(path.join(root, "CHANGELOG.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "scratch.md"))).toBe(true);
  });

  it("given a release created no file, when it is discarded, then untracked files stay", async () => {
    const { root, port, write } = repository();
    write("scratch.md", "mine\n");

    await port.discard([]);

    expect(fs.existsSync(path.join(root, "scratch.md"))).toBe(true);
  });

  it("given an earlier release checked out beside the repo at its tag, when shiplane is done with it, then the checked-out files were that release's and the folder is gone", async () => {
    const { dir, root, port } = repository();
    await port.tag("web@1.0.0", git(["rev-parse", "HEAD"], root), "web 1.0.0");
    const tree = path.join(dir, "worktree");
    await port.addWorktree(tree, "web@1.0.0");
    const checkedOut = fs.readFileSync(path.join(tree, "README.md"), "utf8");

    await port.removeWorktree(tree);

    expect(checkedOut).toBe("# app\n");
    expect(fs.existsSync(tree)).toBe(false);
  });
});
