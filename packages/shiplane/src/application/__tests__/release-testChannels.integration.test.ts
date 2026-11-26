import { describe, expect, it } from "vitest";

import { testReleases } from "../../domain/testChannel";
import { branchRelease } from "../branchRelease";
import { BRANCH, branchWorld, HEAD, kit, lib, LIB_MANIFEST, manifest } from "./releaseBranchWorld";

const publishes = (shell: { calls: { args: string[] }[] }) =>
  shell.calls.map(({ args }) => args.join(" "));

const withTestRelease = <World extends ReturnType<typeof branchWorld>>(
  world: World,
  testRelease: Record<string, string>,
) => ({ ...world.context, release: { ...world.context.release, testRelease } });

describe("publishing a test release on a numbered channel", () => {
  it("given beta named on the command line and nothing on beta yet, when it publishes, then the package takes <next>-beta.0 under the beta tag", async () => {
    const { context, shell, distTags, output } = branchWorld();

    const done = await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(done).toBe(true);
    expect(publishes(shell)).toEqual(["publish @acme/lib 1.3.0-beta.0"]);
    expect(distTags).toEqual(["beta"]);
    expect(output.text).toContain("npm i @acme/lib@1.3.0-beta.0");
  });

  it("given beta.0 and beta.1 already on the registry, when beta publishes again, then it takes beta.2", async () => {
    const { context, shell, registry } = branchWorld();
    registry.fake.seed({ published: ["@acme/lib@1.3.0-beta.0", "@acme/lib@1.3.0-beta.1"] });

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(publishes(shell)).toEqual(["publish @acme/lib 1.3.0-beta.2"]);
  });

  it("given a fixed group whose packages took different numbers, when beta publishes, then each takes the group's highest", async () => {
    const world = branchWorld({
      units: [lib, kit],
      pending: [
        { name: "@acme/lib", newVersion: "1.3.0" },
        { name: "@acme/ui-kit", newVersion: "1.3.0" },
      ],
      files: {
        "packages/lib/package.json": LIB_MANIFEST,
        "packages/kit/package.json": manifest({ name: "@acme/ui-kit", version: "1.2.0" }),
      },
    });
    world.registry.fake.seed({ published: ["@acme/lib@1.3.0-beta.0", "@acme/lib@1.3.0-beta.1"] });
    Object.assign(world.versioning, {
      fixedGroups: () => Promise.resolve([["@acme/lib", "@acme/ui-kit"]]),
    });

    await branchRelease(world.context, { onDefault: "publish", channel: "beta" });

    expect(publishes(world.shell)).toEqual([
      "publish @acme/lib 1.3.0-beta.2",
      "publish @acme/ui-kit 1.3.0-beta.2",
    ]);
  });

  it("given a branch the config maps to a channel, when it publishes without naming one, then it takes the config's channel", async () => {
    const world = branchWorld();
    world.source.seed({ position: { branch: "release/1.3", head: HEAD, originMain: "main-tip" } });

    await branchRelease(withTestRelease(world, testReleases.gitflow), { onDefault: "publish" });

    expect(publishes(world.shell)).toEqual(["publish @acme/lib 1.3.0-beta.0"]);
    expect(world.distTags).toEqual(["beta"]);
  });

  it("given the config maps the branch and the command line names another channel, when it publishes, then the command line wins", async () => {
    const world = branchWorld();

    await branchRelease(withTestRelease(world, { [BRANCH]: "beta" }), {
      onDefault: "publish",
      channel: "rc",
    });

    expect(world.distTags).toEqual(["rc"]);
  });

  it("given a beta on the pull request, when it comments, then the comment names the channel and offers its tag to follow each new beta", async () => {
    const { context, host } = branchWorld();
    host.seed({
      openPrs: [
        {
          branch: BRANCH,
          pr: { number: 42, url: "https://host.test/acme/repo/pull/42", head: HEAD },
        },
      ],
    });

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    const [event] = host.received;
    const body = event?.type === "upsert-comment" ? event.body : "";
    expect(body).toContain("test versions on the `beta` channel");
    expect(body).toContain(
      "To follow each new beta instead, install the tag: `npm i @acme/lib@beta`.",
    );
  });
});

describe("building what a test release publishes", () => {
  it("given a prepare in the config, when a test release publishes, then each package is prepared before it publishes", async () => {
    const world = branchWorld();
    const context = {
      ...world.context,
      release: { ...world.context.release, prepare: "pnpm --filter ./{dir} build" },
    };

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(publishes(world.shell)).toEqual([
      "-c pnpm --filter ./packages/lib build",
      "publish @acme/lib 1.3.0-beta.0",
    ]);
  });

  it("given a prepare that fails, when a test release runs, then nothing publishes", async () => {
    const world = branchWorld();
    world.shell.seedOnce("sh -c pnpm --filter ./packages/lib build", { status: 1 });
    const context = {
      ...world.context,
      release: { ...world.context.release, prepare: "pnpm --filter ./{dir} build" },
    };

    const done = await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(done).toBe(false);
    expect(publishes(world.shell)).not.toContain("publish @acme/lib 1.3.0-beta.0");
  });
});

describe("refusing a channel a test release cannot take", () => {
  it("given latest on the command line, when it runs, then nothing publishes and it says latest is the real release's", async () => {
    const { context, shell, output } = branchWorld();

    const done = await branchRelease(context, { onDefault: "publish", channel: "latest" });

    expect(done).toBe(false);
    expect(shell.calls).toEqual([]);
    expect(output.text).toContain("latest is the real release's tag");
  });

  it("given a registry that cannot list its versions, when a numbered channel publishes, then nothing publishes and it says so", async () => {
    const { context, shell, registry, output } = branchWorld();
    Object.assign(registry.fake, { publishedVersions: undefined });

    const done = await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(done).toBe(false);
    expect(shell.calls).toEqual([]);
    expect(output.text).toContain("cannot list its versions");
  });
});

