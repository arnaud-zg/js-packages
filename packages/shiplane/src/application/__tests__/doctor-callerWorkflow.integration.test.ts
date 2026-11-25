import { describe, expect, it } from "vitest";

import type { ServiceAdapter } from "../../ports/adapter.port";
import type { CiPipelinePort } from "../../ports/ci-pipeline.port";
import { CiPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { memoryRepository } from "../../testing/memoryRepository";
import { doctor } from "../doctor";
import { callerFor, callingPipeline, runningShiplane, SHIP_YML } from "./callerWorld";

// shiplane doctor checking the workflow a repository ships from, in memory: the CI pipeline is a
// Fake that makes the caller workflow for the shiplane versions it calls released.

const REPO = {
  "shiplane.config.ts": "export default defineRelease({ modules: [] });\n",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
};

/** A ship.yml written by hand around shiplane's workflow, pinned to 0.5.2. */
const OWN_PINNED = [
  "# Ours: ships on a manual run.",
  "name: Ship it",
  "on: workflow_dispatch",
  "jobs:",
  "  ship:",
  "    uses: acme/shiplane/.github/workflows/shiplane-ship.yml@sha-0.5.2 # shiplane@0.5.2",
  "    with: { environment: preview }",
  "",
].join("\n");

/** A caller workflow as a real adapter writes it, taking the tag to ship when `ref` is set. */
const callerTaking = (version: string, { ref }: { ref: boolean }) =>
  [
    "name: Ship",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      units:",
    '        default: ""',
    ...(ref ? ["      ref:", '        description: "The tag to ship"', '        default: ""'] : []),
    "",
    "jobs:",
    "  ship:",
    `    uses: acme/shiplane/.github/workflows/shiplane-ship.yml@sha-${version} # shiplane@${version}`,
    "    with:",
    "      units: ${{ inputs.units }}",
    ...(ref ? ["      ref: ${{ inputs.ref }}"] : []),
    "",
  ].join("\n");

/** A CI pipeline whose caller workflow takes the tag to ship. */
const refPipeline: ServiceAdapter<CiPipelinePort> = {
  name: "calling",
  create: () =>
    Object.assign(new CiPipelineFake(), {
      callerWorkflow: (version: string) =>
        Promise.resolve({
          file: SHIP_YML,
          content: callerTaking(version, { ref: true }),
          pin: `sha-${version}`,
        }),
    }),
};

const given = ({
  files = {},
  interactive = true,
  released = ["0.6.0"],
}: { files?: Record<string, string>; interactive?: boolean; released?: string[] } = {}) => {
  const repo = memoryRepository({ ...REPO, ...files }, [serverHostingFake()], { interactive });
  const context = runningShiplane(repo.context, "0.6.0", callingPipeline(released));
  return { ...repo, context };
};

describe("Feature: doctor checks the workflow a repository ships from", () => {
  it("given ship.yml pinned to the shiplane installed, when doctor runs, then it says so in one line and asks nothing", async () => {
    const { context, output, prompter } = given({ files: { [SHIP_YML]: callerFor("0.6.0") } });

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain("│  ✓ ship.yml  shiplane@0.6.0");
    expect(prompter.asked).toEqual([]);
  });

  it("given a release that ships from this machine and no ship.yml, when doctor runs, then it asks for none", async () => {
    const { context, output, prompter } = given();
    const load = context.load;
    context.load = async () => ({ ...(await load()), via: "local" });

    expect(await doctor(context)).toBe(true);

    expect(output.text).not.toContain("ship.yml");
    expect(prompter.asked).toEqual([]);
  });

  it("given no ship.yml, when doctor runs and the person agrees, then it is written", async () => {
    const { context, output, prompter, files } = given();
    prompter.answer(true);

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain("│  ✗ ship.yml missing");
    expect(prompter.asked).toEqual([`Write ${SHIP_YML}?`]);
    expect(prompter.initials[`Write ${SHIP_YML}?`]).toBe(true);
    expect(files.read(SHIP_YML)).toBe(callerFor("0.6.0"));
    expect(output.lines).toContain(`│  + ${SHIP_YML}`);
  });

  it("given no ship.yml, when the person declines, then nothing is written and doctor fails", async () => {
    const { context, output, prompter, files } = given();
    prompter.answer(false);

    expect(await doctor(context)).toBe(false);

    expect(files.exists(SHIP_YML)).toBe(false);
    expect(output.lines.at(-1)).toBe("└  Next: shiplane doctor");
  });

  it("given no ship.yml, when doctor runs with --yes, then it is written without asking", async () => {
    const { context, prompter, files } = given();

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(prompter.asked).toEqual([]);
    expect(files.read(SHIP_YML)).toBe(callerFor("0.6.0"));
  });

  it("given no ship.yml and nobody at the terminal, when doctor runs, then nothing is asked or written", async () => {
    const { context, prompter, files } = given({ interactive: false });

    expect(await doctor(context)).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(files.exists(SHIP_YML)).toBe(false);
  });

  it("given a ship.yml that does not call shiplane-ship.yml, when the person agrees to replace it, then it is replaced, the question defaulting to no", async () => {
    const { context, output, prompter, files } = given({
      files: { [SHIP_YML]: "name: Mine\non: push\n" },
    });
    prompter.answer(true);

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain("│  ✗ ship.yml does not call shiplane-ship.yml");
    const [asked = ""] = prompter.asked;
    expect(asked).toContain(`Replace ${SHIP_YML}`);
    expect(prompter.initials[asked]).toBe(false);
    expect(files.read(SHIP_YML)).toBe(callerFor("0.6.0"));
    expect(output.lines).toContain(`│  ~ ${SHIP_YML}`);
  });

  it("given a ship.yml that does not call shiplane-ship.yml, when doctor runs with --yes, then it is kept as written", async () => {
    const { context, prompter, files } = given({ files: { [SHIP_YML]: "name: Mine\n" } });

    expect(await doctor(context, { yes: true })).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(files.read(SHIP_YML)).toBe("name: Mine\n");
  });

  it("given a ship.yml that does not call shiplane-ship.yml and nobody at the terminal, when doctor runs, then it is kept as written", async () => {
    const { context, prompter, files } = given({
      files: { [SHIP_YML]: "name: Mine\n" },
      interactive: false,
    });

    expect(await doctor(context)).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(files.read(SHIP_YML)).toBe("name: Mine\n");
  });

  it("given ship.yml pinned to an older shiplane, when the person agrees to re-pin, then only its uses line changes", async () => {
    const { context, output, prompter, files } = given({ files: { [SHIP_YML]: OWN_PINNED } });
    prompter.answer(true);

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain("│  ✗ ship.yml pins shiplane@0.5.2, installed 0.6.0");
    expect(prompter.asked).toEqual([`Re-pin ${SHIP_YML} to shiplane@0.6.0?`]);
    expect(prompter.initials[`Re-pin ${SHIP_YML} to shiplane@0.6.0?`]).toBe(true);
    expect(files.read(SHIP_YML)).toBe(
      OWN_PINNED.replace("@sha-0.5.2 # shiplane@0.5.2", "@sha-0.6.0 # shiplane@0.6.0"),
    );
    expect(output.lines).toContain(`│  ~ ${SHIP_YML}`);
  });

  it("given ship.yml from before the tag input, when it is re-pinned, then it takes the tag to ship and passes it on, the rest as written", async () => {
    const repo = memoryRepository(
      { ...REPO, [SHIP_YML]: callerTaking("0.5.2", { ref: false }) },
      [serverHostingFake()],
      { interactive: true },
    );
    const context = runningShiplane(repo.context, "0.6.0", refPipeline);

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(repo.files.read(SHIP_YML)).toBe(callerTaking("0.6.0", { ref: true }));
  });

  it("given ship.yml already taking the tag, when it is re-pinned, then only its uses line changes", async () => {
    const repo = memoryRepository(
      { ...REPO, [SHIP_YML]: callerTaking("0.5.2", { ref: true }) },
      [serverHostingFake()],
      { interactive: true },
    );
    const context = runningShiplane(repo.context, "0.6.0", refPipeline);

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(repo.files.read(SHIP_YML)).toBe(callerTaking("0.6.0", { ref: true }));
  });

  it("given ship.yml pinned to an older shiplane, when doctor runs with --yes, then it is re-pinned without asking", async () => {
    const { context, prompter, files } = given({ files: { [SHIP_YML]: OWN_PINNED } });

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(prompter.asked).toEqual([]);
    expect(files.read(SHIP_YML)).toContain("# shiplane@0.6.0");
  });

  it("given ship.yml calling shiplane-ship.yml with no version noted, when doctor runs, then it offers to re-pin", async () => {
    const { context, output, prompter } = given({
      files: { [SHIP_YML]: "    uses: a/b/.github/workflows/shiplane-ship.yml@main\n" },
    });
    prompter.answer(false);

    expect(await doctor(context)).toBe(false);

    expect(output.lines).toContain("│  ✗ ship.yml pins no shiplane version, installed 0.6.0");
  });

  it("given a shiplane version with no release tag, when the person agrees to re-pin, then it says to pin by hand and keeps the file", async () => {
    const { context, output, prompter, files } = given({
      files: { [SHIP_YML]: OWN_PINNED },
      released: [],
    });
    prompter.answer(true);

    expect(await doctor(context)).toBe(false);

    expect(output.lines).toContain(
      "│  ! no release tag shiplane@0.6.0: pin shiplane-ship.yml by hand",
    );
    expect(files.read(SHIP_YML)).toBe(OWN_PINNED);
  });

  it("given a pipeline that cannot reach its host, when the person agrees to write ship.yml, then the failure is said and doctor fails", async () => {
    const repo = memoryRepository(REPO, [serverHostingFake()]);
    const pipeline = callingPipeline([]);
    const broken = {
      ...pipeline,
      create: (adapterContext: Parameters<typeof pipeline.create>[0]) => ({
        ...pipeline.create(adapterContext),
        callerWorkflow: () =>
          Promise.reject(new Error("codehost api exited with 1: Bad credentials")),
      }),
    };
    const context = runningShiplane(repo.context, "0.6.0", broken);
    repo.prompter.answer(true);

    expect(await doctor(context)).toBe(false);

    expect(repo.output.lines).toContain("│  ! codehost api exited with 1: Bad credentials");
  });

  it("given doctor on a runner, when it runs, then ship.yml is not checked", async () => {
    const { context, output, shell } = given();
    shell.seedEnv({ GITHUB_ACTIONS: "true" });

    expect(await doctor(context)).toBe(true);

    expect(output.text).not.toContain("ship.yml");
  });

  it("given doctor under CI, when it runs, then ship.yml is not checked", async () => {
    const { context, output, shell } = given();
    shell.seedEnv({ CI: "true" });

    expect(await doctor(context)).toBe(true);

    expect(output.text).not.toContain("ship.yml");
  });

  it("given no shiplane version known, when doctor runs, then ship.yml is not checked", async () => {
    const { context, output } = given();

    expect(await doctor({ ...context, version: undefined })).toBe(true);

    expect(output.text).not.toContain("ship.yml");
  });

  it("given a pipeline that writes no caller workflow, when doctor runs, then ship.yml is not checked", async () => {
    const repo = memoryRepository(REPO, [serverHostingFake()]);

    expect(await doctor({ ...repo.context, version: "0.6.0" })).toBe(true);

    expect(repo.output.text).not.toContain("ship.yml");
  });
});
