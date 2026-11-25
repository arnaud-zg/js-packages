import { describe, expect, it } from "vitest";

import type { PlannedChangeset, StatusPlan } from "../../domain/changes";
import type { ReleaseModule } from "../../modules/module";
import type { VersionContribution } from "../../ports/delivery.port";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { webApp } from "../../modules/web-app/web-app.module";
import { planFrom } from "../../testing/plans";
import { changesetText, testContext, testUnit } from "../../testing/releaseContext";
import { openReleasePr } from "../openReleasePr";
import { prepareRelease } from "../prepareRelease";

const PLANT: PlannedChangeset = {
  id: "plant-not-in-catalog",
  summary: "A plant not in the catalog yet never blocks its page.",
  releases: [{ name: "@acme/api", type: "patch" }],
};

const HISTORY: PlannedChangeset = {
  id: "admin-history",
  summary: "Admin shows every identification a user made.",
  releases: [{ name: "@acme/admin", type: "minor" }],
};

const pendingOf = (changesets: PlannedChangeset[]) =>
  changesets.map(({ id, summary, releases }) => ({
    id,
    text: changesetText(
      Object.fromEntries(releases.map(({ name, type }) => [name, type])),
      summary,
    ),
  }));

/** A web app module that adds `contribution` to the release PR. */
const contributing = (contribution: Partial<VersionContribution>): ReleaseModule => ({
  ...webApp({ name: "contributing-app", staticHosting: staticHostingFake() }),
  version: () =>
    Promise.resolve({ added: [], writes: [], summary: [], onMerge: "", ...contribution }),
});

/** api and admin, each a web app shipped by a fake host, each with a changeset of its own. */
const setUp = ({
  defaultBranch = "main",
  modules = [webApp({ staticHosting: staticHostingFake() })],
  adminModule = "web-app",
}: { defaultBranch?: string; modules?: ReleaseModule[]; adminModule?: string } = {}) => {
  const units = [
    testUnit("api", { version: "0.0.1", options: { site: "api-site" } }),
    testUnit("admin", { version: "0.1.0", module: adminModule, options: { site: "admin-site" } }),
  ];
  const world = testContext({ units, modules });
  world.versioning.seed({
    pending: pendingOf([PLANT, HISTORY]),
    plan: planFrom([PLANT, HISTORY], { "@acme/api": "0.0.1", "@acme/admin": "0.1.0" }),
  });
  world.source.seed({
    defaultBranch,
    position: { branch: defaultBranch, head: "h1", originMain: "h1" },
    changed: ["apps/api/package.json"],
  });
  return world;
};

describe("seeing what a release will do before anything is written", () => {
  it("given api picked and admin left out, when the person dry-runs the release, then api ships with its host and admin is held with its changesets pending", async () => {
    const { context, output, prompter } = setUp();
    prompter.answer(false);

    await openReleasePr(context, await prepareRelease(context, new Set(["api"])));

    expect(output.lines).toEqual([
      "",
      "  Release  ·  staging  ·  1 changeset  ·  admin held",
      "",
      "  Unit           Version             Ships to staging",
      "  api            0.0.1 → 0.0.2       ↑ ship  fake",
      "  admin          0.1.0               ⏸ held, its changesets stay pending",
      "",
      "  Steps",
      "  1. Open the release PR, then wait for you to squash merge it",
      "  2. Tag each version and publish its release notes",
      "",
      "Nothing ran.",
    ]);
  });

  it("given api and admin picked, when the person dry-runs the release, then the steps open one release PR per app, each named", async () => {
    const { context, output, prompter } = setUp();
    prompter.answer(false);

    await openReleasePr(context, await prepareRelease(context, new Set(["api", "admin"])));

    expect(output.lines).toEqual([
      "",
      "  Release  ·  staging  ·  2 changesets",
      "",
      "  Unit           Version             Ships to staging",
      "  api            0.0.1 → 0.0.2       ↑ ship  fake",
      "  admin          0.1.0 → 0.2.0       ↑ ship  fake",
      "",
      "  Steps",
      [
        "  1. Open 2 release PRs from main, one per app, then wait for you to squash merge each:",
        "       chore(api): release v0.0.2",
        "       chore(admin): release v0.2.0",
      ].join("\n"),
      "  2. Tag each version and publish its release notes",
      "",
      "Nothing ran.",
    ]);
  });

  it("given a plugin that adds lines and a step for admin, when the person dry-runs the release, then its lines stand under admin and its step is numbered", async () => {
    const { context, output, prompter } = setUp({
      adminModule: "contributing-app",
      modules: [
        webApp({ staticHosting: staticHostingFake() }),
        contributing({
          summary: ["build 12 for iOS", "update for 0.2.x"],
          step: "Build admin on the store",
          onMerge: "Build admin",
        }),
      ],
    });
    prompter.answer(false);

    await openReleasePr(context, await prepareRelease(context, new Set(["admin"])));

    expect(output.lines.slice(3, 6)).toEqual([
      "  Unit           Version             Ships to staging",
      "  api            0.0.1               ⏸ held, its changesets stay pending",
      `  admin          0.1.0 → 0.2.0       build 12 for iOS\n${" ".repeat(37)}update for 0.2.x`,
    ]);
    expect(output.lines).toContain("  3. Build admin on the store");
  });

  it("given an app with no change, when the person dry-runs the release, then it says nothing changed for it", async () => {
    const world = testContext({
      units: [testUnit("api", { version: "0.0.1" }), testUnit("landing", { version: "1.0.0" })],
    });
    world.versioning.seed({
      pending: pendingOf([PLANT]),
      plan: planFrom([PLANT], { "@acme/api": "0.0.1" }),
    });
    world.prompter.answer(false);

    await openReleasePr(world.context, await prepareRelease(world.context, new Set(["api"])));

    expect(world.output.lines.slice(4, 6)).toEqual([
      "  api            0.0.1 → 0.0.2       ↑ ship  ",
      "  landing        1.0.0               – nothing changed",
    ]);
  });
});

