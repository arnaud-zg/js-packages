import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { setup } from "../setup";
import { callerFor, callingPipeline, runningShiplane, SHIP_YML } from "./callerWorld";

// Setup writing the workflow a repository ships from, in memory: the CI pipeline is a Fake that
// makes the caller workflow for the shiplane versions it calls released, and asks gh nothing.

const fly = () =>
  detecting(serverHostingFake(), "fly", "fly.toml", (folder) => ({ service: folder.name }));

const PROVEN = {
  "package.json": JSON.stringify({ name: "acme", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  ".github/workflows/ci.yml": "on: push\n",
  ".changeset/config.json": "{}\n",
  "apps/api/package.json": JSON.stringify({
    name: "@acme/api",
    version: "0.1.0",
    scripts: { build: "tsc" },
  }),
  "apps/api/fly.toml": 'app = "acme-api"\n',
};

const given = (files: Record<string, string>, released = ["0.6.0"]) => {
  const repo = memoryRepository(files, [fly()]);
  repo.shell.seed("git remote get-url origin", { stdout: "git@github.com:acme/mono.git\n" });
  const context = runningShiplane(repo.context, "0.6.0", callingPipeline(released));
  return { ...repo, context };
};

describe("Feature: setup writes the workflow a repository ships from", () => {
  it("given a new repository, when setup runs and the person keeps it, then ship.yml is written as the pipeline makes it and listed with the rest", async () => {
    const { context, prompter, output, files } = given(PROVEN);
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read(SHIP_YML)).toBe(callerFor("0.6.0"));
    expect(output.lines).toContain(`  + ${SHIP_YML}`);
  });

  it("given a new repository, when the person declines to write it, then ship.yml is not left behind", async () => {
    const { context, prompter, files } = given(PROVEN);
    prompter.answer(true, false);

    expect(await setup(context, { yes: false })).toBe(false);

    expect(files.exists(SHIP_YML)).toBe(false);
    expect(files.exists("shiplane.config.ts")).toBe(false);
  });

  it("given a ship.yml already there, when setup runs, then it is kept as the person wrote it", async () => {
    const { context, prompter, output, files } = given({ ...PROVEN, [SHIP_YML]: "name: Mine\n" });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read(SHIP_YML)).toBe("name: Mine\n");
    expect(output.lines).not.toContain(`  + ${SHIP_YML}`);
  });

  it("given a set up repository without ship.yml, when setup runs again, then only ship.yml is offered", async () => {
    const { context, prompter, output, files } = given(PROVEN);
    prompter.answer(true, true);
    await setup(context, { yes: false });
    files.remove(SHIP_YML);
    output.lines.length = 0;
    prompter.answer(true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked.at(-1)).toBe("Releasable. Write it?");
    expect(files.read(SHIP_YML)).toBe(callerFor("0.6.0"));
    expect(output.lines).toContain(`  + ${SHIP_YML}`);
    expect(output.lines).not.toContain("  ~ shiplane.config.ts");
  });

  it("given a set up repository with ship.yml, when setup runs again, then all is set and nothing is asked", async () => {
    const { context, prompter, output } = given(PROVEN);
    prompter.answer(true, true);
    await setup(context, { yes: false });
    const asked = prompter.asked.length;

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked).toHaveLength(asked);
    expect(output.lines.at(-1)).toBe("  ✓ all set");
  });

  it("given a shiplane version with no release tag, when setup runs, then it says to pin by hand and writes the rest", async () => {
    const { context, prompter, output, files } = given(PROVEN, []);
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(output.lines).toContain(
      "  ! no release tag shiplane@0.6.0: pin shiplane-ship.yml by hand",
    );
    expect(files.exists(SHIP_YML)).toBe(false);
    expect(files.exists("shiplane.config.ts")).toBe(true);
  });

  it("given no shiplane version known, when setup runs, then no ship.yml is made", async () => {
    const { context, prompter, files } = given(PROVEN);
    prompter.answer(true, true);

    expect(await setup({ ...context, version: undefined }, { yes: false })).toBe(true);

    expect(files.exists(SHIP_YML)).toBe(false);
  });

  it("given a pipeline that writes no caller workflow, when setup runs, then no ship.yml is made", async () => {
    const repo = memoryRepository(PROVEN, [fly()]);
    repo.shell.seed("git remote get-url origin", { stdout: "git@github.com:acme/mono.git\n" });
    repo.prompter.answer(true, true);

    expect(await setup({ ...repo.context, version: "0.6.0" }, { yes: false })).toBe(true);

    expect(repo.files.exists(SHIP_YML)).toBe(false);
  });
});
