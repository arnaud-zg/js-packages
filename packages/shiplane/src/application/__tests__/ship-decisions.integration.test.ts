import { describe, expect, it } from "vitest";

import type { Decision } from "../../ports/delivery.port";
import { shipTo } from "../ship";
import { decidingModule, jobOn, shipWorld } from "./shipWorld";

// What each unit needs before it ships: its deploy records, or its own platform's decision.

const rollout = (overrides: Partial<Extract<Decision, { action: "choose" }>> = {}): Decision => ({
  action: "choose",
  lines: ["a is at 10% of users", "no crash so far"],
  question: "How far does a@0.1.0 go?",
  suggested: "half",
  options: [
    {
      value: "half",
      label: "To 50%",
      hint: "about half",
      jobs: [jobOn("roll a to 50%", "a@0.1.0")],
      then: ["watch its crash rate"],
    },
    { value: "hold", label: "Hold", disabled: true, jobs: [] },
  ],
  held: "held at 10%",
  ...overrides,
});

describe("Feature: skipping apps the deploy records say need nothing", () => {
  it("given api's deploy done on staging, when shipping to staging, then api is already there and nothing ships", async () => {
    // given
    const { context, host, ci, output, progress } = shipWorld(["api"], { yes: true });
    host.seed({ deployments: [{ title: "Deploy api@0.1.0 to staging", state: "done" }] });

    // when
    const ok = await shipTo(context, "staging", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  · api@0.1.0  already there");
    expect(output.lines).toContain("Nothing to ship to staging.");
    expect(progress.events).toContainEqual({
      kind: "say",
      mood: "resting",
      text: "Nothing to ship to staging.",
    });
    expect(ci.received).toEqual([]);
  });

  it("given api's deploy running on staging, when shipping to staging, then api is shown deploying already", async () => {
    // given
    const { context, host, output } = shipWorld(["api"], { yes: true });
    host.seed({ deployments: [{ title: "Deploy api@0.1.0 to staging", state: "running" }] });

    // when
    await shipTo(context, "staging", { via: "ci" });

    // then
    expect(output.lines).toContain("  · api@0.1.0  deploying already");
  });

  it("given api never on staging, when shipping to prod, then it says to ship it to staging first and nothing ships", async () => {
    // given
    const { context, prompter, output } = shipWorld(["api"]);
    prompter.answer("prod");

    // when
    const ok = await shipTo(context, "prod", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  · api@0.1.0  not on staging yet: ship it there first");
    expect(output.lines).toContain("Nothing to ship to prod.");
  });

  it("given the deploy records cannot be read, when shipping to staging, then api ships as if never deployed", async () => {
    // given
    const { context, host, ci } = shipWorld(["api"], { yes: true });
    host.deployments = () => Promise.reject(new Error("offline"));

    // when
    const ok = await shipTo(context, "staging", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(ci.received).toHaveLength(1);
  });

  it("given web not tagged yet, when shipping api and web, then only api is checked", async () => {
    // given
    const { context, source, progress } = shipWorld(["api", "web"], { yes: true });
    source.seed({ tags: { "api@0.1.0": "c-api" } });

    // when
    await shipTo(context, "staging", { via: "ci" });

    // then
    expect(progress.events).toContainEqual({
      kind: "during",
      mood: "thinking",
      text: "Checking what api@0.1.0 needs on staging",
    });
  });

  it("given api and web, when shipping web alone, then only web ships and api is never mentioned", async () => {
    // given
    const { context, ci, output } = shipWorld(["api", "web"], { yes: true });

    // when
    await shipTo(context, "staging", { via: "ci", scope: new Set(["web"]) });

    // then
    expect(ci.received.map(({ inputs }) => inputs.units)).toEqual(["web"]);
    expect(output.text).not.toContain("api@0.1.0");
  });

  it("given nothing tagged, when shipping web alone, then there is nothing to ship to staging", async () => {
    // given
    const { context, source, output } = shipWorld(["api", "web"], { yes: true });
    source.seed({ tags: {} });

    // when
    const ok = await shipTo(context, "staging", { scope: new Set(["web"]) });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("Nothing to ship to staging.");
  });
});

describe("Feature: seeing what is checked while a ship decides", () => {
  it("given an app and a package, when shipping, then one progress line checks both together", async () => {
    // given
    const deciding = decidingModule(() => ({ action: "none", status: "on npm" }), {
      kind: "published-package",
    });
    const { context, progress } = shipWorld(["api"], { yes: true, deciding, decided: ["pkg"] });

    // when
    await shipTo(context, "staging", { via: "ci" });

    // then
    expect(progress.events).toContainEqual({
      kind: "during",
      mood: "thinking",
      text: "Checking what 2 units need",
      batch: 2,
    });
  });

  it("given a package alone, when shipping, then it is checked on its registry and nothing ships live", async () => {
    // given
    const deciding = decidingModule(() => ({ action: "none", status: "on npm" }), {
      kind: "published-package",
    });
    const { context, progress, output } = shipWorld([], { yes: true, deciding, decided: ["pkg"] });

    // when
    await shipTo(context, "staging", {});

    // then
    expect(progress.events.map(({ text }) => text)).toContain(
      "Checking what pkg@0.1.0 needs on store",
    );
    expect(output.lines).toContain("  · pkg@0.1.0  on npm");
    expect(output.lines).toContain("Nothing to ship live.");
  });

  it("given an app that is only released, never deployed, when shipping, then its check names no place", async () => {
    // given
    const deciding = decidingModule(() => ({ action: "none", status: "tagged" }), {
      releaseOnly: true,
    });
    const { context, progress } = shipWorld([], { yes: true, deciding, decided: ["tool"] });

    // when
    await shipTo(context, "staging", {});

    // then
    expect(progress.events.map(({ text }) => text)).toContain("Checking what tool@0.1.0 needs");
  });

  it("given a package to publish, when it ships, then it publishes and shiplane status is not suggested", async () => {
    // given
    const deciding = decidingModule(
      () => ({ action: "ship", kind: "publish", jobs: [jobOn("publish pkg")] }),
      { kind: "published-package" },
    );
    const { context, output, shell } = shipWorld([], { yes: true, deciding, decided: ["pkg"] });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(shell.calls.map(({ args }) => args)).toEqual([["publish pkg"]]);
    expect(output.lines).toContain("✓ Triggered. pkg@0.1.0, shipping live on their own.");
    expect(output.text).not.toContain("shiplane status");
  });
});

describe("Feature: choosing how far a rollout or build goes", () => {
  it("given a rollout to choose, when the person picks 50%, then its status and choices are shown and it ships through CI with no second question", async () => {
    // given
    const deciding = decidingModule(() => rollout({ confirmed: true, notLocal: "no key here" }));
    const { context, prompter, output, ci } = shipWorld([], { deciding, decided: ["a"] });
    prompter.answer("half");

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  a is at 10% of users");
    expect(output.lines).toContain("  no crash so far");
    expect(output.lines).toContain("  watch its crash rate");
    expect(prompter.initials["How far does a@0.1.0 go?"]).toBe("half");
    expect(prompter.choices["How far does a@0.1.0 go?"]).toEqual([
      { value: "half", label: "To 50%", hint: "about half", disabled: undefined },
      { value: "hold", label: "Hold", hint: undefined, disabled: true },
    ]);
    expect(output.lines).toContain("  · a@0.1.0  no key here: ships through Fake CI");
    expect(prompter.asked).toEqual(["How far does a@0.1.0 go?"]);
    expect(ci.received.map(({ ref }) => ref)).toEqual(["a@0.1.0"]);
  });

  it("given a rollout to choose, when the person holds, then it says held and nothing ships", async () => {
    // given
    const deciding = decidingModule(() => rollout());
    const { context, prompter, output, ci } = shipWorld([], { deciding, decided: ["a"] });
    prompter.answer("hold");

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  · a@0.1.0  held at 10%");
    expect(output.text).not.toContain("watch its crash rate");
    expect(ci.received).toEqual([]);
  });

  it("given a rollout the platform leaves unconfirmed, when the person picks 50%, then they are asked how it ships and to confirm it", async () => {
    // given
    const deciding = decidingModule(() => rollout());
    const { context, prompter } = shipWorld([], { deciding, decided: ["a"] });
    prompter.answer("half", "ci", true);

    // when
    await shipTo(context, "staging", {});

    // then
    expect(prompter.asked).toEqual([
      "How far does a@0.1.0 go?",
      "How should a@0.1.0 ship to staging?",
      "Ship a@0.1.0 to staging through Fake CI?",
    ]);
  });

  it("given a rollout that needs a person and no terminal, when shipping, then it fails with the command to run", async () => {
    // given
    const deciding = decidingModule(() =>
      rollout({
        unattended: {
          title: "Rollout needs a person",
          detail: "run it in a terminal.",
          commands: ["shiplane ship"],
        },
      }),
    );
    const { context, prompter, output } = shipWorld([], {
      interactive: false,
      deciding,
      decided: ["a"],
    });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("✗ Rollout needs a person: run it in a terminal.");
    expect(output.lines).toContain("    shiplane ship");
    expect(prompter.asked).toEqual([]);
  });

  it("given a rollout that needs a person, when shipping on a CI runner, then it fails without asking", async () => {
    // given
    const deciding = decidingModule(() =>
      rollout({
        unattended: { title: "Rollout needs a person", detail: "not on CI.", commands: [] },
      }),
    );
    const { context, prompter } = shipWorld([], { deciding, decided: ["a"] });
    context.options.ci = true;

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(false);
    expect(prompter.asked).toEqual([]);
  });

  it("given a rollout that may wait and no terminal, when shipping, then it is held without asking", async () => {
    // given
    const deciding = decidingModule(() => rollout());
    const { context, output } = shipWorld([], { interactive: false, deciding, decided: ["a"] });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  · a@0.1.0  held at 10%");
  });

  it("given a build its platform runs, when the person starts it, then no way is asked and the build runs", async () => {
    // given
    const deciding = decidingModule(() =>
      rollout({
        kind: "build",
        options: [{ value: "go", label: "Build", jobs: [jobOn("build a")] }],
      }),
    );
    const { context, prompter, shell } = shipWorld([], { deciding, decided: ["a"] });
    prompter.answer("go", true);

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toEqual(["How far does a@0.1.0 go?", "Ship a@0.1.0 to staging?"]);
    expect(shell.calls.map(({ args }) => args)).toEqual([["build a"]]);
  });
});

describe("Feature: shipping to prod only with a person's say-so", () => {
  it("given --yes, when shipping to prod, then it refuses and says to run it in a terminal", async () => {
    // given
    const { context, output, ci } = shipWorld(["api"], { yes: true });

    // when
    const ok = await shipTo(context, "prod", { via: "ci" });

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("✗ No --yes on prod: every prod step asks a person.");
    expect(output.lines).toContain("    shiplane ship --channel prod");
    expect(ci.received).toEqual([]);
  });

  it("given --yes on a CI runner, when shipping to prod, then it deploys without asking, the dispatch being the say-so", async () => {
    // given
    const { context, host, shell } = shipWorld(["api"], { yes: true });
    context.options.ci = true;
    host.seed({ deployments: [{ title: "Deploy api@0.1.0 to staging", state: "done" }] });

    // when
    const ok = await shipTo(context, "prod", {});

    // then
    expect(ok).toBe(true);
    expect(shell.calls).toHaveLength(1);
  });

  it("given the person types something other than prod, when shipping to prod, then nothing runs", async () => {
    // given
    const { context, prompter, output } = shipWorld(["api"]);
    prompter.answer("yes");

    // when
    const ok = await shipTo(context, "prod", { via: "ci" });

    // then
    expect(ok).toBe(false);
    expect(prompter.asked).toEqual(['Type "prod" to start:']);
    expect(output.lines).toContain("Nothing ran.");
  });

  it("given api on staging and prod typed, when shipping to prod, then the confirmation defaults to no and it ships", async () => {
    // given
    const { context, prompter, host, ci } = shipWorld(["api"]);
    host.seed({ deployments: [{ title: "Deploy api@0.1.0 to staging", state: "done" }] });
    prompter.answer("prod", true);
    const question = "Ship api@0.1.0 to prod through Fake CI?";

    // when
    const ok = await shipTo(context, "prod", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(prompter.initials[question]).toBe(false);
    expect(ci.received.map(({ inputs }) => inputs.environment)).toEqual(["prod"]);
  });
});

describe("Feature: declining a ship", () => {
  it("given the person declines staging, when they also decline prod, then nothing ships and the run ends fine", async () => {
    // given
    const { context, prompter, output, ci } = shipWorld(["api"]);
    prompter.answer(false, false);

    // when
    const ok = await shipTo(context, "staging", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toEqual([
      "Ship api@0.1.0 to staging through Fake CI?",
      "Ship to prod instead?",
    ]);
    expect(output.lines).toContain("Nothing shipped.");
    expect(ci.received).toEqual([]);
  });

  it("given the person declines staging, when they take prod instead, then prod asks for its name and ships there", async () => {
    // given
    const deciding = decidingModule((tag) => ({
      action: "ship",
      kind: "deploy",
      jobs: [jobOn(`deploy ${tag}`, tag)],
    }));
    const { context, prompter, ci } = shipWorld([], { deciding, decided: ["api"] });
    prompter.answer(false, true, "prod", true);

    // when
    const ok = await shipTo(context, "staging", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toEqual([
      "Ship api@0.1.0 to staging through Fake CI?",
      "Ship to prod instead?",
      'Type "prod" to start:',
      "Ship api@0.1.0 to prod through Fake CI?",
    ]);
    expect(ci.received.map(({ inputs }) => inputs.environment)).toEqual(["prod"]);
  });

  it("given the person declines prod, when shipping to prod, then staging is never offered instead", async () => {
    // given
    const { context, prompter, host } = shipWorld(["api"]);
    host.seed({ deployments: [{ title: "Deploy api@0.1.0 to staging", state: "done" }] });
    prompter.answer("prod", false);

    // when
    const ok = await shipTo(context, "prod", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toHaveLength(2);
  });

  it("given no terminal and no --yes, when shipping, then it says to pass --yes and nothing ships", async () => {
    // given
    const { context, output, ci } = shipWorld(["api"], { interactive: false });

    // when
    const ok = await shipTo(context, "staging", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("Not a terminal: pass --yes to run it.");
    expect(ci.received).toEqual([]);
  });
});

describe("Feature: running follow-ups once a ship is triggered", () => {
  it("given a feature that follows up, when api ships, then it is told what shipped where and its follow-up runs", async () => {
    // given
    const told: unknown[] = [];
    const { context, output } = shipWorld(["api"], { yes: true });
    context.release.features = [
      {
        type: "feature",
        name: "notes",
        adapters: [],
        afterShip: (_context, shipped) => {
          told.push(...shipped.map(({ unit, tag, environment }) => [unit.name, tag, environment]));
          return Promise.resolve([{ label: "comment on #12", run: () => Promise.resolve() }]);
        },
      },
    ];

    // when
    await shipTo(context, "staging", { via: "ci" });

    // then
    expect(told).toEqual([["api", "api@0.1.0", "staging"]]);
    expect(output.lines).toContain("  ✓ comment on #12");
  });
});
