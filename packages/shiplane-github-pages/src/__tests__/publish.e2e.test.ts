import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { RecordingShell, TEST_FLOW, testUnit } from "shiplane/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { githubPagesStaticHosting } from "../github-pages-static-hosting.adapter";

// The commands the adapter gives, run for real against a bare repository on this disk.

const GH_PAGES = createRequire(import.meta.url).resolve("gh-pages/bin/gh-pages.js");
const pages = githubPagesStaticHosting();

// A git hook runs the tests with its own repository in GIT_*: none of it may reach these.
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(GIT|GITHUB)_/.test(name)),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

let home = "";
let repo = "";
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: repo, env: ENV, encoding: "utf8", stdio: "pipe" });
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};
const build = (files: Record<string, string>) => {
  fs.rmSync(path.join(repo, "apps/site/dist"), { recursive: true, force: true });
  Object.entries(files).forEach(([file, text]) => {
    write(`apps/site/dist/${file}`, text);
  });
};

const ship = (
  environment: "preview" | "production",
  tag: string,
  settings: Record<string, unknown> = {},
) => {
  const [job] = pages.create({ root: repo, shell: new RecordingShell() }).jobs({
    flow: TEST_FLOW,
    unit: testUnit("site", { module: "web-app" }),
    tag,
    environment,
    commit: "abc1234",
    defaultBranch: "main",
    options: pages.settings.parse({ url: "https://acme.github.io/site/", ...settings }),
  });
  for (const { command, args } of job?.local ?? []) {
    if (command === "pnpm") continue;
    // The pinned package, from this workspace instead of npm.
    if (command === "npx") run(process.execPath, [GH_PAGES, ...args.slice(2)]);
    else run(command, args);
  }
};

const published = (branch = "gh-pages") => {
  run("git", ["fetch", "-q", "origin", branch]);
  return run("git", ["ls-tree", "-r", "--name-only", "FETCH_HEAD"]).trim().split("\n").sort();
};
const commits = () => run("git", ["log", "--format=%s", "FETCH_HEAD"]).trim().split("\n");

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplane-github-pages-"));
  repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  // As on GitHub, what a clone checks out is the source.
  run("git", ["init", "-q", "--bare", "-b", "main", path.join(home, "origin.git")]);
  run("git", ["init", "-q", "-b", "main"]);
  run("git", ["remote", "add", "origin", path.join(home, "origin.git")]);
  write("package.json", '{ "name": "acme" }');
  write("src/secret.ts", "source");
  write(".github/settings.yml", "source");
  write(".gitignore", "node_modules\ndist\n");
  run("git", ["add", "."]);
  run("git", ["commit", "-q", "-m", "source"]);
  run("git", ["push", "-q", "origin", "main"]);
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("publishing to the branch GitHub Pages serves", () => {
  it.each([
    ["preview", ["preview/index.html"]],
    ["production", ["index.html"]],
  ] as const)(
    "given no branch yet, when the site first ships to %s, then the branch holds the site and none of the source",
    (environment, files) => {
      build({ "index.html": "v1" });

      ship(environment, "site@1.0.0");

      expect(published()).toEqual([".nojekyll", ...files]);
    },
  );

  it("given preview and production in turn, when each ships again, then each replaces its own files and keeps the other's", () => {
    build({ "index.html": "v1", "old.js": "v1", "a/old.js": "v1" });
    ship("preview", "site@1.0.0");
    ship("production", "site@1.0.0");
    build({ "index.html": "v2", "a/new.js": "v2" });
    ship("production", "site@1.1.0");

    expect(published()).toEqual([
      ".nojekyll",
      "a/new.js",
      "index.html",
      "preview/a/old.js",
      "preview/index.html",
      "preview/old.js",
    ]);

    ship("preview", "site@1.1.0");

    expect(published()).toEqual([
      ".nojekyll",
      "a/new.js",
      "index.html",
      "preview/a/new.js",
      "preview/index.html",
    ]);
    expect(commits()).toEqual([
      "site@1.1.0",
      "site@1.1.0",
      "site@1.0.0",
      "site@1.0.0",
      "start gh-pages",
    ]);
  });

  it("given a site with dotfiles, when it ships, then they are published", () => {
    build({ "index.html": "v1", ".well-known/security.txt": "v1" });

    ship("production", "site@1.0.0");

    expect(published()).toEqual([".nojekyll", ".well-known/security.txt", "index.html"]);
  });

  it("given a custom domain, when production ships again without naming it, then CNAME is kept", () => {
    build({ "index.html": "v1" });
    ship("production", "site@1.0.0", { domain: "www.acme.dev" });
    build({ "index.html": "v2" });
    ship("production", "site@1.1.0");

    expect(published()).toEqual([".nojekyll", "CNAME", "index.html"]);
    expect(run("git", ["show", "FETCH_HEAD:CNAME"])).toBe("www.acme.dev");
  });

  it("given the same build again, when it ships, then no commit is added", () => {
    build({ "index.html": "v1" });
    ship("production", "site@1.0.0");
    ship("production", "site@1.0.0");
    published();

    expect(commits()).toEqual(["site@1.0.0", "start gh-pages"]);
  });

  it("given another branch, when the site ships, then it goes there and main is untouched", () => {
    build({ "index.html": "v1" });

    ship("production", "site@1.0.0", { branch: "master" });

    expect(published("master")).toEqual([".nojekyll", "index.html"]);
    expect(published("main")).toContain("src/secret.ts");
  });
});
