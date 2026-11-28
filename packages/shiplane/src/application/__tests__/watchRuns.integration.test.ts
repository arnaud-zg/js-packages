import { describe, expect, it } from "vitest";

import { testContext, testUnit } from "../../testing/releaseContext";
import { watchRuns } from "../watchRuns";

// After a ship dispatches runs, the person is offered to follow them live, the right one first.

const SINCE = new Date("2026-10-12T09:00:00Z");
const ONE = "Watch Ship api to preview on Fake CI until it ends?";
const SEVERAL = "Watch a run on Fake CI until it ends?";

/** A release whose CI pipeline already started a run per unit named, to preview. */
const dispatched = (units: string[], options: Partial<Parameters<typeof testContext>[0]> = {}) => {
  const world = testContext({ units: [testUnit("api")], watch: "ask", ...options });
  units.forEach(
    (unit) =>
      void world.ci.dispatch("ship.yml", `${unit}@0.1.0`, { units: unit, environment: "preview" }),
  );
  const watch = () =>
    watchRuns(world.context, { workflow: "ship.yml", since: SINCE, count: units.length });
  return { ...world, watch };
};

describe("Feature: following the runs a ship started", () => {
  it("given one run started, when the person accepts, then that run is followed and its success said", async () => {
    // given
    const { watch, prompter, ci, output } = dispatched(["api"]);
    prompter.answer(true);

    // when
    const ok = await watch();

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toEqual([ONE]);
    expect(prompter.initials[ONE]).toBe(true);
    expect(ci.watched).toEqual(["run-1"]);
    expect(output.lines).toContain("✓ Ship api to preview succeeded.");
  });

  it("given one run started, when the person declines, then nothing is followed and the command to follow it is shown", async () => {
    // given
    const { watch, prompter, ci, output } = dispatched(["api"]);
    prompter.answer(false);

    // when
    const ok = await watch();

    // then
    expect(ok).toBe(true);
    expect(ci.watched).toEqual([]);
    expect(output.lines).toContain("    fake-ci watch run-1");
  });

  it("given two runs started, when asked, then the first is preselected and, once followed, the other is offered next", async () => {
    // given
    const { watch, prompter, ci, output } = dispatched(["api", "web"]);
    prompter.answer("run-1", false);

    // when
    await watch();

    // then
    expect(prompter.asked).toEqual([
      SEVERAL,
      "Watch Ship web to preview on Fake CI until it ends?",
    ]);
    expect(prompter.choices[SEVERAL]?.map(({ value }) => value)).toEqual(["run-1", "run-2", ""]);
    expect(prompter.initials[SEVERAL]).toBe("run-1");
    expect(ci.watched).toEqual(["run-1"]);
    expect(output.lines).toContain("    fake-ci watch run-2");
  });

  it("given a run that fails, when followed, then the ship fails and its page is shown", async () => {
    // given
    const { watch, prompter, ci, output } = dispatched(["api"]);
    ci.seed({ outcomes: { "run-1": false } });
    prompter.answer(true);

    // when
    const ok = await watch();

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain(
      "✗ Ship api to preview did not succeed: https://ci.example/runs/1",
    );
  });

  it("given --yes, when two runs started, then the question counts as accepted and both are followed in order", async () => {
    // given
    const { watch, prompter, ci } = dispatched(["api", "web"], { yes: true });

    // when
    await watch();

    // then
    expect(prompter.asked).toEqual([]);
    expect(ci.watched).toEqual(["run-1", "run-2"]);
  });

  it("given the config says watch: true, when a run started, then it is followed without asking", async () => {
    // given
    const { watch, prompter, ci, context } = dispatched(["api"]);
    context.release.watch = true;

    // when
    await watch();

    // then
    expect(prompter.asked).toEqual([]);
    expect(ci.watched).toEqual(["run-1"]);
  });

  it("given the config says watch: false, when a run started with --yes, then nothing is followed and the command to follow it later is shown", async () => {
    // given
    const { watch, prompter, ci, output, context } = dispatched(["api"], { yes: true });
    context.release.watch = false;

    // when
    await watch();

    // then
    expect(prompter.asked).toEqual([]);
    expect(ci.watched).toEqual([]);
    expect(output.lines).toContain("    fake-ci runs");
  });

  it("given the config says watch: true, when --no-watch is passed, then the flag wins and nothing is followed", async () => {
    // given
    const { watch, ci, context } = dispatched(["api"], { watch: false });
    context.release.watch = true;

    // when
    await watch();

    // then
    expect(ci.watched).toEqual([]);
  });

  it("given --watch, when two runs started, then both are followed in order without asking", async () => {
    // given
    const { watch, prompter, ci } = dispatched(["api", "web"], { watch: true });

    // when
    await watch();

    // then
    expect(prompter.asked).toEqual([]);
    expect(ci.watched).toEqual(["run-1", "run-2"]);
  });

  it("given no terminal, when runs started, then nothing is asked or followed", async () => {
    // given
    const { watch, ci, output } = dispatched(["api"], { interactive: false });

    // when
    await watch();

    // then
    expect(ci.watched).toEqual([]);
    expect(output.lines).toContain("    fake-ci runs");
  });

  it("given the pipeline shows no run yet, when asked to follow, then it says so and shows the runs command", async () => {
    // given
    const { watch, prompter, ci, output } = dispatched(["api"]);
    ci.seed({ showsRuns: false });

    // when
    const ok = await watch();

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toEqual([]);
    expect(output.lines).toContain("  Fake CI shows no run yet: follow it later.");
    expect(output.lines).toContain("    fake-ci runs");
  });
});