describe("showing a test release without publishing it", () => {
  it("given --dry-run, when it runs, then each package's version and tag are shown and nothing is written or published", async () => {
    const { context, shell, files, output } = branchWorld();

    const done = await branchRelease(context, {
      onDefault: "publish",
      channel: "nightly",
      dryRun: true,
    });

    expect(done).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(files.changes).toEqual([]);
    expect(output.text).toContain("Would publish on nightly, npm tag nightly (dry run)");
    expect(output.text).toContain("1.3.0-nightly.0");
    expect(output.text).toContain("Nothing published.");
  });
});

describe("choosing which pending packages get a test release", () => {
  const PICK = "Which pending packages get a test release?";
  const twoPackages = () =>
    branchWorld({
      units: [lib, kit],
      pending: [
        { name: "@acme/lib", newVersion: "1.3.0" },
        { name: "@acme/ui-kit", newVersion: "0.5.0" },
      ],
      files: {
        "packages/lib/package.json": LIB_MANIFEST,
        "packages/kit/package.json": manifest({ name: "@acme/ui-kit", version: "0.4.0" }),
      },
      yes: false,
      interactive: true,
    });

  it("given two pending packages in a terminal, when the person keeps one, then only that one publishes", async () => {
    const { context, prompter, shell } = twoPackages();
    prompter.answer(["kit"]);

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(prompter.initials[PICK]).toEqual(["lib", "kit"]);
    expect(publishes(shell)).toEqual(["publish @acme/ui-kit 0.5.0-beta.0"]);
  });

  it("given two pending packages under --yes, when it publishes, then both publish without asking", async () => {
    const world = twoPackages();
    const context = { ...world.context, options: { ...world.context.options, yes: true } };

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(world.prompter.asked).toEqual([]);
    expect(publishes(world.shell)).toHaveLength(2);
  });

  it("given the person keeps none, when the question closes, then nothing runs", async () => {
    const { context, prompter, shell } = twoPackages();
    prompter.answer([]);

    const done = await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(done).toBe(true);
    expect(shell.calls).toEqual([]);
  });
});

describe("showing a test release on a runner's run page", () => {
  const SUMMARY = "/runner/summary.md";
  const onRunner = () => {
    const world = branchWorld({
      units: [lib, kit],
      pending: [
        { name: "@acme/lib", newVersion: "1.3.0" },
        { name: "@acme/ui-kit", newVersion: "0.5.0" },
      ],
      files: {
        "packages/lib/package.json": LIB_MANIFEST,
        "packages/kit/package.json": manifest({ name: "@acme/ui-kit", version: "0.4.0" }),
      },
    });
    world.context.options.ci = true;
    world.shell.seedEnv({ GITHUB_STEP_SUMMARY: SUMMARY });
    return world;
  };
  const PLAN =
    "### Ship to beta: 2 packages\n\n| Package | Version |\n| --- | --- |\n| @acme/lib | 1.3.0-beta.0 |\n| @acme/ui-kit | 0.5.0-beta.0 |\n\n";
  const result = (libResult: string, kitResult: string) =>
    `### Result\n\n| Package | Version | Result |\n| --- | --- | --- |\n| @acme/lib | 1.3.0-beta.0 | ${libResult} |\n| @acme/ui-kit | 0.5.0-beta.0 | ${kitResult} |\n\n`;

  it("given a runner, when a test release publishes, then the run page has the plan, then each package's success", async () => {
    const { context, files } = onRunner();

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(files.read(SUMMARY)).toBe(PLAN + result("success", "success"));
  });

  it("given the first package failing on a runner, when a test release publishes, then the run page says it failed and the next was skipped", async () => {
    const { context, files, shell } = onRunner();
    shell.seed("sh -c make lib", { status: 1 });
    const prepared = { ...context, release: { ...context.release, prepare: "make {unit}" } };

    const done = await branchRelease(prepared, { onDefault: "publish", channel: "beta" });

    expect(done).toBe(false);
    expect(files.read(SUMMARY)).toBe(PLAN + result("failed", "skipped"));
  });

  it("given a package prepared but not published on a runner, when a test release stops, then the run page says failed, not success", async () => {
    const { context, files, shell } = onRunner();
    const attach = shell.attach;
    shell.attach = (command, args, options) =>
      args.includes("publish") ? Promise.resolve(1) : attach(command, args, options);
    const prepared = { ...context, release: { ...context.release, prepare: "make {unit}" } };

    await branchRelease(prepared, { onDefault: "publish", channel: "beta" });

    expect(files.read(SUMMARY)).toBe(PLAN + result("failed", "skipped"));
  });

  it("given a dry run on a runner, when it runs, then the run page has the plan and no result", async () => {
    const { context, files } = onRunner();

    await branchRelease(context, { onDefault: "publish", channel: "beta", dryRun: true });

    expect(files.read(SUMMARY)).toBe(PLAN.replace("beta:", "beta (dry run):"));
  });

  it("given a laptop, when a test release publishes, then no run page is written", async () => {
    const { context, files } = onRunner();
    context.options.ci = false;

    await branchRelease(context, { onDefault: "publish", channel: "beta" });

    expect(files.read(SUMMARY)).toBeNull();
  });
});
