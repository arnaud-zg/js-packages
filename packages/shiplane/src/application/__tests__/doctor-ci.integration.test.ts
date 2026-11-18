import { describe, expect, it } from "vitest";

import type { Requirement } from "../../ports/delivery.port";
import type { SetupContext } from "../setupContext";
import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import { MemoryOutput, ScriptedPrompter } from "../../adapters/terminal/__fakes__/terminal.fake";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { doctorCi, WORKFLOW_DOCS } from "../doctorCi";

// What a runner checks before it ships: the units, the environment, each tool, each secret.

const INSTALL = { command: "sh", args: ["-c", "curl -fsSL https://fly.io/install.sh | sh"] };

const FLYCTL: Requirement = {
  label: "flyctl",
  check: { command: "flyctl", args: ["auth", "whoami"] },
  install: { command: INSTALL, path: "$HOME/.fly/bin" },
  secrets: ["FLY_API_TOKEN"],
};

/** api and web shipped with a host named fly, needing `requirement`, on a runner with its token. */
const runner = (requirement: Requirement = FLYCTL) => {
  const hosting = serverHostingFake();
  hosting.fake.seed({ requirements: [requirement] });
  const { context: release } = testContext({
    units: ["api", "web"].map((name) =>
      testUnit(name, { module: "backend-service", options: { service: `acme-${name}` } }),
    ),
    modules: [backendService({ serverHosting: { ...hosting, name: "fly" } })],
  });
  const shell = new RecordingShell().seedEnv({
    HOME: "/home/runner",
    PATH: "/usr/bin",
    GITHUB_PATH: "/runner/path",
    FLY_API_TOKEN: "token",
  });
  const files = new MemoryFiles();
  const output = new MemoryOutput();
  const context: SetupContext = {
    root: "/repo",
    files,
    shell,
    prompter: new ScriptedPrompter(false),
    output,
    adapters: [],
    load: () => Promise.resolve(release.release),
  };
  return { context, shell, files, output, release: release.release };
};

/** The problem said, then the docs link, as the last two lines. */
const stoppedWith = (output: MemoryOutput) => output.lines.slice(-2);

describe("Feature: checking a runner can ship before it does", () => {
  it("given every tool and secret in place, when doctor --ci runs, then it passes with one line per check", async () => {
    // given
    const { context, output } = runner();

    // when
    const ok = await doctorCi(context, { units: [], channel: "preview" });

    // then
    expect(ok).toBe(true);
    expect(output.lines).toEqual([
      "✓ units  api, web",
      "✓ environment  preview",
      "✓ flyctl  installed",
      "✓ secrets  FLY_API_TOKEN",
    ]);
  });

  it("given a unit the config does not have, when doctor --ci runs, then it names it and the known ones, with the docs", async () => {
    // given
    const { context, output } = runner();

    // when
    const ok = await doctorCi(context, { units: ["api", "x"], channel: "preview" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)).toEqual([
      "✗ unknown units [x]: known [api, web]",
      `  ${WORKFLOW_DOCS}`,
    ]);
  });

  it("given an environment that does not exist, when doctor --ci runs, then it names the ones that do", async () => {
    // given
    const { context, output } = runner();

    // when
    const ok = await doctorCi(context, { units: ["api"], channel: "qa" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)).toEqual([
      '✗ unknown environment "qa": preview, production',
      `  ${WORKFLOW_DOCS}`,
    ]);
  });

  it("given a secret the picked unit needs and the run lacks, when doctor --ci runs, then it names the unit, its host, the secret and the environment", async () => {
    // given
    const { context, shell, output } = runner();
    shell.seedEnv({ FLY_API_TOKEN: "" });

    // when
    const ok = await doctorCi(context, { units: ["api"], channel: "preview" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)).toEqual([
      '✗ api ships with fly: FLY_API_TOKEN missing in "preview"',
      `  ${WORKFLOW_DOCS}`,
    ]);
  });

  it("given a secret the flow itself needs and the run lacks, when doctor --ci runs, then it says shiplane needs it", async () => {
    // given
    const { context, release, output } = runner({ ...FLYCTL, secrets: [] });
    const gh = { label: "gh", check: { command: "gh", args: ["auth", "status"] } };
    release.flow = {
      ...release.flow,
      codeHost: {
        ...release.flow.codeHost,
        requirements: () => [{ ...gh, secrets: ["GH_TOKEN"] }],
      },
    };

    // when
    const ok = await doctorCi(context, { units: ["web"], channel: "production" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)).toEqual([
      '✗ shiplane needs gh: GH_TOKEN missing in "production"',
      `  ${WORKFLOW_DOCS}`,
    ]);
  });

  it("given a config with a problem, when doctor --ci runs, then it says the problem where it is", async () => {
    // given
    const { context, release, output } = runner();
    release.problems = [{ file: "shiplane.config.ts", line: 3, message: "it did not load" }];

    // when
    const ok = await doctorCi(context, { units: [], channel: "preview" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)).toEqual([
      "✗ shiplane.config.ts:3: it did not load",
      `  ${WORKFLOW_DOCS}`,
    ]);
  });
});

