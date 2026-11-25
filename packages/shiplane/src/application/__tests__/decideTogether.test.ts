import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AppInput, ReleaseModule } from "../../modules/module";
import type { Decision } from "../../ports/delivery.port";
import { testContext, testUnit } from "../../testing/releaseContext";
import { shipTo } from "../ship";

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((done) => setImmediate(done));
};

interface Check {
  tag: string;
  answer: (decision: Decision) => void;
}

/** A platform whose every check waits until the test answers it. */
const waitingModule = (checks: Check[], running = { now: 0, peak: 0 }): ReleaseModule => ({
  type: "module",
  name: "waiting",
  kind: "waiting",
  provider: "waiting",
  settings: z.object({}),
  adapters: [],
  ship: () => ({ where: "nowhere", jobs: [] }),
  decide: (_context, input: AppInput) => {
    running.now += 1;
    running.peak = Math.max(running.peak, running.now);
    return new Promise<Decision>((resolve) =>
      checks.push({
        tag: input.tag,
        answer: (decision) => {
          running.now -= 1;
          resolve(decision);
        },
      }),
    );
  },
});

/** A platform that answers at once, from what `decide` returns per tag. */
const answeringModule = (decide: (tag: string) => Decision): ReleaseModule => ({
  type: "module",
  name: "waiting",
  kind: "waiting",
  provider: "waiting",
  settings: z.object({}),
  adapters: [],
  ship: () => ({ where: "nowhere", jobs: [] }),
  decide: (_context, { tag }) => Promise.resolve(decide(tag)),
});

const setUp = (names: string[], module: ReleaseModule, { yes = false } = {}) => {
  const world = testContext({
    units: names.map((name) => testUnit(name, { module: "waiting" })),
    modules: [module],
    yes,
  });
  world.source.seed({
    tags: Object.fromEntries(names.map((name) => [`${name}@0.1.0`, `t-${name}`])),
  });
  return world;
};

const NAMES = ["a", "b", "c", "d", "e", "f"];

const lineOf = (lines: readonly string[], tag: string) =>
  lines.findIndex((line) => line.includes(`${tag}  `));

describe("checking what every unit needs at once", () => {
  it("given six units, when shipping to staging, then four checks run together and never more", async () => {
    const checks: Check[] = [];
    const running = { now: 0, peak: 0 };
    const { context } = setUp(NAMES, waitingModule(checks, running));

    const shipped = shipTo(context, "staging", {});
    await settle();

    expect(checks.map(({ tag }) => tag)).toEqual(["a@0.1.0", "b@0.1.0", "c@0.1.0", "d@0.1.0"]);
    checks[1]?.answer({ action: "none", status: "already there" });
    await settle();
    expect(running.peak).toBe(4);
    expect(checks).toHaveLength(5);

    for (let round = 0; round < 3; round += 1) {
      checks.forEach((check) => check.answer({ action: "none", status: "already there" }));
      await settle();
    }

    expect(await shipped).toBe(true);
    expect(running.peak).toBe(4);
  });

  it("given checks that finish last unit first, when shipping, then each unit's result is said in unit order", async () => {
    const checks: Check[] = [];
    const { context, output } = setUp(NAMES, waitingModule(checks));

    const shipped = shipTo(context, "staging", {});
    for (let round = 0; round < 3; round += 1) {
      await settle();
      [...checks]
        .reverse()
        .forEach(({ tag, answer }) => answer({ action: "none", status: `${tag} checked` }));
    }

    expect(await shipped).toBe(true);
    const order = NAMES.map((name) => lineOf(output.lines, `${name}@0.1.0`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("given three units, when shipping to staging, then one line checks them all instead of one line each", async () => {
    const { context, progress } = setUp(
      ["a", "b", "c"],
      answeringModule(() => ({ action: "none", status: "already there" })),
    );

    await shipTo(context, "staging", {});

    const checking = progress.events.filter(({ text }) => text.startsWith("Checking what"));
    expect(checking.map(({ text }) => text)).toEqual(["Checking what 3 units need on staging"]);
  });

  it("given every unit asks the person a question, when checks finish in reverse, then the questions come in unit order", async () => {
    const checks: Check[] = [];
    const { context, prompter } = setUp(["a", "b", "c"], waitingModule(checks));
    prompter.answer(null, null, null);
    const choose = (tag: string): Decision => ({
      action: "choose",
      lines: [`${tag} is at 10%`],
      question: `How far does ${tag} go?`,
      suggested: "hold",
      options: [{ value: "hold", label: "Hold", jobs: [] }],
      held: "held",
    });

    const shipped = shipTo(context, "staging", {});
    await settle();
    [...checks].reverse().forEach(({ tag, answer }) => answer(choose(tag)));

    expect(await shipped).toBe(true);
    expect(prompter.asked).toEqual([
      "How far does a@0.1.0 go?",
      "How far does b@0.1.0 go?",
      "How far does c@0.1.0 go?",
    ]);
  });

  it("given the second of three units refuses, when shipping, then the first is said, the refusal stops the run and the third is never said", async () => {
    const { context, output } = setUp(
      ["a", "b", "c"],
      answeringModule((tag) =>
        tag === "b@0.1.0"
          ? {
              action: "fail",
              title: "b cannot ship",
              detail: "its build is missing.",
              commands: [],
            }
          : { action: "none", status: "already there" },
      ),
    );

    expect(await shipTo(context, "staging", {})).toBe(false);
    expect(output.text).toContain("a@0.1.0  already there");
    expect(output.text).toContain("b cannot ship");
    expect(output.text).not.toContain("c@0.1.0");
  });

  it("given the first unit needs a pull request merged, when it merges, then the next unit is checked again after the move", async () => {
    const moved = { done: false };
    const { context, host, output } = setUp(
      ["a", "b"],
      answeringModule((tag): Decision => {
        if (tag === "b@0.1.0") {
          return { action: "none", status: moved.done ? "after the move" : "before the move" };
        }
        return moved.done
          ? { action: "none", status: "moved" }
          : {
              action: "pull-request",
              question: "Move a first?",
              branch: "shiplane/move-a",
              title: "chore(a): move",
              body: "a moves first.",
              changesets: [],
              write: () => {
                moved.done = true;
                return Promise.resolve([]);
              },
            };
      }),
      { yes: true },
    );
    host.seed({ prStates: { 1800: ["MERGED"] } });

    expect(await shipTo(context, "staging", {})).toBe(true);
    expect(output.text).toContain("b@0.1.0  after the move");
  });
});
