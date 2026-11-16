import { flyServerHosting } from "@shiplane/fly";
import { npmPackageRegistry } from "@shiplane/npm";
import { backendService, publishedPackage } from "shiplane/plugin";
import {
  branchRelease,
  changesetText,
  MemoryFiles,
  planFrom,
  testContext,
  testUnit,
} from "shiplane/testing";
import { describe, expect, it } from "vitest";

const KIT = testUnit("kit", {
  dir: "packages/kit",
  file: "packages/kit/shiplane.unit.yml",
  packageName: "@acme/kit",
  version: "0.5.2",
  module: "published-package",
});

const API = testUnit("api", {
  version: "0.0.3",
  module: "backend-service",
  options: {
    app: { preview: "acme-api-preview", production: "acme-api-production" },
    config: { preview: "fly-preview.toml", production: "fly-production.toml" },
  },
});

const MODULES = [
  publishedPackage({ packageRegistry: npmPackageRegistry() }),
  backendService({ serverHosting: flyServerHosting() }),
];

const CHANGESET = {
  id: "brave-kits-sing",
  summary: "Add a branch release",
  releases: [
    { name: "@acme/kit", type: "minor" as const },
    { name: "@acme/api", type: "patch" as const },
  ],
};

const KIT_MANIFEST = '{\n  "name": "@acme/kit",\n  "version": "0.5.2"\n}\n';
const PR = { number: 42, url: "https://github.com/acme/repo/pull/42" };
const PUBLISH = ["publish", "--no-git-checks", "--access", "public", "--tag", "feat-x"];
const MARKER = "<!-- shiplane:branch-release -->";

const setUp = ({ yes = true, interactive = true, pr = true } = {}) => {
  const files = new MemoryFiles({
    "packages/kit/package.json": KIT_MANIFEST,
    ".changeset/brave-kits-sing.md": changesetText(
      { "@acme/kit": "minor", "@acme/api": "patch" },
      CHANGESET.summary,
    ),
  });
  const world = testContext({ units: [KIT, API], modules: MODULES, yes, interactive, files });
  world.versioning.seed({
    pending: [{ id: CHANGESET.id, text: changesetText({ "@acme/kit": "minor" }, "x") }],
    plan: planFrom([CHANGESET], { "@acme/kit": "0.5.2", "@acme/api": "0.0.3" }),
  });
  world.source.seed({
    position: { branch: "feat/x", head: "ae08284f00d1", originMain: "c0ffee1" },
  });
  if (pr) world.host.seed({ openPrs: [{ branch: "feat/x", pr: { ...PR } }] });
  // What package.json holds at the moment npm publishes it.
  const published: (string | null)[] = [];
  const attach = world.shell.attach;
  world.shell.attach = (command, args, options) => {
    if (args[0] === "publish") published.push(files.read("packages/kit/package.json"));
    return attach(command, args, options);
  };
  return { ...world, files, published };
};

const branchComments = async (world: ReturnType<typeof setUp>) =>
  (await world.host.comments([{ repository: "acme/repo", number: PR.number }]))
    .flat()
    .filter((body) => body.includes(MARKER));

describe("Feature: a branch release for testers", () => {
  it("given a branch with an open pull request and --yes, when shiplane runs, then its npm package is published under the branch's tag and git keeps no trace", async () => {
    // given
    const world = setUp();
    const before = world.files.all;

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(true);
    expect(world.shell.calls).toContainEqual({
      command: "pnpm",
      args: PUBLISH,
      cwd: "/repo/packages/kit",
      env: undefined,
    });
    expect(world.published).toEqual([
      expect.stringContaining('"version": "0.6.0-feat-x.ae08284"'),
    ]);
    expect(world.files.all).toEqual(before);
    expect(world.versioning.applied).toEqual([]);
    expect(world.source.received).toEqual([]);
    expect(world.output.text).toContain("api  not part of a branch release");
    expect(world.output.text).toContain("@acme/kit  0.6.0-feat-x.ae08284  npm i @acme/kit@feat-x");
    expect(await branchComments(world)).toEqual([
      expect.stringContaining("| @acme/kit | 0.6.0-feat-x.ae08284 | `npm i @acme/kit@feat-x` |"),
    ]);
  });

  it("given a branch released once, when a new commit is released again, then the same comment is edited", async () => {
    // given
    const world = setUp();
    await branchRelease(world.context, { onDefault: "release" });
    world.source.seed({
      position: { branch: "feat/x", head: "b1b2b3b4b5", originMain: "c0ffee1" },
    });

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(await branchComments(world)).toEqual([
      expect.stringContaining("Branch release for b1b2b3b"),
    ]);
  });

  it("given a branch with an open pull request in a terminal, when shiplane runs, then the person picks between a branch release and the real one", async () => {
    // given
    const world = setUp({ yes: false });
    world.prompter.answer("publish");

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(true);
    expect(world.prompter.asked).toEqual(["You're on feat/x, not main."]);
    expect(world.prompter.choices["You're on feat/x, not main."]).toEqual([
      {
        value: "publish",
        label: "Publish a branch release",
        hint: "0.6.0-feat-x.ae08284 → npm tag feat-x",
      },
      {
        value: "switch",
        label: "Switch to main",
        hint: "git switch main && git pull, then the real release",
      },
    ]);
  });

  it("given a branch with no pull request, when shiplane runs, then it asks for one and publishes nothing", async () => {
    // given
    const world = setUp({ pr: false });

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(false);
    expect(world.output.text).toContain("open a pull request for feat/x first, or switch to main");
    expect(world.output.text).toContain("git switch main");
    expect(world.shell.calls).toEqual([]);
  });

  it("given a repository whose default branch is master, when shiplane runs on master, then the real release runs from it", async () => {
    // given
    const world = setUp();
    world.source.seed({
      position: { branch: "master", head: "c0ffee1", originMain: "c0ffee1" },
      defaultBranch: "master",
    });
    world.host.seed({ prStates: { 1800: ["CLOSED"] } });

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(world.output.text).not.toContain("Not from main");
    expect(world.host.received).toContainEqual(expect.objectContaining({ type: "pr", base: "master" }));
    expect(world.source.received).toContainEqual({ type: "switch", branch: "master" });
  });

  it("given uncommitted changes, when a branch release would start, then it refuses and publishes nothing", async () => {
    // given
    const world = setUp();
    world.source.seed({ clean: false });

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(false);
    expect(world.output.text).toContain("Uncommitted changes");
    expect(world.shell.calls).toEqual([]);
  });

  it("given npm refuses the publish, when the branch release fails, then package.json is put back and no comment is posted", async () => {
    // given
    const world = setUp();
    world.shell.seed("pnpm publish", { status: 1 });
    const before = world.files.all;

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(false);
    expect(world.files.all).toEqual(before);
    expect(await branchComments(world)).toEqual([]);
  });

  it("given nothing pending, when a branch release runs, then it says how to add a change", async () => {
    // given
    const world = setUp();
    world.versioning.seed({ pending: [], plan: planFrom([], {}) });

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(true);
    expect(world.output.text).toContain("nothing to release: add a change with pnpm changeset");
    expect(world.shell.calls).toEqual([]);
  });

  it("given the branch command on the default branch, when it runs, then it refuses: a branch release needs a branch", async () => {
    // given
    const world = setUp();
    world.source.seed({ position: { branch: "main", head: "c0ffee1", originMain: "c0ffee1" } });

    // when
    const done = await branchRelease(world.context, { onDefault: "refuse" });

    // then
    expect(done).toBe(false);
    expect(world.shell.calls).toEqual([]);
  });
});
