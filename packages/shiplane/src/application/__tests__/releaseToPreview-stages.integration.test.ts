import { describe, expect, it } from "vitest";

import type { PlannedChangeset } from "../../domain/changes";
import type { Approval } from "../../domain/releasePr";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { planFrom } from "../../testing/plans";
import { changesetText, testContext, testUnit } from "../../testing/releaseContext";
import { releaseToEntry } from "../releaseToEntry";

// `release` on staging, stage by stage: what it says and runs from the pick to the ship.

const RATE_LIMIT: PlannedChangeset = {
  id: "rate-limit",
  summary: "Rate limit per key.",
  releases: [{ name: "@acme/api", type: "minor" }],
};

const PR_12 = { number: 12, url: "https://host.test/acme/repo/pull/12", head: "pr12" };
const OPEN_12 = { branch: "shiplane/release-2026-10-11-0900", pr: PR_12 };

const MOVED = {
  commits: { "pr12..head": [{ subject: "feat(api): rate limit per key (#41)", files: [] }] },
};

/** api 0.0.1 tagged, a backend service on a Fake host, with a changeset pending unless told not. */
const setUp = ({
  approval,
  interactive = true,
  yes = false,
  pending = true,
}: { approval?: Approval; interactive?: boolean; yes?: boolean; pending?: boolean } = {}) => {
  const hosting = serverHostingFake();
  const world = testContext({
    units: [
      testUnit("api", {
        version: "0.0.1",
        module: "backend-service",
        options: { service: "acme-api" },
      }),
    ],
    modules: [backendService({ serverHosting: hosting })],
    approval,
    interactive,
    yes,
  });
  world.versioning.seed(
    pending
      ? {
          pending: [
            {
              id: RATE_LIMIT.id,
              text: changesetText({ "@acme/api": "minor" }, RATE_LIMIT.summary),
            },
          ],
          plan: planFrom([RATE_LIMIT], { "@acme/api": "0.0.1" }),
        }
      : { pending: [], plan: planFrom([], {}) },
  );
  world.source.seed({ tags: { "api@0.0.1": "t0" } });
  world.host.seed({ releasedTags: ["api@0.0.1"] });
  return { ...world, hosting: hosting.fake };
};

/** The release as it loads once the PR merged and main was pulled: api moved to 0.1.0. */
const pulledTo010 = (world: ReturnType<typeof setUp>) => {
  world.source.seed({
    versionCommits: {
      "apps/api@0.1.0": { sha: "r2", subject: "chore(api): release v0.1.0 (#12)" },
    },
  });
  const merged = {
    ...world.context.release,
    units: world.context.release.units.map((unit) => ({ ...unit, version: "0.1.0" })),
  };
  world.context.load = () => Promise.resolve(merged);
};

const stages = (world: ReturnType<typeof setUp>) =>
  world.progress.events.filter(({ kind }) => kind === "stage").map(({ text }) => text);

const opened = (world: ReturnType<typeof setUp>) =>
  world.host.received.filter(({ type }) => type === "pr");

