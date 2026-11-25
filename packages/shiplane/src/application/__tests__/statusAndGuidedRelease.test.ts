import { describe, expect, it } from "vitest";

import type { PlannedChangeset } from "../../domain/changes";
import { mobileDistributionFake } from "../../adapters/mobile-distribution/__fakes__/mobile-distribution.fake";
import { mobileApp } from "../../modules/mobile-app/mobile-app.module";
import { planFrom } from "../../testing/plans";
import { changesetText, testContext, testUnit } from "../../testing/releaseContext";
import { readStatus } from "../readStatus";
import { releaseToEntry } from "../releaseToEntry";
import { shipTo } from "../ship";
import { waitForMerge } from "../waitForMerge";

const PLANT: PlannedChangeset = {
  id: "plant-not-in-catalog",
  summary: "A plant not in the catalog yet never blocks its page.",
  releases: [{ name: "@acme/api", type: "patch" }],
};

const MERGE_1790 = "Merge #1790 into main?";

const setUp = () => {
  const world = testContext({
    units: [testUnit("api", { version: "0.0.1" }), testUnit("admin", { version: "0.1.1" })],
  });
  world.versioning.seed({
    pending: [{ id: PLANT.id, text: changesetText({ "@acme/api": "patch" }, PLANT.summary) }],
    plan: planFrom([PLANT], { "@acme/api": "0.0.1" }),
  });
  world.source.seed({ tags: { "admin@0.1.1": "t1", "api@0.0.1": "t0" } });
  world.host.seed({
    deployments: [{ title: "Deploy admin@0.1.1 to preview", state: "done" }],
    releasedTags: ["admin@0.1.1", "api@0.0.1"],
  });
  return world;
};

describe("the status of a release", () => {
  it("given a changeset naming api and admin 0.1.1 already on preview, when the status is read, then api has a change to release and admin has nothing new", async () => {
    const { context } = setUp();

    const status = await readStatus(context, "preview");

    expect(status.units).toEqual([
      expect.objectContaining({
        unit: "api",
        version: "0.0.1",
        pending: true,
        hint: "1 changeset",
      }),
      expect.objectContaining({
        unit: "admin",
        pending: false,
        hint: "0.1.1 is on preview, nothing new",
      }),
    ]);
    expect(status.next).toEqual({ step: "release-pr" });
  });

  it("given someone's own PR from chore/release-notes, when the status is read, then it is not taken for a release PR", async () => {
    const { context, host } = setUp();
    host.seed({ openPrs: [{ branch: "chore/release-notes", pr: { number: 1789, url: "u" } }] });

    const status = await readStatus(context, "preview");

    expect(status.releasePrs).toEqual([]);
    expect(status.next).toEqual({ step: "release-pr" });
  });

  it("given a release PR open, when the status is read, then the next step is its merge", async () => {
    const { context, host } = setUp();
    host.seed({
      openPrs: [{ branch: "shiplane/release-2026-10-12-0900", pr: { number: 1790, url: "u" } }],
    });

    const status = await readStatus(context, "preview");

    expect(status.next).toEqual({ step: "wait-merge", prs: [{ number: 1790, url: "u" }] });
  });
});

describe("waiting for the release pull request", () => {
  it("given the PR merges after two checks, when waiting, then the release carries on", async () => {
    const { context, host } = setUp();
    host.seed({ prStates: { 1790: ["OPEN", "OPEN", "MERGED"] } });

    expect(await waitForMerge(context, { number: 1790, url: "u" })).toBe("merged");
  });

  it("given the PR is closed without a merge, when waiting, then nothing ships", async () => {
    const { context, host } = setUp();
    host.seed({ prStates: { 1790: ["OPEN", "CLOSED"] } });

    expect(await waitForMerge(context, { number: 1790, url: "u" })).toBe("closed");
  });

  it("given the person presses m and keeps the method the PR page preselects, when waiting, then the PR is merged from the terminal with it", async () => {
    const { context, host, prompter } = setUp();
    host.seed({ merges: { allowed: ["--squash", "--rebase"], preselected: "--rebase" } });
    prompter.press("m").answer("--rebase");

    expect(await waitForMerge(context, { number: 1790, url: "u" })).toBe("merged");
    expect(prompter.initials[MERGE_1790]).toBe("--rebase");
    expect(prompter.choices[MERGE_1790]?.map(({ label }) => label)).toEqual([
      "Squash and merge",
      "Rebase and merge",
      "Not now",
    ]);
    expect(host.received).toEqual([
      { type: "merge", pr: { number: 1790, url: "u" }, method: "--rebase" },
    ]);
  });

  it("given the person presses m then picks Not now, when waiting, then nothing is merged", async () => {
    const { context, host, prompter } = setUp();
    host.seed({ prStates: { 1790: ["OPEN", "OPEN", "MERGED"] } });
    prompter.press("m").answer("no");

    await waitForMerge(context, { number: 1790, url: "u" });

    expect(host.received).toEqual([]);
  });
});

