import { describe, expect, it } from "vitest";

import type { Feature } from "../../modules/module";
import type { Requirement } from "../../ports/delivery.port";
import { ciPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { codeHostFake } from "../../adapters/code-host/__fakes__/code-host.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { sourceControlFake } from "../../adapters/source-control/__fakes__/source-control.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { versioningFake } from "../../adapters/versioning/__fakes__/versioning.fake";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { webApp } from "../../modules/web-app/web-app.module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { releaseFlow } from "../releaseFlow";
import { preflight, requirementsOf, signIn, signInsOf } from "../requirements";

// Every check and fix goes to a Fake shell: nothing signs in or runs on this machine.

const need = (label: string, extra: Partial<Requirement> = {}): Requirement => ({
  label,
  check: { command: label, args: ["whoami"] },
  fix: { command: label, args: ["login"] },
  ...extra,
});

const CLOUD = need("hostctl");
const SITECTL = need("sitectl", {
  check: { command: "sitectl", args: ["whoami"], cwd: "apps/web", env: { CI: "1" } },
});

const feature = (name: string, requirements: Requirement[]): Feature => ({
  type: "feature",
  name,
  adapters: [],
  requirements: () => requirements,
  afterShip: () => Promise.resolve([]),
});

/** api on a Cloud-like host, web on a Pages-like host, each with its own sign-in. */
const world = (
  options: {
    yes?: boolean;
    interactive?: boolean;
    features?: Feature[];
    flow?: Requirement[];
  } = {},
) => {
  const base = testContext({
    units: [
      testUnit("api", { module: "backend-service", options: { service: "api" } }),
      testUnit("web", { module: "web-app", options: { site: "web" } }),
    ],
    modules: [
      backendService({ serverHosting: { ...serverHostingFake(), requirements: () => [CLOUD] } }),
      webApp({ staticHosting: { ...staticHostingFake(), requirements: () => [SITECTL] } }),
    ],
    features: options.features ?? [],
    yes: options.yes,
    interactive: options.interactive,
  });
  const flowNeeds = options.flow ?? [];
  const flow = releaseFlow({
    sourceControl: { ...sourceControlFake(), requirements: () => flowNeeds.slice(0, 1) },
    codeHost: { ...codeHostFake(), requirements: () => flowNeeds.slice(1, 2) },
    ciPipeline: { ...ciPipelineFake(), requirements: () => flowNeeds.slice(2, 3) },
    versioning: { ...versioningFake(), requirements: () => flowNeeds.slice(3) },
  });
  const context = { ...base.context, release: { ...base.context.release, flow } };
  return { ...base, context };
};

const labels = (requirements: Requirement[]) => requirements.map(({ label }) => label);

describe("Feature: what a release needs signed in", () => {
  it("given the flow, two modules and a feature, when the release lists what to sign in to, then each tool is listed once, flow first", () => {
    const { context } = world({
      flow: [need("git"), need("codehost"), need("actions"), need("changesets")],
      features: [feature("notes", [need("codehost"), need("linear")])],
    });

    expect(labels(requirementsOf(context.release))).toEqual([
      "git",
      "codehost",
      "actions",
      "changesets",
      "hostctl",
      "sitectl",
      "linear",
    ]);
  });

  it("given only api picked, when the release lists what to sign in to, then only the host shipping api and the flow count", () => {
    const { context } = world({ flow: [need("git")] });

    expect(labels(signInsOf(context.release, new Set(["api"])))).toEqual(["hostctl"]);
    expect(labels(requirementsOf(context.release, new Set(["web"])))).toEqual(["git", "sitectl"]);
  });

  it("given no app picked, when the release lists what to sign in to, then no module needs anything", () => {
    const { context } = world();

    expect(signInsOf(context.release, new Set())).toEqual([]);
  });
});

describe("Feature: signing in before a release writes anything", () => {
  it("given every check passing, when the release preflights, then it goes on and asks nothing", async () => {
    const { context, prompter, shell } = world();

    expect(await preflight(context, new Set(["api", "web"]))).toBe(true);

    expect(prompter.asked).toEqual([]);
    expect(shell.calls).toEqual([
      { command: "hostctl", args: ["whoami"], cwd: "/repo", env: undefined },
      { command: "sitectl", args: ["whoami"], cwd: "/repo/apps/web", env: { CI: "1" } },
    ]);
  });

  it("given a sign-in missing, when the person runs the offered fix and it works, then the release goes on", async () => {
    const { context, prompter, shell } = world();
    shell.seedOnce("hostctl whoami", { status: 1 });
    prompter.answer(true);

    expect(await preflight(context, new Set(["api"]))).toBe(true);

    expect(prompter.asked).toEqual(["Run hostctl login now?"]);
    expect(prompter.initials["Run hostctl login now?"]).toBe(true);
    expect(shell.calls.map(({ command, args }) => [command, ...args].join(" "))).toEqual([
      "hostctl whoami",
      "hostctl login",
      "hostctl whoami",
    ]);
  });

  it("given a fix with its own folder and variables, when it is run, then it runs there with them", async () => {
    const { context, prompter, shell } = world();
    const scoped = need("storectl", {
      fix: { command: "storectl", args: ["login"], cwd: "apps/app", env: { EXPO: "1" } },
    });
    shell.seedOnce("storectl whoami", { status: 1 });
    prompter.answer(true);

    expect(await signIn(context, { requirements: [scoped], again: "retry" })).toBe(true);

    expect(shell.calls[1]).toEqual({
      command: "storectl",
      args: ["login"],
      cwd: "/repo/apps/app",
      env: { EXPO: "1" },
    });
  });

  it("given a fix that runs but the check still fails, when the release preflights, then it stops and says what to run", async () => {
    const { context, prompter, shell, output } = world();
    shell.seed("hostctl whoami", { status: 1 });
    prompter.answer(true);

    expect(await preflight(context, new Set(["api"]))).toBe(false);

    expect(output.text).toContain("Not signed in: hostctl");
    expect(output.text).toContain("nothing was written. Sign in, then run the release again.");
    expect(output.lines.slice(-2).map((line) => line.trim())).toEqual([
      expect.stringContaining("hostctl login"),
      expect.stringContaining("shiplane"),
    ]);
  });

  it("given the person declines the fix, when the release preflights, then nothing is run and it stops", async () => {
    const { context, prompter, shell } = world();
    shell.seed("hostctl whoami", { status: 1 });
    prompter.answer(false);

    expect(await preflight(context, new Set(["api"]))).toBe(false);

    expect(shell.calls.map(({ args }) => args[0])).toEqual(["whoami"]);
  });

  it("given a tool that is not installed, when the release preflights, then no fix is offered", async () => {
    const { context, prompter, shell, output } = world();
    shell.seed("hostctl whoami", { status: 127 });

    expect(await preflight(context, new Set(["api"]))).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("Not signed in: hostctl");
  });

  it("given --yes, when a sign-in is missing, then no fix is offered and nothing else runs", async () => {
    const { context, prompter, shell } = world({ yes: true });
    shell.seed("hostctl whoami", { status: 1 });

    expect(await preflight(context, new Set(["api"]))).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(shell.calls).toHaveLength(1);
  });

  it("given no terminal, when a sign-in is missing, then no fix is offered", async () => {
    const { context, prompter, shell } = world({ interactive: false });
    shell.seed("hostctl whoami", { status: 1 });

    expect(await preflight(context, new Set(["api"]))).toBe(false);

    expect(prompter.asked).toEqual([]);
  });

  it("given two missing sign-ins, one without a fix, when signing in, then both are named and only the fix is listed", async () => {
    const { context, shell, output } = world({ yes: true });
    shell.seed("", { status: 1 });
    const bare: Requirement = { label: "token", check: { command: "token", args: ["check"] } };

    expect(await signIn(context, { requirements: [CLOUD, bare], again: "try again" })).toBe(false);

    expect(output.text).toContain("Not signed in: hostctl, token");
    expect(output.text).toContain("Sign in, then try again.");
    expect(output.text).not.toContain("token check");
  });
});
