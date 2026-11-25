import { describe, expect, it } from "vitest";

import { shipTo } from "../ship";
import { decidingModule, jobOn, SHIP_YML, shipWorld } from "./shipWorld";

// How each unit ships: through the CI pipeline or from this machine, forced, said or asked.

describe("Feature: shipping through the CI pipeline", () => {
  it("given api tagged with ship.yml on its tag, when shipped through CI with --yes, then ship.yml is dispatched on the tag and the commands to follow it are shown", async () => {
    // given
    const { context, ci, output, progress } = shipWorld(["api"], { yes: true });

    // when
    const ok = await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: "api@0.1.0",
        inputs: { units: "api", environment: "preview" },
      },
    ]);
    expect(progress.events).toContainEqual({
      kind: "during",
      mood: "working",
      text: "ship api from api@0.1.0 (ship.yml)",
      step: { index: 0, total: 1 },
    });
    expect(output.lines).toContain("✓ Triggered. api@0.1.0, shipping to preview on their own.");
    expect(output.lines).toContain("    fake-ci runs");
    expect(output.lines).toContain("    shiplane status --channel preview");
  });

  it("given api and web tagged on one commit, when shipped through CI, then one run ships both from the first tag", async () => {
    // given
    const { context, ci, source } = shipWorld(["api", "web"], { yes: true });
    source.seed({ tags: { "api@0.1.0": "same", "web@0.1.0": "same" } });

    // when
    await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: "api@0.1.0",
        inputs: { units: "api web", environment: "preview" },
      },
    ]);
  });

  it("given api and web tagged on two commits, when shipped through CI, then each tag gets its own run, in order", async () => {
    // given
    const { context, ci } = shipWorld(["api", "web"], { yes: true });

    // when
    await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ci.received.map(({ ref, inputs }) => [ref, inputs.units])).toEqual([
      ["api@0.1.0", "api"],
      ["web@0.1.0", "web"],
    ]);
  });

  it("given a job the CI pipeline runs from main, when shipped through CI, then each run goes on main, never on a tag's commit", async () => {
    // given
    const deciding = decidingModule((tag) => ({
      action: "ship",
      kind: "deploy",
      jobs: [jobOn(`ship ${tag}`, "main")],
    }));
    const { context, ci, source } = shipWorld([], { yes: true, deciding, decided: ["a", "b"] });
    source.seed({ files: { [`main:${SHIP_YML}`]: "on: dispatch" } });

    // when
    await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ci.received.map(({ ref, inputs }) => [ref, inputs.units])).toEqual([["main", "a b"]]);
  });

  it("given the dispatch fails, when shipped through CI, then the ship fails, says why and offers every tag of that run again", async () => {
    // given
    const { context, ci, source, output } = shipWorld(["api", "web"], { yes: true });
    source.seed({ tags: { "api@0.1.0": "same", "web@0.1.0": "same" } });
    ci.dispatch = () => Promise.reject(new Error("HTTP 422"));

    // when
    const ok = await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain(
      "✗ ship api, web from api@0.1.0 (ship.yml) failed: HTTP 422, nothing after it ran.",
    );
    expect(output.lines).toContain(
      "    Run shiplane again: it offers api@0.1.0 and web@0.1.0 again",
    );
    expect(output.text).not.toContain("Triggered");
  });
});