describe("a release to preview, from the top", () => {
  it("given a release PR already open, when release runs, then it waits for the merge, pulls main and tags what it versioned", async () => {
    const { context, source, host, prompter } = setUp();
    host.seed({
      openPrs: [{ branch: "shiplane/release-2026-10-12-0900", pr: { number: 1790, url: "u" } }],
      prStates: { 1790: ["OPEN", "MERGED"] },
    });
    source.seed({
      versionCommits: {
        "apps/api@0.0.1": { sha: "r2", subject: "chore(release): api 0.0.1" },
        "apps/admin@0.1.1": { sha: "t1", subject: "chore(release): admin 0.1.1" },
      },
      tags: { "admin@0.1.1": "t1" },
    });
    prompter.answer(["api"], true);

    await releaseToEntry(context);

    expect(source.received.map(({ type }) => type)).toEqual(["switch", "pull", "tag", "push-tags"]);
    expect(source.received[2]).toMatchObject({ name: "api@0.0.1", sha: "r2" });
  });

  it("given api's and admin's release PRs open, when release runs, then it waits for both merges before it tags", async () => {
    const { context, source, host, prompter } = setUp();
    host.seed({
      openPrs: [
        { branch: "shiplane/release-2026-10-12-0900-api", pr: { number: 1790, url: "u" } },
        { branch: "shiplane/release-2026-10-12-0900-admin", pr: { number: 1791, url: "v" } },
      ],
      prStates: { 1790: ["OPEN", "MERGED"], 1791: ["OPEN", "OPEN", "MERGED"] },
    });
    source.seed({
      versionCommits: { "apps/api@0.0.1": { sha: "r2", subject: "chore(api): release v0.0.1" } },
      tags: { "admin@0.1.1": "t1" },
    });
    prompter.answer(["api"], true);

    await releaseToEntry(context);

    expect(host.polled).toEqual([1790, 1790, 1791, 1791, 1791]);
    expect(source.received.map(({ type }) => type)).toEqual(["switch", "pull", "tag", "push-tags"]);
  });

  it("given api 0.0.2 versioned by a merged release PR but never tagged, when release runs again, then it tags api@0.0.2", async () => {
    const world = testContext({ units: [testUnit("api", { version: "0.0.2" })] });
    world.source.seed({
      tags: { "api@0.0.1": "t0" },
      versionCommits: {
        "apps/api@0.0.2": { sha: "r2", subject: "chore(release): api 0.0.2 (#1733)" },
      },
    });
    world.host.seed({ releasedTags: ["api@0.0.1"] });
    world.prompter.answer(["api"], true);

    await releaseToEntry(world.context);

    expect(world.source.received).toContainEqual(
      expect.objectContaining({ type: "tag", name: "api@0.0.2", sha: "r2" }),
    );
  });

  it("given api 0.0.1 tagged and a release PR moving it to 0.0.2, when the PR merges mid-run, then the run tags api@0.0.2", async () => {
    const { context, source, host, prompter } = setUp();
    host.seed({
      openPrs: [{ branch: "shiplane/release-2026-10-12-0900", pr: { number: 1790, url: "u" } }],
      prStates: { 1790: ["OPEN", "MERGED"] },
    });
    source.seed({
      versionCommits: {
        "apps/api@0.0.1": { sha: "r1", subject: "chore(release): api 0.0.1" },
        "apps/api@0.0.2": { sha: "r2", subject: "chore(release): api 0.0.2" },
      },
    });
    const merged = testUnit("api", { version: "0.0.2" });
    context.load = () =>
      Promise.resolve({
        ...context.release,
        units: context.release.units.map((unit) => (unit.name === "api" ? merged : unit)),
      });
    prompter.answer(["api"], true);

    await releaseToEntry(context);

    expect(source.received).toContainEqual(
      expect.objectContaining({ type: "tag", name: "api@0.0.2", sha: "r2" }),
    );
  });
});

describe("resuming a mobile release whose build never shipped", () => {
  const setUpExpo = (options: { yes?: boolean; interactive?: boolean } = {}) => {
    const mobile = mobileDistributionFake();
    const world = testContext({
      units: [
        testUnit("expo", { version: "0.6.0", module: "mobile-app", options: { app: "expo" } }),
      ],
      modules: [mobileApp({ mobileDistribution: mobile })],
      ...options,
    });
    world.source.seed({ tags: { "expo@0.5.0": "t0", "expo@0.6.0": "t1" } });
    world.host.seed({ releasedTags: ["expo@0.5.0", "expo@0.6.0"] });
    mobile.fake.seed({ live: { preview: "0.5.0" } });
    return world;
  };

  it("given expo@0.6.0 tagged with its notes out but preview still on 0.5.0, when release runs again, then expo is offered and preselected as a retry", async () => {
    const { context, prompter } = setUpExpo();
    prompter.answer(null);

    await releaseToEntry(context);

    const [question = ""] = prompter.asked;
    expect(prompter.choices[question]).toEqual([
      {
        value: "expo",
        label: "expo",
        hint: "0.6.0 tagged, never reached preview: retry",
        disabled: false,
      },
    ]);
    expect(prompter.initials[question]).toEqual(["expo"]);
  });

  it("given expo@0.6.0 tagged and its ship job fails, when shipped, then it says a rerun offers expo@0.6.0 again", async () => {
    const { context, shell, output } = setUpExpo({ yes: true, interactive: false });
    shell.seed("echo update", { status: 1 });

    expect(await shipTo(context, "preview", { via: "local" })).toBe(false);
    expect(output.text).toContain("Run shiplane again: it offers expo@0.6.0 again");
  });
});
