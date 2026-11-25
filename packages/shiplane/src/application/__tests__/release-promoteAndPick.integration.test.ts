import { describe, expect, it } from "vitest";

import type { ReleaseModule } from "../../modules/module";
import type { Health } from "../../ports/delivery.port";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { webApp } from "../../modules/web-app/web-app.module";
import { changesetText, testContext, testUnit } from "../../testing/releaseContext";
import { pickScope } from "../pickScope";
import { promote } from "../promote";
import { pullRequestFirst } from "../pullRequestFirst";

/** A web app whose host says how staging runs it. */
const withHealth = (health: () => Promise<Health | null>): ReleaseModule => ({
  ...webApp({ staticHosting: staticHostingFake() }),
  health: () => health(),
});

/** api and admin on staging, not yet on prod; each module reads health as given. */
const onPrevious = ({
  health,
  yes = false,
  interactive = true,
}: {
  health: () => Promise<Health | null>;
  yes?: boolean;
  interactive?: boolean;
}) => {
  const world = testContext({
    units: [
      testUnit("api", { version: "0.0.8", options: { site: "api-site" } }),
      testUnit("admin", { version: "0.1.3", options: { site: "admin-site" } }),
    ],
    modules: [withHealth(health)],
    yes,
    interactive,
  });
  world.source.seed({ tags: { "api@0.0.8": "a8", "admin@0.1.3": "d3" } });
  world.host.seed({
    deployments: ["api@0.0.8", "admin@0.1.3"].map((tag) => ({
      title: `Deploy ${tag} to staging`,
      state: "done" as const,
    })),
  });
  return world;
};

describe("promoting to prod what staging runs", () => {
  it("given staging says api runs unwell, when the person promotes api, then its health is shown and they must confirm, No by default, before it ships", async () => {
    const { context, output, prompter } = onPrevious({
      health: () =>
        Promise.resolve({ ok: false, summary: "12 errors in 5 min", why: "error rate 4%" }),
    });
    prompter.answer(["api"], false);

    const done = await promote(context, undefined);

    expect(done).toBe(true);
    const question = "Promote anyway? api@0.0.8: error rate 4%.";
    expect(prompter.asked).toEqual([prompter.asked[0], question]);
    expect(prompter.initials[question]).toBe(false);
    expect(output.lines).toEqual([
      "",
      "  ! api@0.0.8         12 errors in 5 min",
      "",
      "  Nothing promoted.",
    ]);
  });

  it("given unwell apps whose host gives no reason, when the person promotes them, then the question says each looks unwell", async () => {
    const { context, prompter } = onPrevious({
      health: () => Promise.resolve({ ok: false, summary: "down" }),
    });
    prompter.answer(["api", "admin"], false);

    await promote(context, undefined);

    expect(prompter.asked[1]).toBe(
      "Promote anyway? api@0.0.8: looks unwell; admin@0.1.3: looks unwell.",
    );
  });

  it("given staging says api runs well, when the person promotes api, then it shows healthy and goes on to ship to prod without asking", async () => {
    const { context, output, prompter, progress } = onPrevious({
      health: () => Promise.resolve({ ok: true, summary: "no errors" }),
    });
    prompter.answer(["api"], "not yet");

    await promote(context, "local");

    expect(prompter.asked.slice(1)).toEqual(['Type "prod" to start:']);
    expect(output.lines.slice(0, 3)).toEqual(["", "  ✓ api@0.0.8         no errors", ""]);
    expect(progress.events.filter(({ kind }) => kind === "stage").map(({ text }) => text)).toEqual([
      "What to promote",
      "Ship",
    ]);
  });

  it("given the host cannot read health, when the person promotes, then no health is shown and it goes on to ship", async () => {
    const { context, output, prompter, progress } = onPrevious({
      health: () => Promise.reject(new Error("timeout")),
    });
    prompter.answer(["api"], "not yet");

    await promote(context, "local");

    expect(prompter.asked.slice(1)).toEqual(['Type "prod" to start:']);
    expect(output.text).not.toMatch(/[✓!] api@0\.0\.8/);
    expect(progress.events.filter(({ kind }) => kind === "stage")).toHaveLength(2);
  });

  it("given the person picks nothing to promote, when promotion stops, then nothing ships", async () => {
    const { context, prompter, progress, shell } = onPrevious({
      health: () => Promise.resolve({ ok: true, summary: "fine" }),
    });
    prompter.answer(null);

    expect(await promote(context, "local")).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(progress.events.filter(({ kind }) => kind === "stage")).toEqual([
      { kind: "stage", text: "What to promote", step: { index: 0, total: 2 } },
    ]);
  });
});