describe("Feature: releasing to staging, from picking the apps to shipping them", () => {
  it("given release PR #12 open and merged from the terminal, when releasing to staging, then main is pulled, api@0.1.0 is tagged and deployed", async () => {
    // given
    const world = setUp();
    world.host.seed({ openPrs: [OPEN_12], prStates: { 12: ["OPEN", "MERGED"] } });
    pulledTo010(world);
    world.prompter.answer(["api"], true, true);

    // when
    const ok = await releaseToEntry(world.context);

    // then
    expect(world.prompter.asked.slice(1)).toEqual([
      "Tag api@0.1.0 and publish their release notes?",
      "Ship api@0.1.0 to staging through this machine?",
    ]);
    expect(ok).toBe(true);
    expect(stages(world)).toEqual(["What to release", "Merge", "Tags", "Ship"]);
    expect(world.output.lines).toContain("↻ Picking up release #12: still waiting for a merge");
    expect(world.output.lines).toContain("✓ Release PR #12 merged");
    expect(world.progress.events.map(({ text }) => text)).toEqual(
      expect.arrayContaining(["switch to main", "pull main"]),
    );
    expect(world.source.received.map(({ type }) => type)).toEqual([
      "switch",
      "pull",
      "tag",
      "push-tags",
    ]);
    expect(world.shell.calls.map(({ args }) => args)).toEqual([
      ["deploy", "acme-api", "api@0.1.0"],
    ]);
  });

  it("given pulling main fails after the merge, when releasing to staging, then nothing is tagged and the release fails", async () => {
    // given
    const world = setUp();
    world.host.seed({ openPrs: [OPEN_12], prStates: { 12: ["MERGED"] } });
    world.source.failAt("pull", 1, new Error("diverged"));
    world.prompter.answer(["api"]);

    // when
    const ok = await releaseToEntry(world.context);

    // then
    expect(ok).toBe(false);
    expect(world.source.received.map(({ type }) => type)).toEqual(["switch", "pull"]);
  });

  it("given the person picks no app, when releasing to staging, then nothing runs, no PR opens and the release ends fine", async () => {
    // given
    const world = setUp();
    world.prompter.answer([]);

    // when
    const ok = await releaseToEntry(world.context);

    // then
    expect(ok).toBe(true);
    expect(world.output.lines).toContain("Nothing ran.");
    expect(stages(world)).toEqual(["What to release"]);
    expect(opened(world)).toEqual([]);
  });

  it("given no changeset pending and api tagged, when releasing to staging, then it goes straight to shipping", async () => {
    // given
    const world = setUp({ pending: false });
    world.prompter.answer(["api"], true);

    // when
    const ok = await releaseToEntry(world.context);

    // then
    expect(ok).toBe(true);
    expect(stages(world)).toEqual(["What to release", "Ship"]);
    expect(world.output.text).not.toContain("Picking up");
    expect(opened(world)).toEqual([]);
  });

  it("given a missing sign-in, when releasing to staging, then it stops before any PR opens", async () => {
    // given
    const world = setUp();
    world.hosting.seed({
      requirements: [
        {
          label: "host signed in",
          check: { command: "hostctl", args: ["auth", "whoami"] },
          fix: { command: "hostctl", args: ["auth", "login"] },
        },
      ],
    });
    world.shell.seed("hostctl auth whoami", { status: 1 });
    world.prompter.answer(["api"], false);

    // when
    const ok = await releaseToEntry(world.context);

    // then
    expect(ok).toBe(false);
    expect(opened(world)).toEqual([]);
  });
});

describe("Feature: replacing a release PR that main moved past", () => {
  it("given approval required and main moved past #12, when releasing, then #12 is replaced and the new PR needs approval again", async () => {
    // given
    const world = setUp({ approval: "required", interactive: false, yes: true });
    world.host.seed({ openPrs: [OPEN_12] });
    world.source.seed(MOVED);
    world.prompter.answer(["api"]);

    // when
    await releaseToEntry(world.context);

    // then
    expect(world.output.lines).toContain(
      "  ✓ Opened #1800 (needs approval again)  ✓ Closed #12, with a comment pointing to it",
    );
    expect(world.output.lines).toContain("    Replacing it so the changelog matches what ships.");
  });

  it("given a solo release and main moved past #12, when releasing, then #12 is replaced by a PR that asks for no approval", async () => {
    // given
    const world = setUp({ interactive: false, yes: true });
    world.host.seed({ openPrs: [OPEN_12], prStates: { 1800: ["MERGED"] } });
    world.source.seed(MOVED);
    world.prompter.answer(["api"]);

    // when
    await releaseToEntry(world.context);

    // then
    expect(world.output.lines).toContain(
      "  ✓ Opened #1800  ✓ Closed #12, with a comment pointing to it",
    );
  });

  it("given the commits since #12 cannot be read, when releasing, then #12 is picked up as it is", async () => {
    // given
    const world = setUp({ approval: "required", interactive: false, yes: true });
    world.host.seed({ openPrs: [OPEN_12] });
    world.source.commitsBetween = () => Promise.reject(new Error("unknown revision"));
    world.prompter.answer(["api"]);

    // when
    const ok = await releaseToEntry(world.context);

    // then
    expect(ok).toBe(true);
    expect(world.output.lines).toContain("↻ Picking up release #12: still waiting for approval");
    expect(opened(world)).toEqual([]);
  });

  it("given the code host does not say which commit #12 is on, when releasing, then #12 is picked up without checking whether main moved", async () => {
    // given
    const world = setUp({ approval: "required", interactive: false, yes: true });
    const noHead = { number: 12, url: PR_12.url };
    world.host.seed({ openPrs: [{ branch: OPEN_12.branch, pr: noHead }] });
    const asked: string[] = [];
    world.source.commitsBetween = (from: string, to: string) => {
      asked.push(`${from}..${to}`);
      return Promise.resolve([{ subject: "feat: x", files: [] }]);
    };
    world.prompter.answer(["api"]);

    // when
    await releaseToEntry(world.context);

    // then
    expect(asked).toEqual([]);
    expect(opened(world)).toEqual([]);
  });
});
