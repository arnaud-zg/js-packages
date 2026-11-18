import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { SHIPLANE_RENOVATE_PRESET } from "../callerWorkflow";
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

  it("given an app whose adapter reads a token on a runner, when setup writes ship.yml, then it passes that secret by name and no other", async () => {
    const hosting = fly();
    hosting.fake.seed({
      requirements: [
        {
          label: "flyctl",
          check: { command: "flyctl", args: ["auth", "whoami"] },
          secrets: ["GH_TOKEN", "FLY_API_TOKEN"],
        },
      ],
    });
    const repo = memoryRepository(PROVEN, [hosting]);
    repo.shell.seed("git remote get-url origin", { stdout: "git@github.com:acme/mono.git\n" });
    const context = runningShiplane(repo.context, "0.6.0", callingPipeline(["0.6.0"]));
    repo.prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(repo.files.read(SHIP_YML)).toBe(
      callerFor("0.6.0", { secrets: ["FLY_API_TOKEN"], features: [] }),
    );
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

describe("Feature: setup has Renovate keep the ship.yml pin current", () => {
  const PRESET = `"${SHIPLANE_RENOVATE_PRESET}"`;

  it("given a renovate.json without the preset, when setup writes ship.yml, then the preset joins its extends and the rest is kept", async () => {
    const renovate = { $schema: "x", extends: ["config:recommended"], labels: ["deps"] };
    const { context, prompter, output, files } = given({
      ...PROVEN,
      "renovate.json": JSON.stringify(renovate),
    });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("renovate.json")).toBe(
      `${JSON.stringify(
        { ...renovate, extends: ["config:recommended", SHIPLANE_RENOVATE_PRESET] },
        null,
        2,
      )}\n`,
    );
    expect(output.lines).toContain("  ~ renovate.json  Renovate keeps the ship.yml pin current");
  });

  it("given a renovate.json without the preset, when the person declines to write, then it is put back as it was", async () => {
    const { context, prompter, files } = given({ ...PROVEN, "renovate.json": "{}" });
    prompter.answer(true, false);

    expect(await setup(context, { yes: false })).toBe(false);

    expect(files.read("renovate.json")).toBe("{}");
  });

  it("given a set up repository whose ship.yml calls shiplane-ship.yml and a .renovaterc with no extends, when setup runs again, then extends is made with the preset", async () => {
    const { context, prompter, files } = given(PROVEN);
    prompter.answer(true, true);
    await setup(context, { yes: false });
    files.write(".renovaterc", '{ "labels": ["deps"] }');
    prompter.answer(true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(JSON.parse(files.read(".renovaterc") ?? "")).toEqual({
      labels: ["deps"],
      extends: [SHIPLANE_RENOVATE_PRESET],
    });
  });

  it("given a renovate.json5, when setup writes ship.yml, then it is left alone and the line to add is named", async () => {
    const { context, prompter, output, files } = given({
      ...PROVEN,
      "renovate.json5": "{ extends: ['config:recommended'] }\n",
    });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("renovate.json5")).toBe("{ extends: ['config:recommended'] }\n");
    expect(output.lines).toContain(
      `  ! renovate.json5: add ${PRESET} to extends to keep the ship.yml pin current`,
    );
  });

  it("given a renovate.json5 that is plain JSON, or a renovate.json that is not JSON, when setup writes ship.yml, then neither is edited", async () => {
    for (const [file, text] of [
      ["renovate.json5", '{ "extends": [] }'],
      ["renovate.json", "{ extends: [] }"],
    ] as const) {
      const { context, prompter, output, files } = given({ ...PROVEN, [file]: text });
      prompter.answer(true, true);

      expect(await setup(context, { yes: false })).toBe(true);

      expect(files.read(file)).toBe(text);
      expect(output.lines).toContain(
        `  ! ${file}: add ${PRESET} to extends to keep the ship.yml pin current`,
      );
    }
  });

  it("given a renovate key in package.json, when setup writes ship.yml, then package.json is left alone and the line to add is named", async () => {
    const manifest = JSON.stringify({ name: "acme", private: true, renovate: { extends: [] } });
    const { context, prompter, output, files } = given({ ...PROVEN, "package.json": manifest });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("package.json")).toBe(manifest);
    expect(output.lines).toContain(
      `  ! package.json: add ${PRESET} to extends to keep the ship.yml pin current`,
    );
  });

  it("given no Renovate config, when setup writes ship.yml, then none is made and doctor is said to keep the pin", async () => {
    const { context, prompter, output, files } = given(PROVEN);
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.exists("renovate.json")).toBe(false);
    expect(output.lines).toContain(
      `  shiplane doctor keeps the ship.yml pin current; on Renovate, add ${PRESET} to extends`,
    );
  });

  it("given a renovate.json with the preset, when setup writes ship.yml, then it is kept and nothing is said", async () => {
    const renovate = `{\n  "extends": [${PRESET}]\n}\n`;
    const { context, prompter, output, files } = given({ ...PROVEN, "renovate.json": renovate });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("renovate.json")).toBe(renovate);
    expect(output.lines.join("\n")).not.toContain("renovate");
  });

  it("given a ship.yml that does not call shiplane-ship.yml, when setup runs, then Renovate is not mentioned", async () => {
    const { context, prompter, output, files } = given({
      ...PROVEN,
      [SHIP_YML]: "name: Mine\n",
      "renovate.json": "{}",
    });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("renovate.json")).toBe("{}");
    expect(output.lines.join("\n")).not.toContain("Renovate");
  });
});