describe("Feature: forcing a way that cannot ship an app", () => {
  it("given no ship.yml anywhere, when forced through CI, then api is skipped with what to do instead and nothing runs", async () => {
    // given
    const { context, ci, source, output } = shipWorld(["api"], { yes: true });
    source.seed({ files: {} });

    // when
    const ok = await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  ! api@0.1.0  no ship.yml: ship it from this machine");
    expect(ci.received).toEqual([]);
  });

  it("given ship.yml on main but not on api's tag, when forced through CI, then api is skipped as older than ship.yml", async () => {
    // given
    const { context, source, output } = shipWorld(["api"], { yes: true });
    source.seed({ files: { [`main:${SHIP_YML}`]: "on: dispatch" } });

    // when
    await shipTo(context, "preview", { via: "ci" });

    // then
    expect(output.lines).toContain("  ! api@0.1.0  predates ship.yml: ship it from this machine");
  });

  it("given a job only this machine can run, when forced through CI, then it is skipped with that reason", async () => {
    // given
    const deciding = decidingModule(() => ({
      action: "ship",
      kind: "deploy",
      jobs: [jobOn("deploy a")],
    }));
    const { context, output } = shipWorld([], { yes: true, deciding, decided: ["a"] });

    // when
    await shipTo(context, "preview", { via: "ci" });

    // then
    expect(output.lines).toContain(
      "  ! a@0.1.0  only ships from this machine: ship it from this machine",
    );
  });

  it("given main moved past api's tag, when forced from this machine, then it points to the CI pipeline and runs nothing", async () => {
    // given
    const { context, source, shell, output } = shipWorld(["api"], { yes: true });
    source.seed({ diffs: { "api@0.1.0..HEAD": ["apps/api/src/server.ts"] } });

    // when
    const ok = await shipTo(context, "preview", { via: "local" });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain(
      "  ! api@0.1.0  main moved past it: this machine builds its checkout, ship it through Fake CI",
    );
    expect(shell.calls).toEqual([]);
  });
});

describe("Feature: shipping from this machine", () => {
  it("given api tagged and main unmoved, when shipped from this machine, then its job runs at the root and the deploy is recorded", async () => {
    // given
    const { context, shell, host, output, ci } = shipWorld(["api"], { yes: true });

    // when
    const ok = await shipTo(context, "preview", { via: "local" });

    // then
    expect(ok).toBe(true);
    expect(shell.calls).toEqual([
      { command: "echo", args: ["deploy", "acme-api", "api@0.1.0"], cwd: "/repo" },
    ]);
    expect(host.received).toEqual([{ type: "record", ref: "api@0.1.0", environment: "preview" }]);
    expect(ci.received).toEqual([]);
    expect(output.lines).not.toContain("    fake-ci runs");
  });

  it("given uncommitted changes, when shipped from this machine, then it refuses before anything runs", async () => {
    // given
    const { context, source, shell, output } = shipWorld(["api"], { yes: true });
    source.seed({ clean: false });

    // when
    const ok = await shipTo(context, "preview", { via: "local" });

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain(
      "✗ Uncommitted changes: this machine ships its checkout: commit or stash them first.",
    );
    expect(shell.calls).toEqual([]);
  });

  it("given uncommitted changes, when shipped through CI, then they do not matter", async () => {
    // given
    const { context, source, ci } = shipWorld(["api"], { yes: true });
    source.seed({ clean: false });

    // when
    const ok = await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(ci.received).toHaveLength(1);
  });

  it("given api's deploy exits with 1, when shipped from this machine, then web never runs and api is offered again", async () => {
    // given
    const { context, shell, output } = shipWorld(["api", "web"], { yes: true });
    shell.seedOnce("echo deploy acme-api", { status: 1 });

    // when
    const ok = await shipTo(context, "preview", { via: "local" });

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain(
      "✗ deploy api@0.1.0 to acme-api (fake) failed: echo exited with 1, nothing after it ran.",
    );
    expect(output.lines).toContain("    Run shiplane again: it offers api@0.1.0 again");
    expect(shell.calls.map(({ args }) => args[1])).toEqual(["acme-api"]);
  });
});

