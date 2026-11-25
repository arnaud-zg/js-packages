import { describe, expect, it } from "vitest";

import type { Step } from "../steps";
import { CommandFailed } from "../../ports/shell.port";
import { testContext } from "../../testing/releaseContext";
import { branchStep, openPrStep, pushStep, runSteps } from "../steps";

// Steps run against the flow's Fakes: no branch, push or pull request leaves this machine.

const world = () => testContext({ units: [] });

const step = (label: string, run: () => Promise<void> = () => Promise.resolve()): Step => ({
  label,
  run,
});

describe("Feature: a release runs its steps in order", () => {
  it("given three steps, when they all pass, then each is shown with its place and nothing is undone", async () => {
    const { context, progress } = world();

    expect(await runSteps(context, [step("one"), step("two"), step("three")])).toBe(true);

    expect(progress.events).toEqual([
      { kind: "during", mood: "working", text: "one", step: { index: 0, total: 3 } },
      { kind: "during", mood: "working", text: "two", step: { index: 1, total: 3 } },
      { kind: "during", mood: "working", text: "three", step: { index: 2, total: 3 } },
    ]);
  });

  it("given a step that fails with nothing to undo, when it runs, then it says why and the next one never runs", async () => {
    const { context, output } = world();
    const ran: string[] = [];

    const done = await runSteps(context, [
      step("tag", () => Promise.reject(new Error("tag exists"))),
      step("push", () => {
        ran.push("push");
        return Promise.resolve();
      }),
    ]);

    expect(done).toBe(false);
    expect(ran).toEqual([]);
    expect(output.lines).toEqual(["✗ tag failed: tag exists, the steps after it did not run."]);
  });

  it("given a failing command that printed a lot, when it fails, then only its last 40 lines are shown", async () => {
    const { context, output } = world();
    const printed = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join("\n");

    await runSteps(context, [
      step("build", () => Promise.reject(new CommandFailed("build exited with 1", printed))),
    ]);

    expect(output.lines[1]).toBe("    … 5 earlier lines");
    expect(output.lines[2]).toBe("    │ line 6");
    expect(output.lines.at(-1)).toBe("    │ line 45");
    expect(output.lines).toHaveLength(42);
  });

  it("given a failing command that printed a little, when it fails, then all of it is shown with no count", async () => {
    const { context, output } = world();

    await runSteps(context, [
      step("build", () => Promise.reject(new CommandFailed("exited with 2", "a\nb"))),
    ]);

    expect(output.lines.slice(1)).toEqual(["    │ a", "    │ b"]);
  });

  it("given a failing command that printed nothing, when it fails, then only the reason is shown", async () => {
    const { context, output } = world();

    await runSteps(context, [step("build", () => Promise.reject(new CommandFailed("exited", "")))]);

    expect(output.lines).toHaveLength(1);
  });
});

