import { describe, expect, it } from "vitest";

import { BRANCH_COMMENT_MARKER } from "../../domain/branchRelease";
import { testUnit } from "../../testing/releaseContext";
import { branchRelease } from "../branchRelease";
import {
  BRANCH,
  branchWorld,
  HEAD,
  kit,
  lib,
  LIB_MANIFEST,
  LIB_VERSION,
  manifest,
  TAG,
} from "./releaseBranchWorld";

const PR = { number: 42, url: "https://github.com/acme/repo/pull/42", head: HEAD };

const publishLine = (name: string, version: string) => `echo publish ${name} ${version}`;

describe("publishing a test version of a feature branch", () => {
  it("given a branch that changed an npm package and a web app, when shiplane runs with --yes, then the package publishes at its branch version under the shared snapshot tag and the web app waits", async () => {
    const { context, shell, distTags, output, progress } = branchWorld();

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(shell.calls.map(({ command, args }) => [command, ...args].join(" "))).toEqual([
      publishLine("@acme/lib", LIB_VERSION),
    ]);
    expect(shell.calls[0]?.cwd).toBe("/repo");
    expect(distTags).toEqual([TAG]);
    expect(progress.events.filter(({ kind }) => kind === "during").map(({ text }) => text)).toEqual(
      [`set lib ${LIB_VERSION}`, `publish @acme/lib@${LIB_VERSION} under latest (fake)`],
    );
    expect(output.lines).toEqual([
      "  – web  test release not available yet: npm packages only",
      `✓ Published under npm tag ${TAG}`,
      "  Package    Version                        Install",
      `  @acme/lib  ${LIB_VERSION}  npm i @acme/lib@${LIB_VERSION}`,
    ]);
  });

  it("given a package to publish, when the test version publishes, then npm sees the branch version and the manifest is put back as it was after", async () => {
    const { context, files, manifestsAtRun } = branchWorld();

    await branchRelease(context, { onDefault: "release" });

    expect(manifestsAtRun).toEqual([
      {
        "packages/lib": manifest({ name: "@acme/lib", version: LIB_VERSION, private: false }),
        "apps/web": null,
      },
    ]);
    expect(files.read("packages/lib/package.json")).toBe(LIB_MANIFEST);
    expect(files.changes).toEqual([
      { kind: "write", file: "packages/lib/package.json" },
      { kind: "write", file: "packages/lib/package.json" },
    ]);
  });

  it("given the publish command fails, when the test version stops, then the manifest is put back, nothing is commented and the run fails", async () => {
    const { context, shell, host, files, output } = branchWorld();
    host.seed({ openPrs: [{ branch: BRANCH, pr: PR }] });
    shell.seed("echo publish", { status: 1 });

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(false);
    expect(files.read("packages/lib/package.json")).toBe(LIB_MANIFEST);
    expect(host.received).toEqual([]);
    expect(output.text).not.toContain("Published under npm tag");
  });

  it("given a package whose manifest is gone, when the test version publishes, then no manifest is written for it", async () => {
    const { context, files, shell } = branchWorld({ files: {} });

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(files.changes).toEqual([]);
    expect(shell.calls).toHaveLength(1);
  });

  it("given two changed packages, when the test version publishes, then each gets its branch version and the install table stays aligned", async () => {
    const { context, output, shell } = branchWorld({
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

    await branchRelease(context, { onDefault: "release" });

    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual([
      `publish @acme/lib ${LIB_VERSION}`,
      "publish @acme/ui-kit 0.5.0-feat-login-page.abc1234",
    ]);
    expect(output.lines).toEqual([
      `✓ Published under npm tag ${TAG}`,
      "  Package       Version                        Install",
      `  @acme/lib     ${LIB_VERSION}  npm i @acme/lib@${LIB_VERSION}`,
      `  @acme/ui-kit  0.5.0-feat-login-page.abc1234  npm i @acme/ui-kit@0.5.0-feat-login-page.abc1234`,
    ]);
  });

  it("given a registry that publishes the package under another name, when the test version publishes, then the install line names it as the registry does", async () => {
    const { context, registry, output } = branchWorld();
    registry.fake.publishedName = ({ unit }) => `@pub/${unit.name}`;

    await branchRelease(context, { onDefault: "release" });

    expect(output.text).toContain(`npm i @pub/lib@${LIB_VERSION}`);
  });
});

describe("telling reviewers how to install a test version", () => {
  it("given the branch has a pull request, when the test version publishes, then its comment links the commit and the npm pages and names what was left out", async () => {
    const { context, host, output } = branchWorld();
    host.seed({ openPrs: [{ branch: BRANCH, pr: PR }] });

    await branchRelease(context, { onDefault: "release" });

    const [event] = host.received;
    expect(event).toMatchObject({ type: "upsert-comment", issue: "acme/repo#42", edited: false });
    const body = event?.type === "upsert-comment" ? event.body : "";
    expect(body.startsWith(`${BRANCH_COMMENT_MARKER}\n`)).toBe(true);
    expect(body).toContain(
      `Built from [\`abc1234\`](https://github.com/acme/repo/commit/${HEAD}) on \`${BRANCH}\`.`,
    );
    expect(body).toContain(
      `| [@acme/lib](https://www.npmjs.com/package/@acme/lib) | [${LIB_VERSION}](https://www.npmjs.com/package/@acme/lib/v/${LIB_VERSION}) | \`npm i @acme/lib@${LIB_VERSION}\` |`,
    );
    expect(body).toContain("Test release not available yet: `web` (npm packages only for now).");
    expect(output.lines.at(-1)).toBe("  The install lines are on #42 too.");
  });

  it("given the team's own comment template, when the test version publishes, then the pull request comment follows it", async () => {
    const world = branchWorld();
    world.host.seed({ openPrs: [{ branch: BRANCH, pr: PR }] });
    const context = {
      ...world.context,
      release: { ...world.context.release, testComment: "Try {install} from {branch}" },
    };

    await branchRelease(context, { onDefault: "release" });

    expect(world.host.received).toEqual([
      expect.objectContaining({
        body: `${BRANCH_COMMENT_MARKER}\nTry \`npm i @acme/lib@${LIB_VERSION}\` from ${BRANCH}`,
      }),
    ]);
  });

  it("given a package published to a registry other than npmjs, when the test version publishes, then its comment row has no npmjs link", async () => {
    const { context, host } = branchWorld({
      files: {
        "packages/lib/package.json": manifest({
          name: "@acme/lib",
          version: "1.2.0",
          publishConfig: { registry: "https://npm.pkg.github.com" },
        }),
      },
    });
    host.seed({ openPrs: [{ branch: BRANCH, pr: PR }] });

    await branchRelease(context, { onDefault: "release" });

    expect(host.received).toEqual([
      expect.objectContaining({
        body: expect.stringContaining(
          `| @acme/lib | ${LIB_VERSION} | \`npm i @acme/lib@${LIB_VERSION}\` |`,
        ) as string,
      }),
    ]);
  });

  it.each([
    ["the npmjs registry by address", { registry: "https://registry.npmjs.org/" }],
    ["a publish config without a registry", { access: "public" }],
  ])(
    "given a package published through %s, when the test version publishes, then its comment row links npmjs",
    async (_, publishConfig) => {
      const { context, host } = branchWorld({
        files: {
          "packages/lib/package.json": manifest({
            name: "@acme/lib",
            version: "1.2.0",
            publishConfig,
          }),
        },
      });
      host.seed({ openPrs: [{ branch: BRANCH, pr: PR }] });

      await branchRelease(context, { onDefault: "release" });

      expect(host.received).toEqual([
        expect.objectContaining({
          body: expect.stringContaining(
            "[@acme/lib](https://www.npmjs.com/package/@acme/lib)",
          ) as string,
        }),
      ]);
    },
  );

  it("given the pull request cannot be commented on, when the test version publishes, then the person is told and the publish still counts", async () => {
    const { context, host, output } = branchWorld();
    host.seed({ openPrs: [{ branch: BRANCH, pr: PR }] }).failComment(new Error("no access"));

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(output.lines.at(-1)).toBe("  ! could not comment on #42: no access");
  });
});

describe("knowing when a branch has no test version to publish", () => {
  it("given uncommitted changes, when shiplane runs on a branch, then it refuses before publishing anything", async () => {
    const { context, source, shell, output } = branchWorld();
    source.seed({ clean: false });

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(false);
    expect(shell.calls).toEqual([]);
    expect(output.lines).toEqual([
      "✗ Uncommitted changes: commit or stash them first, a test version publishes the commit you are on.",
    ]);
  });

  it("given no pending changeset, when shiplane runs, then nothing publishes and it says to add one", async () => {
    const { context, progress, shell } = branchWorld({ pending: [] });

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(progress.events).toEqual([
      {
        kind: "say",
        mood: "resting",
        text: "nothing pending: a test release publishes what the changesets release, add one with pnpm changeset",
      },
    ]);
  });

  it("given only the web app pending, when shiplane runs, then it says a test release is not available for it yet", async () => {
    const { context, progress, output } = branchWorld({
      pending: [{ name: "@acme/web", newVersion: "0.2.0" }],
    });

    await branchRelease(context, { onDefault: "release" });

    expect(output.lines).toEqual([
      "  – web  test release not available yet: npm packages only",
      "nothing to publish: no pending unit is an npm package",
    ]);
    expect(progress.events.map(({ mood }) => mood)).toEqual(["resting"]);
  });

  it("given a branch that changed a package with no changeset, when shiplane runs, then only what the changesets release publishes", async () => {
    const { context, shell } = branchWorld({
      pending: [{ name: "@acme/other", newVersion: "1.0.0" }],
    });

    await branchRelease(context, { onDefault: "release" });

    expect(shell.calls).toEqual([]);
  });

  it("given a single package at the repository root pending, when shiplane runs, then its test version publishes and its manifest is put back", async () => {
    const root = testUnit("root", {
      dir: ".",
      packageName: "@acme/root",
      version: "2.0.0",
      module: "published-package",
    });
    const { context, shell, files } = branchWorld({
      units: [root],
      pending: [{ name: "@acme/root", newVersion: "2.1.0" }],
      files: { "package.json": manifest({ name: "@acme/root", version: "2.0.0" }) },
    });

    await branchRelease(context, { onDefault: "release" });

    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual([
      "publish @acme/root 2.1.0-feat-login-page.abc1234",
    ]);
    expect(files.read("package.json")).toBe(manifest({ name: "@acme/root", version: "2.0.0" }));
  });
});

describe("publishing a test version of what main will release next", () => {
  const onMain = (releases: { name: string; newVersion: string }[]) => {
    const world = branchWorld();
    world.source.seed({ position: { branch: "main", head: HEAD, originMain: HEAD } });
    world.versioning.seed({
      plan: () => ({
        changesets: [],
        releases: releases.map(({ name, newVersion }) => ({
          name,
          type: "minor" as const,
          oldVersion: "1.2.0",
          newVersion,
          changesets: [],
        })),
      }),
    });
    return world;
  };

  it("given main with a pending minor change to the package, when the person runs test-release there, then the version the next release takes publishes under the snapshot tag", async () => {
    const { context, shell, output } = onMain([{ name: "@acme/lib", newVersion: "1.3.0" }]);

    const done = await branchRelease(context, { onDefault: "publish" });

    expect(done).toBe(true);
    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual([
      "publish @acme/lib 1.3.0-main.abc1234",
    ]);
    expect(output.lines[0]).toBe("✓ Published under npm tag snapshot");
  });

  it("given main with nothing pending for its units, when the person runs test-release there, then nothing publishes and it says to add a changeset", async () => {
    const { context, progress, shell } = onMain([{ name: "@acme/other", newVersion: "9.0.0" }]);

    await branchRelease(context, { onDefault: "publish" });

    expect(shell.calls).toEqual([]);
    expect(progress.events).toEqual([
      {
        kind: "say",
        mood: "resting",
        text: "nothing pending: a test release publishes what the changesets release, add one with pnpm changeset",
      },
    ]);
  });

  it("given main, when the person runs plain shiplane there, then the real release runs and no test version publishes", async () => {
    const { context, shell, output } = onMain([{ name: "@acme/lib", newVersion: "1.3.0" }]);

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(output.text).toContain("Nothing to release");
  });
});

describe("choosing between a test release and the real one on a feature branch", () => {
  const QUESTION = `You're on ${BRANCH}, not main.`;

  it("given a terminal on a feature branch, when the person runs shiplane, then a test release of the version is recommended over switching to main", async () => {
    const { context, prompter } = branchWorld({ yes: false, interactive: true });
    prompter.answer(null);

    await branchRelease(context, { onDefault: "release" });

    expect(prompter.asked).toEqual([QUESTION]);
    expect(prompter.initials[QUESTION]).toBe("publish");
    expect(prompter.choices[QUESTION]).toEqual([
      {
        value: "publish",
        label: "Publish a test release",
        hint: `${LIB_VERSION} → npm tag ${TAG}`,
      },
      {
        value: "switch",
        label: "Switch to main",
        hint: "git switch main && git pull, then the real release",
      },
    ]);
  });

  it("given two packages to publish, when the person is asked, then the test release says how many packages it publishes", async () => {
    const { context, prompter } = branchWorld({
      units: [lib, kit],
      pending: [
        { name: "@acme/lib", newVersion: "1.3.0" },
        { name: "@acme/ui-kit", newVersion: "0.5.0" },
      ],
      yes: false,
      interactive: true,
    });
    prompter.answer(null);

    await branchRelease(context, { onDefault: "release" });

    expect(prompter.choices[QUESTION]?.[0]?.hint).toBe(`2 packages → npm tag ${TAG}`);
  });

  it("given the person cancels the question, when shiplane stops, then nothing runs", async () => {
    const { context, prompter, shell, output, progress } = branchWorld({
      yes: false,
      interactive: true,
    });
    prompter.answer(null);

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(output.lines.at(-1)).toBe("Nothing ran.");
    expect(progress.events.at(-1)).toMatchObject({ kind: "say", mood: "resting" });
  });

  it("given the person picks the test release, when shiplane goes on, then the package publishes", async () => {
    const { context, prompter, shell } = branchWorld({ yes: false, interactive: true });
    prompter.answer("publish");

    expect(await branchRelease(context, { onDefault: "release" })).toBe(true);
    expect(shell.calls).toHaveLength(1);
  });

  it("given the person picks switching to main, when shiplane goes on, then it switches, pulls and runs the real release from there", async () => {
    const { context, prompter, shell, source, output } = branchWorld({
      yes: false,
      interactive: true,
    });
    prompter.answer("switch");

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(source.received).toEqual([{ type: "switch", branch: "main" }, { type: "pull" }]);
    expect(output.text).toContain("Nothing to release");
  });

  it("given the pull fails after switching to main, when shiplane goes on, then the real release does not run", async () => {
    const { context, prompter, source, output } = branchWorld({ yes: false, interactive: true });
    source.failAt("pull", 1, new Error("diverged"));
    prompter.answer("switch");

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(false);
    expect(output.text).toContain("✗ pull main failed: diverged");
    expect(output.text).not.toContain("Nothing to release");
  });
});

describe("checking the npm sign-in before a test version publishes", () => {
  const NPM = {
    label: "npm",
    check: { command: "npm", args: ["whoami"] },
    fix: { command: "npm", args: ["login"] },
  };

  it("given npm is not signed in, when a test version starts, then it stops before writing any version and names npm login", async () => {
    const { context, shell, registry, files, output } = branchWorld();
    registry.fake.seed({ requirements: [NPM] });
    shell.seed("npm whoami", { status: 1 });

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(false);
    expect(files.changes).toEqual([]);
    expect(shell.calls.some(({ command }) => command === "echo")).toBe(false);
    expect(output.text).toContain("npm login");
  });

  it("given npm is not signed in and the person runs npm login when offered, when a test version starts, then it checks again and publishes", async () => {
    const { context, shell, registry, prompter } = branchWorld({ yes: false, interactive: true });
    registry.fake.seed({ requirements: [NPM] });
    shell.seedOnce("npm whoami", { status: 1 });
    prompter.answer("publish", true);

    const done = await branchRelease(context, { onDefault: "release" });

    expect(done).toBe(true);
    expect(prompter.asked).toContain("Run npm login now?");
    expect(shell.calls.filter(({ args }) => args[0] === "whoami")).toHaveLength(2);
    expect(shell.calls.some(({ command }) => command === "echo")).toBe(true);
  });
});