describe("picking which apps to release", () => {
  it("given nothing new on any app, when the person releases to staging, then each app says why and they are told to queue a change first", async () => {
    const world = testContext({
      units: [testUnit("api", { version: "0.0.8" }), testUnit("admin", { version: "0.1.3" })],
    });
    world.source.seed({ tags: { "api@0.0.8": "a8", "admin@0.1.3": "d3" } });
    world.host.seed({
      deployments: ["api@0.0.8", "admin@0.1.3"].map((tag) => ({
        title: `Deploy ${tag} to staging`,
        state: "done" as const,
      })),
    });

    const picked = await pickScope(world.context, "staging");

    expect(picked).toBeNull();
    expect(world.output.lines).toEqual([
      "",
      "  api            0.0.8 is on staging, nothing new",
      "  admin          0.1.3 is on staging, nothing new",
      "",
      "Nothing to release to staging. Queue a change first:",
      "    pnpm changeset",
      "",
    ]);
    expect(world.progress.events).toEqual([
      {
        kind: "during",
        mood: "thinking",
        text: "Reading what changed: changesets, tags and deployments",
      },
      {
        kind: "say",
        mood: "resting",
        text: "Nothing to release to staging. Queue a change first:",
      },
    ]);
  });

  it("given nothing on staging to promote, when the person releases to prod, then they are told to release to staging first", async () => {
    const world = testContext({ units: [testUnit("api", { version: "0.0.8" })] });

    await pickScope(world.context, "prod");

    expect(world.output.lines.slice(-3)).toEqual([
      "Nothing to release to prod. Release to staging first:",
      "    shiplane",
      "",
    ]);
  });

  it("given changes pending, when the person releases with --yes, then every app with changes is picked without asking", async () => {
    const world = testContext({
      units: [testUnit("api", { version: "0.0.8" }), testUnit("admin", { version: "0.1.3" })],
      yes: true,
    });
    world.versioning.seed({
      pending: [{ id: "a", text: changesetText({ "@acme/api": "patch" }, "api answers faster.") }],
    });
    world.source.seed({ tags: { "admin@0.1.3": "d3" } });
    world.host.seed({
      deployments: [{ title: "Deploy admin@0.1.3 to staging", state: "done" }],
    });

    const picked = await pickScope(world.context, "staging");

    expect(picked && [...picked.scope]).toEqual(["api"]);
    expect(world.prompter.asked).toEqual([]);
  });

  it("given changes pending, when the person is asked what to release, then only the apps with changes are ticked", async () => {
    const world = testContext({
      units: [testUnit("api", { version: "0.0.8" }), testUnit("admin", { version: "0.1.3" })],
    });
    world.versioning.seed({
      pending: [{ id: "a", text: changesetText({ "@acme/api": "patch" }, "api answers faster.") }],
    });
    world.source.seed({ tags: { "admin@0.1.3": "d3" } });
    world.host.seed({
      deployments: [{ title: "Deploy admin@0.1.3 to staging", state: "done" }],
    });
    world.prompter.answer(["api"]);

    await pickScope(world.context, "staging");

    const [question = ""] = world.prompter.asked;
    expect(world.prompter.initials[question]).toEqual(["api"]);
  });
});

describe("merging a required pull request before shipping", () => {
  const REQUEST = {
    action: "pull-request" as const,
    question: "Move prod to 1.2.0 first?",
    branch: "shiplane/move-prod",
    title: "chore(api): move prod to 1.2.0",
    body: "Prod moves before it ships.",
    changesets: [],
    write: () => Promise.resolve([]),
  };

  it("given the person says not now, when asked to open the pull request, then nothing is branched and the ship does not go on", async () => {
    const world = testContext({ units: [testUnit("api", { version: "1.1.0" })] });
    world.prompter.answer(false);

    const outcome = await pullRequestFirst(world.context, REQUEST);

    expect(outcome).toBe("declined");
    expect(world.source.received).toEqual([]);
    expect(world.output.lines).toEqual(["  Not now."]);
  });

  it("given the person agrees and the PR merges, when the pull request flow runs, then it branches from the default branch, opens the PR there and leaves them back on it, pulled", async () => {
    const world = testContext({
      units: [testUnit("api", { version: "1.1.0" })],
      yes: true,
    });
    world.source.seed({ defaultBranch: "trunk", changed: ["apps/api/app.json"] });
    world.host.seed({ prStates: { 1800: ["MERGED"] } });

    const outcome = await pullRequestFirst(world.context, REQUEST);

    expect(outcome).toBe("merged");
    expect(world.source.received).toEqual([
      { type: "branch", name: REQUEST.branch },
      { type: "commit", files: ["apps/api/app.json"], title: REQUEST.title, body: undefined },
      { type: "push", branch: REQUEST.branch },
      { type: "switch", branch: "trunk" },
      { type: "pull" },
    ]);
    expect(world.host.received).toEqual([
      expect.objectContaining({
        type: "pr",
        base: "trunk",
        head: REQUEST.branch,
        title: REQUEST.title,
        body: REQUEST.body,
        label: "type: chore",
      }),
    ]);
    expect(
      world.progress.events.filter(({ kind }) => kind === "during").map(({ text }) => text),
    ).toEqual(
      expect.arrayContaining([
        `branch ${REQUEST.branch} from trunk`,
        `commit "${REQUEST.title}"`,
        "open the pull request",
        "back to trunk",
        "pull trunk",
      ]),
    );
  });

  it("given the PR cannot be opened, when the pull request flow runs, then it fails without waiting for a merge", async () => {
    const world = testContext({ units: [testUnit("api", { version: "1.1.0" })], yes: true });
    world.host.failCreate(new Error("forbidden"));

    expect(await pullRequestFirst(world.context, REQUEST)).toBe("failed");
    expect(world.host.polled).toEqual([]);
  });

  it("given the pull after the merge fails, when the pull request flow runs, then the ship does not go on", async () => {
    const world = testContext({ units: [testUnit("api", { version: "1.1.0" })], yes: true });
    world.host.seed({ prStates: { 1800: ["MERGED"] } });
    world.source.failAt("pull", 1, new Error("diverged"));

    expect(await pullRequestFirst(world.context, REQUEST)).toBe("failed");
  });

  it("given the PR is closed without a merge, when the pull request flow runs, then nothing ships and the person is told to run shiplane again", async () => {
    const world = testContext({ units: [testUnit("api", { version: "1.1.0" })], yes: true });
    world.host.seed({ prStates: { 1800: ["CLOSED"] } });

    await pullRequestFirst(world.context, REQUEST);

    expect(world.output.lines.slice(-2)).toEqual([
      "✗ #1800 was closed without a merge: nothing shipped.",
      "    shiplane",
    ]);
  });
});