describe("Feature: being told the only way an app can ship", () => {
  it("given no ship.yml, when shipping with no way given, then it says api ships from this machine and asks to ship it that way", async () => {
    // given
    const { context, source, shell, prompter, output } = shipWorld(["api"]);
    source.seed({ files: {} });
    prompter.answer(true);

    // when
    const ok = await shipTo(context, "preview", {});

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  · api@0.1.0  no ship.yml: ships from this machine");
    expect(prompter.asked).toEqual(["Ship api@0.1.0 to preview through this machine?"]);
    expect(prompter.initials["Ship api@0.1.0 to preview through this machine?"]).toBe(true);
    expect(shell.calls).toHaveLength(1);
  });

  it("given main moved past api's tag, when shipping with no way given, then it ships through the CI pipeline", async () => {
    // given
    const { context, source, ci, output } = shipWorld(["api"], { yes: true });
    source.seed({ diffs: { "api@0.1.0..HEAD": ["apps/api/src/server.ts"] } });

    // when
    await shipTo(context, "preview", {});

    // then
    expect(output.lines).toContain("  · api@0.1.0  main moved past it: ships through Fake CI");
    expect(ci.received).toHaveLength(1);
  });

  it("given main moved and no ship.yml for api, when shipping api and web, then api cannot ship, web still ships and the ship fails", async () => {
    // given
    const { context, source, shell, output } = shipWorld(["api", "web"], { yes: true });
    source.seed({
      files: { [`web@0.1.0:${SHIP_YML}`]: "on: dispatch" },
      diffs: {
        "api@0.1.0..HEAD": ["apps/api/src/server.ts"],
        "web@0.1.0..HEAD": ["apps/api/src/server.ts"],
      },
    });

    // when
    const ok = await shipTo(context, "preview", {});

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain(
      "  ✗ api@0.1.0  no ship.yml, and main moved past it: nothing can ship it",
    );
    expect(output.lines).toContain("✓ Triggered. web@0.1.0, shipping to preview on their own.");
    expect(shell.calls).toEqual([]);
  });

  it("given the only app cannot ship either way, when shipping, then nothing is asked and the ship fails", async () => {
    // given
    const { context, source, prompter } = shipWorld(["api"]);
    source.seed({ files: {}, diffs: { "api@0.1.0..HEAD": ["apps/api/src/server.ts"] } });

    // when
    const ok = await shipTo(context, "preview", {});

    // then
    expect(ok).toBe(false);
    expect(prompter.asked).toEqual([]);
  });
});

describe("Feature: choosing how each app ships when both ways can", () => {
  it("given both ways open for api and web, when the person picks CI for api and this machine for web, then each ships its own way", async () => {
    // given
    const { context, prompter, shell, ci, progress } = shipWorld(["api", "web"]);
    prompter.answer("ci", "local", true);
    const question = "Ship api@0.1.0 (Fake CI), web@0.1.0 (this machine) to preview?";

    // when
    const ok = await shipTo(context, "preview", {});

    // then
    expect(ok).toBe(true);
    expect(prompter.asked).toEqual([
      "How should api@0.1.0 ship to preview?",
      "How should web@0.1.0 ship to preview?",
      question,
    ]);
    expect(ci.received.map(({ ref }) => ref)).toEqual(["api@0.1.0"]);
    expect(shell.calls.map(({ args }) => args[2])).toEqual(["web@0.1.0"]);
    expect(progress.events.filter(({ kind }) => kind === "during").slice(-2)).toEqual([
      {
        kind: "during",
        mood: "working",
        text: "deploy web@0.1.0 to acme-web (fake)",
        step: { index: 0, total: 2 },
      },
      {
        kind: "during",
        mood: "working",
        text: "ship api from api@0.1.0 (ship.yml)",
        step: { index: 1, total: 2 },
      },
    ]);
  });

  it("given both ways open and the config ships through CI, when shipping, then only the confirmation is asked", async () => {
    // given
    const { context, prompter, ci } = shipWorld(["api"]);
    context.release.via = "ci";
    prompter.answer(true);

    // when
    await shipTo(context, "preview", {});

    // then
    expect(prompter.asked).toEqual(["Ship api@0.1.0 to preview through Fake CI?"]);
    expect(ci.received).toHaveLength(1);
  });

  it("given both ways open, when the person cancels the way question, then nothing ships and the run is fine", async () => {
    // given
    const { context, prompter, ci, shell, output } = shipWorld(["api"]);
    prompter.answer(null);

    // when
    const ok = await shipTo(context, "preview", {});

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  Nothing shipped.");
    expect(ci.received).toEqual([]);
    expect(shell.calls).toEqual([]);
  });

  it("given both ways open and no terminal, when shipping, then it fails and asks to say how to ship", async () => {
    // given
    const { context, output } = shipWorld(["api"], { interactive: false });

    // when
    const ok = await shipTo(context, "preview", {});

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("✗ Not a terminal: say how to ship.");
    expect(output.lines).toContain("  Nothing shipped.");
  });

  it("given a CI runner, when shipping through CI, then the runner deploys itself and dispatches nothing", async () => {
    // given
    const { context, ci, shell } = shipWorld(["api"], { yes: true });
    context.options.ci = true;

    // when
    const ok = await shipTo(context, "preview", { via: "ci" });

    // then
    expect(ok).toBe(true);
    expect(ci.received).toEqual([]);
    expect(shell.calls).toHaveLength(1);
  });
});
