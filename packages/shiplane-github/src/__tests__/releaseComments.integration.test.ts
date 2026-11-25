import type { HostEvent } from "shiplane/testing";
import { backendService, tagName } from "shiplane/plugin";
import { planShips, serverHostingFake, shipTo, testContext, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { releaseComments } from "../release-comments.feature";

const REPO = "acme/app";

const EXPO = testUnit("expo", {
  version: "0.4.2",
  module: "backend-service",
  options: { service: "expo" },
});

const API = testUnit("api", {
  version: "0.0.11",
  module: "backend-service",
  options: { service: "api" },
});

const ticket = (text: string) => `<!-- Ticket: ${text} -->\n\n## What & why\n\nSomething.`;

const setUp = ({
  tagFormat,
  units = [EXPO],
  ...options
}: { apps?: string[]; tagFormat?: string; units?: ReturnType<typeof testUnit>[] } = {}) => {
  const tag = (unit: string, version: string) => tagName(unit, version, tagFormat);
  const world = testContext({
    units,
    tagFormat,
    modules: [backendService({ serverHosting: serverHostingFake() })],
    features: ({ codeHost, sourceControl }) => [
      releaseComments({ codeHost, sourceControl, ...options }),
    ],
  });
  world.source.seed({
    tags: {
      [tag("expo", "0.4.0")]: "t40",
      [tag("expo", "0.4.1")]: "t41",
      [tag("expo", "0.4.2")]: "t42",
      [tag("api", "0.0.10")]: "a10",
      [tag("api", "0.0.11")]: "a11",
    },
    commits: {
      [`${tag("expo", "0.4.1")}..${tag("expo", "0.4.2")}`]: [
        {
          subject: "chore(expo): release v0.4.2 (#1920)",
          files: ["apps/expo/package.json", "apps/expo/CHANGELOG.md"],
        },
        { subject: "feat(api): plants load faster (#1914)", files: ["apps/api/src/plants.ts"] },
        { subject: "docs(app): a written rule (#1905)", files: ["docs/live-reads.md"] },
        {
          subject: "fix(release): mobile deploy runs name the version they ship (#1913)",
          files: ["apps/expo/eas.json"],
        },
        {
          subject: "fix(build): iOS staging builds bundle without running out of memory (#1912)",
          files: ["packages/app/src/index.ts"],
        },
        { subject: "fix(app): a typo in the yard (#1915)", files: ["packages/app/src/yard.ts"] },
      ],
      [`${tag("api", "0.0.10")}..${tag("api", "0.0.11")}`]: [
        { subject: "feat(api): plants load faster (#1914)", files: ["apps/api/src/plants.ts"] },
        {
          subject: "fix(build): iOS staging builds bundle without running out of memory (#1912)",
          files: ["packages/app/src/index.ts"],
        },
      ],
    },
  });
  world.versioning.seed({
    dependencies: { "@acme/expo": ["@acme/app"], "@acme/api": ["@acme/app"] },
    folders: { "@acme/expo": "apps/expo", "@acme/app": "packages/app", "@acme/api": "apps/api" },
  });
  world.host.seed({
    pullRequests: {
      1912: {
        repository: REPO,
        number: 1912,
        body: ticket(`${REPO}#1549 (reference only, no "Closes #").`),
        closes: [],
      },
      1913: {
        repository: REPO,
        number: 1913,
        body: ticket("none (reference only). Stacked on #1912."),
        closes: [
          { repository: REPO, number: 1549 },
          { repository: REPO, number: 1550 },
        ],
      },
      1914: { repository: REPO, number: 1914, body: ticket("#1600"), closes: [] },
      1915: { repository: REPO, number: 1915, body: ticket("none"), closes: [] },
      1905: { repository: REPO, number: 1905, body: ticket("#1601"), closes: [] },
    },
  });
  return world;
};

const posted = (events: readonly HostEvent[]) =>
  events.flatMap((event) => (event.type === "comment" ? [event] : []));

const PRS = new Set([`${REPO}#1912`, `${REPO}#1913`, `${REPO}#1915`]);
const onIssues = (events: readonly HostEvent[]) =>
  posted(events).filter(({ issue }) => !PRS.has(issue));
const onPrs = (events: readonly HostEvent[]) =>
  posted(events).filter(({ issue }) => PRS.has(issue));

describe("telling PRs and issues a release shipped them", () => {
  it("given a version's merged PRs, when it ships to staging, then each PR gets one comment naming the environment, the version and its issues", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer(true);

    await shipTo(context, "staging", {});

    expect(onPrs(host.received)).toEqual([
      {
        type: "comment",
        issue: `${REPO}#1912`,
        body: "🚀 Released to **staging** in version **0.4.2** (expo, issue #1549).\n\n<!-- shiplane-release: expo@0.4.2 staging -->",
      },
      {
        type: "comment",
        issue: `${REPO}#1913`,
        body: "🚀 Released to **staging** in version **0.4.2** (expo, issues #1549, #1550).\n\n<!-- shiplane-release: expo@0.4.2 staging -->",
      },
      {
        type: "comment",
        issue: `${REPO}#1915`,
        body: "🚀 Released to **staging** in version **0.4.2** (expo).\n\n<!-- shiplane-release: expo@0.4.2 staging -->",
      },
    ]);
  });

  it("given a version whose merged PRs relate to issues, when it ships to staging, then each issue gets one comment naming the environment, the version and its PRs", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer(true);

    expect(await shipTo(context, "staging", {})).toBe(true);

    expect(onIssues(host.received)).toEqual([
      {
        type: "comment",
        issue: `${REPO}#1549`,
        body: "🚀 Released to **staging** in version **0.4.2** (expo, PR #1912, #1913).\n\n<!-- shiplane-release: expo@0.4.2 staging -->",
      },
      {
        type: "comment",
        issue: `${REPO}#1550`,
        body: "🚀 Released to **staging** in version **0.4.2** (expo, PR #1913).\n\n<!-- shiplane-release: expo@0.4.2 staging -->",
      },
    ]);
  });

  it("given PRs that reach another app, only touch docs, or are the release PR itself, when the version ships, then their issues are left alone", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer(true);

    await shipTo(context, "staging", {});

    const issues = posted(host.received).map(({ issue }) => issue);
    expect(issues).not.toContain(`${REPO}#1600`);
    expect(issues).not.toContain(`${REPO}#1601`);
  });

  it("given a version with many merged PRs and issues, when it ships, then GitHub is read twice, whatever their number", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer(true);

    await shipTo(context, "staging", {});

    expect(host.reads).toEqual(["pull-requests", "comments"]);
  });

  it("given the same ship run twice, when it ships again with its deploy record gone, then no PR or issue is commented twice", async () => {
    const { context, host, prompter } = setUp();
    prompter.answer(true, true);

    await shipTo(context, "staging", {});
    host.seed({ deployments: [] });
    await shipTo(context, "staging", {});

    expect(posted(host.received)).toHaveLength(5);
  });

  it("given a custom tag format, when the same ship runs again with its deploy record gone, then no PR or issue is commented twice", async () => {
    const { context, host, prompter } = setUp({ tagFormat: "{name}--v{version}" });
    prompter.answer(true, true);

    await shipTo(context, "staging", {});
    host.seed({ deployments: [] });
    await shipTo(context, "staging", {});

    expect(posted(host.received)).toHaveLength(5);
  });

  it("given issues already told about staging, when the version is promoted to prod, then they hear about prod", async () => {
    const { context, host, prompter } = setUp();
    host.seed({
      deployments: [{ title: "Deploy expo@0.4.2 to staging", state: "done" }],
      comments: {
        [`${REPO}#1912`]: ["<!-- shiplane-release: expo@0.4.2 staging -->"],
        [`${REPO}#1549`]: ["<!-- shiplane-release: expo@0.4.2 staging -->"],
        [`${REPO}#1550`]: ["<!-- shiplane-release: expo@0.4.2 staging -->"],
      },
    });
    prompter.answer("prod", true);

    await shipTo(context, "prod", {});

    expect(posted(host.received).map(({ body }) => body.split("\n")[0])).toEqual([
      "🚀 Released to **prod** in version **0.4.2** (expo, issue #1549).",
      "🚀 Released to **prod** in version **0.4.2** (expo, issues #1549, #1550).",
      "🚀 Released to **prod** in version **0.4.2** (expo).",
      "🚀 Released to **prod** in version **0.4.2** (expo, PR #1912, #1913).",
      "🚀 Released to **prod** in version **0.4.2** (expo, PR #1913).",
    ]);
  });

  it("given GitHub refuses the comment, when the version ships, then the release still succeeds and says which comment failed", async () => {
    const { context, host, prompter, output } = setUp();
    host.failComment(new Error("gh issue comment exited with 1: HTTP 403"));
    prompter.answer(true);

    expect(await shipTo(context, "staging", {})).toBe(true);

    expect(output.text).toContain(`comment on ${REPO}#1549: expo@0.4.2 on staging`);
    expect(output.text).toContain("HTTP 403");
  });

  it("given a PR GitHub cannot read, when the version ships, then the release still succeeds and says the hook could not read", async () => {
    const { context, host, prompter, output } = setUp();
    host.seed({ pullRequests: {} });
    prompter.answer(true);

    expect(await shipTo(context, "staging", {})).toBe(true);

    expect(posted(host.received)).toEqual([]);
    expect(output.text).toContain("release-comments  could not read: no pull request #1912");
  });

  it("given a unit left out of the plugin's units, when it ships, then its issues hear nothing", async () => {
    const { context, host, prompter } = setUp({ apps: ["api"] });
    prompter.answer(true);

    await shipTo(context, "staging", {});

    expect(posted(host.received)).toEqual([]);
  });

  it("given a unit's first release, when it ships, then nothing is commented", async () => {
    const { context, host, source, prompter, output } = setUp();
    source.seed({ tags: { "expo@0.4.2": "t42" } });
    prompter.answer(true);

    await shipTo(context, "staging", {});

    expect(posted(host.received)).toEqual([]);
    expect(host.reads).toEqual([]);
    expect(output.text).not.toContain("could not read");
  });

  it("given a plan, when it runs, then it lists the comments a ship would post and posts none", async () => {
    const { context, host, output } = setUp();

    await planShips(context, "staging");

    expect(output.text).toContain(`comment on ${REPO}#1912: expo@0.4.2 on staging`);
    expect(output.text).toContain(`comment on ${REPO}#1549: expo@0.4.2 on staging`);
    expect(output.text).toContain(`comment on ${REPO}#1550: expo@0.4.2 on staging`);
    expect(host.received).toEqual([]);
  });
});