describe("Feature: a stopped release takes back what it did", () => {
  it("given a branch made and pushed, when the next step fails, then the push and the branch are undone newest first", async () => {
    const { context, source, progress, output } = world();
    source.seed({ changed: ["notes.md"] });
    const steps = [
      branchStep(context, { branch: "release", from: "main" }),
      pushStep(context, "release"),
      step("open", () => Promise.reject(new Error("offline"))),
    ];

    expect(await runSteps(context, steps)).toBe(false);

    expect(source.received).toEqual([
      { type: "branch", name: "release" },
      { type: "push", branch: "release" },
      { type: "delete-remote", branch: "release" },
      { type: "discard", files: [] },
      { type: "switch", branch: "main" },
      { type: "delete-branch", name: "release" },
    ]);
    expect(progress.events.map(({ text }) => text)).toContain("undo: delete release on origin");
    expect(progress.events.map(({ text }) => text)).toContain("undo: delete release");
    expect(output.text).toContain("Cancelled: everything this run did is undone.");
  });

  it("given files written on the branch, when it is undone, then only those files are discarded, not the person's own", async () => {
    const { context, source } = world();
    source.seed({ changed: ["mine.txt"] });
    const branch = branchStep(context, { branch: "release", from: "main" });
    await branch.run();
    source.seed({ changed: ["mine.txt", "CHANGELOG.md"] });

    await branch.undo?.run();

    expect(source.received).toContainEqual({ type: "discard", files: ["CHANGELOG.md"] });
  });

  it("given an undo that fails too, when the release stops, then the rest are still undone and the commands left are listed", async () => {
    const { context, source, output } = world();
    source.failAt("delete-remote", 1, new Error("no access"));
    const steps = [
      branchStep(context, { branch: "release", from: "main" }),
      pushStep(context, "release"),
      step("open", () => Promise.reject(new Error("offline"))),
    ];

    await runSteps(context, steps);

    expect(source.received.map(({ type }) => type)).toContain("delete-branch");
    expect(output.text).toContain("✗ undo delete release on origin: no access");
    expect(output.text).toContain("Cancelled, not all of it: run these to finish the cleanup:");
    expect(output.text).toContain("git push origin --delete release");
    expect(output.text).not.toContain("git branch -D release");
  });

  it("given a step that keeps what it did, when a later one fails, then it says what stays and the one command to finish", async () => {
    const { context, output } = world();
    const kept: Step = {
      label: "tag",
      run: () => Promise.resolve(),
      kept: { label: "the tag stays", byHand: () => ["git push --tags"] },
    };

    await runSteps(context, [kept, step("release", () => Promise.reject(new Error("down")))]);

    expect(output.text).toContain("Cancelled, not all of it: the tag stays; run this to finish:");
    expect(output.text).toContain("git push --tags");
  });

  it("given a kept step with repeated commands, when a later one fails, then each command to finish is listed once", async () => {
    const { context, output } = world();
    const kept: Step = {
      label: "tag",
      run: () => Promise.resolve(),
      kept: { label: "the tag stays", byHand: () => ["a", "b", "a"] },
    };

    await runSteps(context, [kept, step("release", () => Promise.reject(new Error("down")))]);

    expect(output.text).toContain("the tag stays; run these to finish:");
    expect(output.lines.filter((line) => line.trim() === "a")).toHaveLength(1);
  });

  it("given a pull request opened, when a later step fails, then it is closed with a comment saying why", async () => {
    const { context, host, output } = world();
    const opened = { number: 42, url: "https://example.test/pr/42" };
    const steps = [
      openPrStep(context, "open the release PR", () => Promise.resolve(opened)),
      step("merge", () => Promise.reject(new Error("conflict"))),
    ];

    await runSteps(context, steps);

    expect(host.received).toContainEqual({
      type: "close",
      pr: opened,
      comment: "The release stopped part way, so it closed this.",
    });
    expect(output.text).toContain("undone");
  });

  it("given a pull request that never opened, when it is undone, then nothing is closed and nothing is left to run", async () => {
    const { context, host } = world();
    const open = openPrStep(context, "open", () => Promise.reject(new Error("down")));

    await open.undo?.run();

    expect(host.received).toEqual([]);
    expect(open.undo?.byHand()).toEqual([]);
  });

  it("given a pull request opened, when it cannot be closed, then the command to close it is given", async () => {
    const { context } = world();
    const open = openPrStep(context, "open", () => Promise.resolve({ number: 7, url: "u" }));

    await open.run();

    expect(open.undo?.byHand()).toEqual(["fake-host close 7"]);
    expect(open.undo?.label).toBe("close the pull request");
  });

  it("given a release branch that cannot be undone for the person, when they are told how, then the commands reset, switch back and delete it", () => {
    const { context } = world();

    const branch = branchStep(context, { branch: "release", from: "main" });

    expect(branch.label).toBe("branch release from main");
    expect(branch.undo?.byHand()).toEqual([
      "git reset --hard",
      "git switch main",
      "git branch -D release",
    ]);
  });
});