describe("Feature: installing a missing tool on a runner", () => {
  it("given flyctl missing with an install, when doctor --ci runs, then it installs it, puts its folder first on PATH and in GITHUB_PATH, and checks again", async () => {
    // given
    const { context, shell, files, output } = runner();
    shell.seedOnce("flyctl auth whoami", { status: 127 });

    // when
    const ok = await doctorCi(context, { units: ["api"], channel: "preview" });

    // then
    expect(ok).toBe(true);
    expect(shell.calls.map(({ command, args }) => [command, ...args].join(" "))).toEqual([
      "flyctl auth whoami",
      "sh -c curl -fsSL https://fly.io/install.sh | sh",
      "flyctl auth whoami",
    ]);
    expect(shell.env("PATH")).toBe("/home/runner/.fly/bin:/usr/bin");
    expect(files.read("/runner/path")).toBe("/home/runner/.fly/bin\n");
    expect(output.lines).toContain("✓ flyctl  installed now");
  });

  it("given flyctl missing and no install, when doctor --ci runs, then it fails saying so", async () => {
    // given
    const { context, shell, output } = runner({ ...FLYCTL, install: undefined });
    shell.seed("flyctl auth whoami", { status: 127 });

    // when
    const ok = await doctorCi(context, { units: [], channel: "preview" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)).toEqual([
      "✗ flyctl missing and no install for linux",
      `  ${WORKFLOW_DOCS}`,
    ]);
  });

  it("given an install that fails, when doctor --ci runs, then it says the command and its exit", async () => {
    // given
    const { context, shell, output } = runner();
    shell.seed("flyctl auth whoami", { status: 127 }).seed("sh -c curl", { status: 6 });

    // when
    const ok = await doctorCi(context, { units: [], channel: "preview" });

    // then
    expect(ok).toBe(false);
    expect(stoppedWith(output)[0]).toBe(
      "✗ flyctl install failed: sh -c curl -fsSL https://fly.io/install.sh | sh exited with 6",
    );
  });

  it("given an install that leaves the tool missing, when doctor --ci runs, then it says so", async () => {
    // given
    const { context, shell, files, output } = runner({
      ...FLYCTL,
      install: { command: INSTALL },
    });
    shell.seed("flyctl auth whoami", { status: 127 });

    // when
    const ok = await doctorCi(context, { units: [], channel: "preview" });

    // then
    expect(ok).toBe(false);
    expect(files.changes).toEqual([]);
    expect(shell.env("PATH")).toBe("/usr/bin");
    expect(stoppedWith(output)[0]).toMatch(/^✗ flyctl still missing after sh -c /);
  });

  it("given an install path and no GITHUB_PATH, when doctor --ci installs, then only this run's PATH changes", async () => {
    // given
    const { context, shell, files } = runner({
      ...FLYCTL,
      install: { command: INSTALL, path: "${HOME}/bin" },
    });
    shell.seedEnv({ GITHUB_PATH: "" }).seedOnce("flyctl auth whoami", { status: 127 });

    // when
    const ok = await doctorCi(context, { units: [], channel: "preview" });

    // then
    expect(ok).toBe(true);
    expect(shell.env("PATH")).toBe("/home/runner/bin:/usr/bin");
    expect(files.changes).toEqual([]);
  });
});