describe("seeing which apps a release takes along", () => {
  // expo's change moves @acme/assets, which api uses; api has a changeset of its own, held.
  const plan: StatusPlan = {
    changesets: [
      {
        id: "inbox-copy",
        summary: "the mascot's inbox says when a result is new.",
        releases: [
          { name: "@acme/expo", type: "patch" },
          { name: "@acme/assets", type: "patch" },
        ],
      },
      {
        id: "api-fix",
        summary: "api answers faster.",
        releases: [{ name: "@acme/api", type: "patch" }],
      },
    ],
    releases: [
      {
        name: "@acme/expo",
        type: "patch",
        oldVersion: "0.2.1",
        newVersion: "0.2.2",
        changesets: ["inbox-copy"],
      },
      {
        name: "@acme/assets",
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: ["inbox-copy"],
      },
      {
        name: "@acme/api",
        type: "patch",
        oldVersion: "0.0.7",
        newVersion: "0.0.8",
        changesets: [],
      },
    ],
  };

  const setUpAlong = () => {
    const world = testContext({
      units: [
        testUnit("expo", { version: "0.2.1", options: { site: "expo-site" } }),
        testUnit("api", { version: "0.0.7", options: { site: "api-site" } }),
      ],
      modules: [webApp({ staticHosting: staticHostingFake() })],
    });
    world.versioning.seed({
      pending: [
        {
          id: "inbox-copy",
          text: changesetText(
            { "@acme/expo": "patch", "@acme/assets": "patch" },
            "the mascot's inbox says when a result is new.",
          ),
        },
        { id: "api-fix", text: changesetText({ "@acme/api": "patch" }, "api answers faster.") },
      ],
      plan: () => plan,
      dependencies: { "@acme/expo": ["@acme/assets"], "@acme/api": ["@acme/assets"] },
    });
    return world;
  };

  it("given expo picked and api moved by a package it uses, when the person dry-runs the release, then api goes along, named with why and its own waiting changeset", async () => {
    const { context, output, prompter } = setUpAlong();
    prompter.answer(false);

    await openReleasePr(context, await prepareRelease(context, new Set(["expo"])));

    expect(output.lines.slice(0, 12)).toEqual([
      "",
      "  Release  ·  staging  ·  1 changeset",
      "",
      "  Unit           Version             Ships to staging",
      "  expo           0.2.1 → 0.2.2       ↑ ship  fake",
      "  api            0.0.7 → 0.0.8       ↑ ship  fake  not picked, goes along",
      "  packages       1 bumped            changelogs only, nothing published",
      "",
      "  ! api is not picked but ships too:",
      "      api        0.0.8               uses @acme/assets, which expo's changes move · picking it ships its 1 changeset too",
      "",
      "  Steps",
    ]);
  });

  it("given api goes along, when the release PR opens, then its row says it was not picked and why", async () => {
    const { context, host, prompter } = setUpAlong();
    prompter.answer(true);

    await openReleasePr(context, await prepareRelease(context, new Set(["expo"])));

    const [pr] = host.received;
    const body = pr?.type === "pr" ? pr.body : "";
    expect(body).toContain(
      "Ship to staging with fake (not picked: uses @acme/assets, which expo's changes move)",
    );
  });
});

