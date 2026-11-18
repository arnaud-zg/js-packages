import { flyServerHosting } from "@shiplane/fly";
import { npmPackageRegistry } from "@shiplane/npm";
import { comments } from "shiplane";
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

const HEAD = "ae08284f00d1";
const ORIGIN_MAIN = "c0ffee1";
const KIT_CHANGE = "packages/kit/src/index.ts";
const API_CHANGE = "apps/api/src/server.ts";

const KIT_MANIFEST = '{\n  "name": "@acme/kit",\n  "version": "0.5.2"\n}\n';
const PR = { number: 42, url: "https://github.com/acme/repo/pull/42" };
const PUBLISH = ["publish", "--no-git-checks", "--access", "public", "--tag", "snapshot"];
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
    position: { branch: "feat/x", head: HEAD, originMain: ORIGIN_MAIN },
    diffs: { [`${ORIGIN_MAIN}..${HEAD}`]: [KIT_CHANGE, API_CHANGE] },
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
  it("given a branch with an open pull request and --yes, when shiplane runs, then its npm package is published, its temporary npm tag removed, and git keeps no trace", async () => {
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
    expect(world.shell.calls).toContainEqual(
      expect.objectContaining({
        command: "npm",
        args: ["dist-tag", "rm", "@acme/kit", "snapshot"],
      }),
    );
    expect(world.published).toEqual([expect.stringContaining('"version": "0.6.0-feat-x.ae08284"')]);
    expect(world.files.all).toEqual(before);
    expect(world.versioning.applied).toEqual([]);
    expect(world.source.received).toEqual([]);
    expect(world.output.text).toContain("api  test release not available yet");
    expect(world.output.text).toContain(
      "@acme/kit  0.6.0-feat-x.ae08284  npm i @acme/kit@0.6.0-feat-x.ae08284",
    );
    expect(await branchComments(world)).toEqual([
      expect.stringContaining(
        "| [@acme/kit](https://www.npmjs.com/package/@acme/kit) | [0.6.0-feat-x.ae08284](https://www.npmjs.com/package/@acme/kit/v/0.6.0-feat-x.ae08284) | `npm i @acme/kit@0.6.0-feat-x.ae08284` |",
      ),
    ]);
    expect((await branchComments(world))[0]).toContain(
      "Built from [`ae08284`](https://github.com/acme/repo/commit/ae08284f00d1) on `feat/x`.",
    );
    expect((await branchComments(world))[0]).toContain(
      "Test release not available yet: `api` (npm packages only for now).",
    );
  });

  it("given a package published under another name, when its branch release is out, then testers are told to install that name", async () => {
    // given
    const world = setUp();
    const renamed = { ...KIT, options: { publishAs: "@acme/kit-next" } };
    world.context.release.units.splice(0, 1, renamed);

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(world.output.text).toContain("npm i @acme/kit-next@0.6.0-feat-x.ae08284");
    expect(await branchComments(world)).toEqual([
      expect.stringContaining(
        "| [@acme/kit-next](https://www.npmjs.com/package/@acme/kit-next) | [0.6.0-feat-x.ae08284](https://www.npmjs.com/package/@acme/kit-next/v/0.6.0-feat-x.ae08284) | `npm i @acme/kit-next@0.6.0-feat-x.ae08284` |",
      ),
    ]);
  });

  it("given a package that publishes to a private registry, when its branch release is out, then the comment names it without npmjs links", async () => {
    // given
    const world = setUp();
    world.files.write(
      "packages/kit/package.json",
      '{\n  "name": "@acme/kit",\n  "version": "0.5.2",\n  "publishConfig": { "registry": "https://npm.acme.dev" }\n}\n',
    );

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(await branchComments(world)).toEqual([
      expect.stringContaining(
        "| @acme/kit | 0.6.0-feat-x.ae08284 | `npm i @acme/kit@0.6.0-feat-x.ae08284` |",
      ),
    ]);
  });

  it("given a branch released once, when a new commit is released again, then the same comment is edited", async () => {
    // given
    const world = setUp();
    await branchRelease(world.context, { onDefault: "release" });
    world.source.seed({
      position: { branch: "feat/x", head: "b1b2b3b4b5", originMain: ORIGIN_MAIN },
      diffs: { [`${ORIGIN_MAIN}..b1b2b3b4b5`]: [KIT_CHANGE] },
    });

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(await branchComments(world)).toEqual([
      expect.stringContaining(
        "Built from [`b1b2b3b`](https://github.com/acme/repo/commit/b1b2b3b4b5)",
      ),
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
        label: "Publish a test release",
        hint: "0.6.0-feat-x.ae08284 → no npm tag",
      },
      {
        value: "switch",
        label: "Switch to main",
        hint: "git switch main && git pull, then the real release",
      },
    ]);
  });

  it("given a branch with no pull request, when shiplane runs, then it publishes, prints the install table and comments nowhere", async () => {
    // given
    const world = setUp({ pr: false });

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(true);
    expect(world.published).toEqual([expect.stringContaining('"version": "0.6.0-feat-x.ae08284"')]);
    expect(world.output.text).toContain(
      "@acme/kit  0.6.0-feat-x.ae08284  npm i @acme/kit@0.6.0-feat-x.ae08284",
    );
    expect(world.output.text).not.toContain("The install lines are on");
    expect(world.host.received).not.toContainEqual(
      expect.objectContaining({ type: "upsert-comment" }),
    );
  });

  it("given a branch with no pull request in a terminal, when shiplane runs, then the person is still asked first", async () => {
    // given
    const world = setUp({ pr: false, yes: false });
    world.prompter.answer("publish");

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(true);
    expect(world.prompter.asked).toEqual(["You're on feat/x, not main."]);
    expect(world.published).toHaveLength(1);
  });

  it("given a compact comment in the config, when the branch release is out, then the pull request gets one line under the marker", async () => {
    // given
    const world = setUp();
    world.context.release.testComment = comments.compact;

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(await branchComments(world)).toEqual([
      `${MARKER}\n📦 Test version of \`feat/x\` ([\`ae08284\`](https://github.com/acme/repo/commit/ae08284f00d1)): \`npm i @acme/kit@0.6.0-feat-x.ae08284\`\n`,
    ]);
  });

  it("given a comment of its own in the config, when the branch release is out, then its placeholders are filled", async () => {
    // given
    const world = setUp();
    world.context.release.testComment = "Try it: {install}";

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(await branchComments(world)).toEqual([
      `${MARKER}\nTry it: \`npm i @acme/kit@0.6.0-feat-x.ae08284\``,
    ]);
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
    expect(world.host.received).toContainEqual(
      expect.objectContaining({ type: "pr", base: "master" }),
    );
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

  it("given a package changed on the branch with no changeset, when a test release runs, then nothing publishes and it says to add a changeset", async () => {
    // given
    const world = setUp();
    world.versioning.seed({ pending: [], plan: planFrom([], {}) });

    // when
    const done = await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(done).toBe(true);
    expect(world.output.text).toContain(
      "nothing pending: a test release publishes what the changesets release",
    );
    expect(world.shell.calls).toEqual([]);
  });

  it("given a package with a changeset the branch did not touch, when a test release runs, then it publishes: the changesets say what ships", async () => {
    // given
    const world = setUp();
    world.source.seed({ diffs: { [`${ORIGIN_MAIN}..${HEAD}`]: [API_CHANGE] } });

    // when
    await branchRelease(world.context, { onDefault: "release" });

    // then
    expect(world.published).toEqual([expect.stringContaining('"version": "0.6.0-feat-x.ae08284"')]);
  });

  it("given beta.0 already on npm, when a beta test release runs, then npm gets 0.6.0-beta.1 under the beta tag", async () => {
    // given
    const world = setUp();
    world.shell.seed("npm view @acme/kit versions", { stdout: '["0.5.2","0.6.0-beta.0"]' });

    // when
    const done = await branchRelease(world.context, { onDefault: "publish", channel: "beta" });

    // then
    expect(done).toBe(true);
    expect(world.shell.calls).toContainEqual(
      expect.objectContaining({ args: [...PUBLISH.slice(0, -1), "beta"] }),
    );
    expect(world.published).toEqual([expect.stringContaining('"version": "0.6.0-beta.1"')]);
    expect((await branchComments(world))[0]).toContain(
      "To follow each new beta instead, install the tag: `npm i @acme/kit@beta`.",
    );
  });

  it("given a release that ships, when it publishes to npm, then it publishes under latest, never a test tag", () => {
    // given
    const world = setUp();
    const port = npmPackageRegistry().create({ root: "/repo", shell: world.shell });

    // when
    const jobs = port.jobs({
      unit: KIT,
      tag: "kit@0.5.2",
      environment: "preview",
      commit: HEAD,
      defaultBranch: "main",
      options: { access: "public", tag: "latest" },
    });

    // then
    expect(jobs[0]?.local.at(-1)?.args).toEqual([...PUBLISH.slice(0, -1), "latest"]);
  });

  it("given the branch command on the default branch, when it runs in a terminal, then it publishes what the next release ships at its next version, as a main test version, without asking", async () => {
    // given
    const world = setUp({ yes: false, pr: false });
    world.source.seed({ position: { branch: "main", head: "c0ffee1d", originMain: "c0ffee1d" } });

    // when
    const done = await branchRelease(world.context, { onDefault: "publish" });

    // then
    expect(done).toBe(true);
    expect(world.prompter.asked).toEqual([]);
    expect(world.shell.calls).toContainEqual(expect.objectContaining({ args: PUBLISH }));
    expect(world.published).toEqual([expect.stringContaining('"version": "0.6.0-main.c0ffee1"')]);
    expect(world.output.text).toContain("api  test release not available yet");
    expect(world.output.text).toContain(
      "@acme/kit  0.6.0-main.c0ffee1  npm i @acme/kit@0.6.0-main.c0ffee1",
    );
    expect(world.versioning.applied).toEqual([]);
    expect(world.source.received).toEqual([]);
    expect(world.host.received).not.toContainEqual(
      expect.objectContaining({ type: "upsert-comment" }),
    );
  });

  it("given the branch command on the default branch with no pending change, when it runs, then it says so and publishes nothing", async () => {
    // given
    const world = setUp();
    world.versioning.seed({ pending: [], plan: planFrom([], {}) });
    world.source.seed({ position: { branch: "main", head: "c0ffee1", originMain: "c0ffee1" } });

    // when
    const done = await branchRelease(world.context, { onDefault: "publish" });

    // then
    expect(done).toBe(true);
    expect(world.output.text).toContain("nothing pending");
    expect(world.shell.calls).toEqual([]);
  });
});