describe("one comment per PR or issue, whatever the units that ship it", () => {
  it("given two units shipping the same PR and issue, when they ship, then each gets one comment naming both versions and carrying both markers", async () => {
    const { context, host, prompter } = setUp({ units: [EXPO, API] });
    prompter.answer(true, true);

    await shipTo(context, "staging", {});

    const on = (issue: string) => posted(host.received).filter((event) => event.issue === issue);
    expect(on(`${REPO}#1912`)).toEqual([
      {
        type: "comment",
        issue: `${REPO}#1912`,
        body: "🚀 Released to **staging** in versions **0.4.2** (expo) and **0.0.11** (api), issue #1549.\n\n<!-- shiplane-release: expo@0.4.2 staging -->\n<!-- shiplane-release: api@0.0.11 staging -->",
      },
    ]);
    expect(on(`${REPO}#1549`)).toEqual([
      {
        type: "comment",
        issue: `${REPO}#1549`,
        body: "🚀 Released to **staging** in versions **0.4.2** (expo) and **0.0.11** (api), PR #1912, #1913.\n\n<!-- shiplane-release: expo@0.4.2 staging -->\n<!-- shiplane-release: api@0.0.11 staging -->",
      },
    ]);
    expect(host.reads).toEqual(["pull-requests", "comments"]);
  });

  it("given a PR already told about one unit, when both ship, then its comment names only the other", async () => {
    const { context, host, prompter } = setUp({ units: [EXPO, API] });
    host.seed({
      comments: { [`${REPO}#1912`]: ["<!-- shiplane-release: expo@0.4.2 staging -->"] },
    });
    prompter.answer(true, true);

    await shipTo(context, "staging", {});

    expect(posted(host.received).filter(({ issue }) => issue === `${REPO}#1912`)).toEqual([
      {
        type: "comment",
        issue: `${REPO}#1912`,
        body: "🚀 Released to **staging** in version **0.0.11** (api, issue #1549).\n\n<!-- shiplane-release: api@0.0.11 staging -->",
      },
    ]);
  });

  it("given two units already shipped and commented, when the ship runs again, then nothing is commented", async () => {
    const { context, host, prompter } = setUp({ units: [EXPO, API] });
    prompter.answer(true, true, true, true);

    await shipTo(context, "staging", {});
    const first = posted(host.received).length;
    host.seed({ deployments: [] });
    await shipTo(context, "staging", {});

    expect(posted(host.received)).toHaveLength(first);
  });

  it("given two units whose PRs interleave, when they ship, then the PRs are commented lowest number first, then their issues", async () => {
    const { context, host, prompter } = setUp({ units: [EXPO, API] });
    prompter.answer(true, true);

    await shipTo(context, "staging", {});

    expect(posted(host.received).map(({ issue }) => issue)).toEqual([
      `${REPO}#1912`,
      `${REPO}#1913`,
      `${REPO}#1914`,
      `${REPO}#1915`,
      `${REPO}#1549`,
      `${REPO}#1550`,
      `${REPO}#1600`,
    ]);
  });

  it("given two units shipping the same PR, when the plan runs, then its one comment lists both tags", async () => {
    const { context, output } = setUp({ units: [EXPO, API] });

    await planShips(context, "staging");

    expect(output.text).toContain(`comment on ${REPO}#1912: expo@0.4.2, api@0.0.11 on staging`);
  });
});

describe("doctor checking release comments can reach GitHub and git", () => {
  const GH = { label: "gh", check: { command: "gh", args: ["auth", "status"] } };
  const GIT = { label: "git", check: { command: "git", args: ["--version"] } };
  const adapter = (name: string, requirements?: () => (typeof GH)[]) => ({
    name,
    create: () => {
      throw new Error("not opened");
    },
    ...(requirements ? { requirements } : {}),
  });

  it("given GitHub and git each needing a tool, when doctor runs, then release comments ask for both", () => {
    const codeHost = adapter("github", () => [GH]);
    const sourceControl = adapter("git", () => [GIT]);

    const feature = releaseComments({ codeHost, sourceControl });

    expect(feature.name).toBe("release-comments");
    expect(feature.adapters).toEqual([codeHost, sourceControl]);
    expect(feature.requirements?.()).toEqual([GH, GIT]);
  });

  it("given a code host and source control that need nothing, when doctor runs, then release comments ask for nothing", () => {
    const feature = releaseComments({
      codeHost: adapter("github"),
      sourceControl: adapter("git"),
    });

    expect(feature.requirements?.()).toEqual([]);
  });
});