describe("opening a release PR only from an up-to-date default branch", () => {
  it("given a branch other than the default one, when the person releases, then it is refused with the commands to get back", async () => {
    const { context, source, output, prompter } = setUp({ defaultBranch: "trunk" });
    source.seed({ position: { branch: "feature", head: "h1", originMain: "h1" } });

    const prs = await openReleasePr(context, await prepareRelease(context, new Set(["api"])));

    expect(prs).toBeNull();
    expect(prompter.asked).toEqual([]);
    expect(output.lines.slice(-4)).toEqual([
      "✗ Not from trunk: a release versions what is merged.",
      "    git switch trunk",
      "    git pull",
      "    shiplane",
    ]);
  });

  it("given the default branch behind origin, when the person releases, then it is refused until they pull", async () => {
    const { context, source, output } = setUp({ defaultBranch: "trunk" });
    source.seed({ position: { branch: "trunk", head: "h1", originMain: "h2" } });

    const prs = await openReleasePr(context, await prepareRelease(context, new Set(["api"])));

    expect(prs).toBeNull();
    expect(output.lines.at(-4)).toBe(
      "✗ trunk is behind origin: a release versions what is merged.",
    );
  });

  it("given a default branch not named main, when the release PR opens, then it targets that branch and the person is left back on it", async () => {
    const { context, source, host, prompter } = setUp({ defaultBranch: "trunk" });
    prompter.answer("patch");

    await openReleasePr(context, await prepareRelease(context, new Set(["api"])));

    expect(host.received).toEqual([expect.objectContaining({ type: "pr", base: "trunk" })]);
    expect(source.received.at(-1)).toEqual({ type: "switch", branch: "trunk" });
  });

  it("given uncommitted changes, when the person releases, then it is refused before any question", async () => {
    const { context, source, output, prompter } = setUp();
    source.seed({ clean: false });

    expect(
      await openReleasePr(context, await prepareRelease(context, new Set(["api"]))),
    ).toBeNull();
    expect(prompter.asked).toEqual([]);
    expect(output.lines.at(-1)).toBe(
      "✗ Uncommitted changes: commit or stash them first, the release PR commits every change.",
    );
  });
});

describe("opening a release PR", () => {
  it("given a single app, when its release PR opens, then the person sees each step in order and the commit carries its release notes", async () => {
    const { context, source, progress, prompter } = setUp();
    prompter.answer("patch");

    await openReleasePr(context, await prepareRelease(context, new Set(["api"])));

    expect(progress.events.filter(({ kind }) => kind === "during").map(({ text }) => text)).toEqual(
      [
        "branch shiplane/release-2026-10-12-1100 from main",
        "versions and changelogs",
        'commit "chore(api): release v0.0.2"',
        "push shiplane/release-2026-10-12-1100",
        "open the release pull request",
        "back to main",
      ],
    );
    expect(source.received).toContainEqual({
      type: "commit",
      files: ["apps/api/package.json"],
      title: "chore(api): release v0.0.2",
      body: "api 0.0.2\n- A plant not in the catalog yet never blocks its page.",
    });
  });

  it("given release PRs main moved past, when a new one opens, then its description first names the ones it replaces", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer("patch");

    await openReleasePr(context, await prepareRelease(context, new Set(["api"])), [
      { number: 7, url: "https://host.test/acme/repo/pull/7" },
      { number: 9, url: "https://host.test/acme/repo/pull/9" },
    ]);

    const [pr] = host.received;
    expect(pr?.type === "pr" && pr.body).toMatch(
      /^Replaces #7 and #9, which went out of date when main moved\.\n\n## 🎯 What & why\n/,
    );
  });

  it("given no PR it replaces, when the release PR opens, then its description starts with what and why", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer("patch");

    await openReleasePr(context, await prepareRelease(context, new Set(["api"])));

    const [pr] = host.received;
    expect(pr?.type === "pr" && pr.body.startsWith("## 🎯 What & why")).toBe(true);
  });

  it("given two release PRs and the second cannot be pushed, when the release stops, then the person is told the first stays open", async () => {
    const { context, source, output, prompter } = setUp();
    source.failAt("push", 2, new Error("rejected"));
    prompter.answer(true);

    const prs = await openReleasePr(
      context,
      await prepareRelease(context, new Set(["api", "admin"])),
    );

    expect(prs).toBeNull();
    expect(output.lines.at(-1)).toBe(
      "  #1800 stay open: merge them, then run shiplane for the rest.",
    );
  });

  it("given a single release PR that cannot be pushed, when the release stops, then no PR is said to stay open", async () => {
    const { context, source, output, prompter } = setUp();
    source.failAt("push", 1, new Error("rejected"));
    prompter.answer("patch");

    expect(
      await openReleasePr(context, await prepareRelease(context, new Set(["api"]))),
    ).toBeNull();
    expect(output.text).not.toContain("stay open");
  });
});
