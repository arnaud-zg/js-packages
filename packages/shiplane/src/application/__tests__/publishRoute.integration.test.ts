import { describe, expect, it } from "vitest";

import { registryDecision } from "../../domain/registry";
import { scopeChoices } from "../../domain/scope";
import { branchRelease } from "../branchRelease";
import { doctorCi } from "../doctorCi";
import { readScope } from "../readScope";
import { shipTo } from "../ship";
import { shipCommand } from "../shipCommand";
import {
  BRANCH,
  branchWorld,
  HEAD,
  kit,
  lib,
  LIB_MANIFEST,
  manifest,
  web,
} from "./releaseBranchWorld";

const ASK = "Where should 1.3.0-beta.0 publish from?";
const FILE = "ci/ship.yml";

const world = (options: { interactive?: boolean; offers?: string; pushed?: string } = {}) => {
  const made = branchWorld({ yes: false, interactive: options.interactive ?? true });
  made.source.seed({ files: { [`${BRANCH}:${FILE}`]: options.offers ?? "beta" } });
  Object.assign(made.source, { pushedHead: () => Promise.resolve(options.pushed ?? HEAD) });
  return made;
};

const beta = { onDefault: "publish", channel: "beta" } as const;

describe("Feature: choosing where a test release publishes from", () => {
  it("given no via, when the person picks CI, then the workflow runs on the branch and nothing publishes here", async () => {
    const { context, prompter, ci, shell } = world();
    prompter.answer("ci");

    expect(await branchRelease(context, beta)).toBe(true);

    expect(prompter.asked).toEqual([ASK]);
    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: BRANCH,
        inputs: { units: "lib", environment: "beta" },
      },
    ]);
    expect(shell.calls).toEqual([]);
  });

  it("given no via, when the person picks this machine, then it publishes here", async () => {
    const { context, prompter, ci, distTags } = world();
    prompter.answer("local");

    expect(await branchRelease(context, beta)).toBe(true);

    expect(ci.received).toEqual([]);
    expect(distTags).toEqual(["beta"]);
  });

  it("given the person cancels, when asked, then nothing runs", async () => {
    const { context, prompter, ci, distTags } = world();
    prompter.answer(null);

    expect(await branchRelease(context, beta)).toBe(true);

    expect(ci.received).toEqual([]);
    expect(distTags).toEqual([]);
  });

  it.each(["ci", "local"] as const)(
    "given via %s in the config, when it runs, then nothing is asked",
    async (via) => {
      const { context, prompter, ci } = world();

      await branchRelease({ ...context, release: { ...context.release, via } }, beta);

      expect(prompter.asked).toEqual([]);
      expect(ci.received).toHaveLength(via === "ci" ? 1 : 0);
    },
  );

  it.each([
    ["the workflow lacks the channel", { offers: "preview" }, "ship.yml does not offer beta"],
    ["the branch is not pushed", { pushed: "older" }, "is not pushed as it is here"],
  ])("given %s, when it runs, then it says so and publishes here", async (_, options, said) => {
    const { context, output, distTags } = world(options);

    expect(await branchRelease(context, beta)).toBe(true);

    expect(output.text).toContain(said);
    expect(distTags).toEqual(["beta"]);
  });

  it("given --via ci and CI cannot, when it runs, then nothing publishes", async () => {
    const { context, distTags } = world({ offers: "preview" });

    expect(await branchRelease(context, { ...beta, via: "ci" })).toBe(false);

    expect(distTags).toEqual([]);
  });

  it("given nobody to ask, when it runs, then it publishes from this machine", async () => {
    const { context, distTags } = world({ interactive: false });

    expect(await branchRelease(context, beta)).toBe(true);

    expect(distTags).toEqual(["beta"]);
  });
});

describe("Feature: naming the packages a test release publishes", () => {
  const two = () =>
    branchWorld({
      units: [lib, kit, web],
      pending: [
        { name: "@acme/lib", newVersion: "1.3.0" },
        { name: "@acme/ui-kit", newVersion: "0.5.0" },
      ],
      files: {
        "packages/lib/package.json": LIB_MANIFEST,
        "packages/kit/package.json": manifest({ name: "@acme/ui-kit", version: "0.4.0" }),
      },
    });

  it("given one named, when it runs, then only that one publishes", async () => {
    const { context, shell } = two();

    await branchRelease(context, { ...beta, units: ["kit"] });

    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual([
      "publish @acme/ui-kit 0.5.0-beta.0",
    ]);
  });

  it.each(["web", "nope"])(
    "given %s, not a package, when it runs, then it refuses",
    async (name) => {
      const { context, output } = two();

      expect(await branchRelease(context, { ...beta, units: [name] })).toBe(false);

      expect(output.text).toContain(`Not a package: ${name}`);
    },
  );
});

/** lib, whose preview has a tag of its own or not, beside a web app or alone. */
const released = ({ stages = false, alone = false, lib: published = false } = {}) => {
  const made = branchWorld({ yes: false, interactive: true, units: alone ? [lib] : [lib, web] });
  Object.assign(made.registry.fake, {
    stages: () => stages,
    decide: async (_: unknown, input: Parameters<typeof made.registry.fake.jobs>[0]) => {
      const ship = await registryDecision({
        environment: input.environment,
        stages: input.stages,
        facts: {
          tagged: () => Promise.resolve(true),
          published: () => Promise.resolve(published),
          sinceTagOnlyVersionFiles: () => Promise.resolve(true),
          onDistTag: () => Promise.resolve(published),
        },
      });
      return ship === "publish"
        ? { action: "ship", kind: "publish", jobs: made.registry.fake.jobs(input) }
        : { action: "none", status: ship };
    },
  });
  made.source.seed({
    position: { branch: "main", head: "head", originMain: "head" },
    tags: { "lib@1.2.0": "head" },
    files: { [`main:${FILE}`]: "preview production" },
  });
  const ran = () => made.shell.calls.map(({ args }) => args.join(" "));
  return { ...made, ran };
};

const PUBLISH = "publish @acme/lib 1.2.0";
const SCOPE = { scope: new Set(["lib"]) };

describe("Feature: preview is for checking, production is for users", () => {
  it("given apps and a package with nothing to preview, when preview ships, then the package waits", async () => {
    const { context, output, ran } = released();

    expect(await shipTo(context, "preview", SCOPE)).toBe(true);

    expect(output.text).toContain("no-preview");
    expect(ran()).toEqual([]);
  });

  it("given the same, when production ships, then the package publishes with no preview before", async () => {
    const { context, prompter, ran } = released();
    prompter.answer("production", "local", true);

    expect(await shipTo(context, "production", SCOPE)).toBe(true);

    expect(ran()).toContain(PUBLISH);
  });

  it("given a package preview publishes first, when preview ships, then it publishes", async () => {
    const { context, prompter, ran } = released({ stages: true });
    prompter.answer("local", true);

    await shipTo(context, "preview", SCOPE);

    expect(ran()).toContain(PUBLISH);
  });

  it("given the same, when production ships before preview, then it refuses", async () => {
    const { context, prompter, ran } = released({ stages: true });
    prompter.answer("production");

    await shipTo(context, "production", SCOPE);

    expect(ran()).toEqual([]);
  });

  it("given packages only, when a release ships, then it goes straight to production, its name not typed", async () => {
    const { context, prompter, registry, ran } = released({ alone: true });
    prompter.answer("local", true);

    expect(await shipTo(context, "preview", SCOPE)).toBe(true);

    expect(ran()).toContain(PUBLISH);
    expect(registry.fake.received.every(({ environment }) => environment === "production")).toBe(
      true,
    );
    expect(prompter.asked).toEqual([
      "Where should lib@1.2.0 publish from?",
      expect.stringContaining("to production"),
    ]);
  });

  it("given packages only and CI picked, when a release ships, then one run goes to production on main", async () => {
    const { context, prompter, ci, ran } = released({ alone: true });
    prompter.answer("ci", true);

    expect(await shipTo(context, "preview", SCOPE)).toBe(true);

    expect(ci.received).toMatchObject([
      { ref: "main", inputs: { units: "lib", environment: "production" } },
    ]);
    expect(ran()).toEqual([]);
  });

  it("given a workflow without the permissions a publish needs, when a release ships, then it says so and publishes here", async () => {
    const { context, registry, prompter, output, ran } = released({ alone: true });
    registry.fake.seed({
      requirements: [
        {
          label: "registry",
          check: { command: "true", args: [] },
          permissions: { "id-token": "write" },
        },
      ],
    });
    prompter.answer(true);

    await shipTo(context, "preview", SCOPE);

    expect(output.text).toContain("does not allow id-token: write");
    expect(ran()).toContain(PUBLISH);
  });

  it("given a runner, when production ships, then it publishes there and dispatches nothing", async () => {
    const { context, ci, ran } = released({ alone: true });

    const done = await shipCommand(
      { ...context, options: { yes: true, ci: true } },
      { environment: "production", units: [] },
    );

    expect(done).toBe(true);
    expect(ci.received).toEqual([]);
    expect(ran()).toContain(PUBLISH);
  });

  it.each([
    [{ alone: true }, true, "1.2.0 released, not on production yet"],
    [{}, false, "1.2.0 released, promote ships it"],
  ])(
    "given %j and a tagged package, when preview's scope is read, then it is offered: %s",
    async (how, pending, hint) => {
      const { context } = released(how);

      const [choice] = scopeChoices(await readScope(context, "preview"), "preview");

      expect(choice).toEqual({ app: "lib", pending, hint });
    },
  );

  it("given a tagged package that skips preview, when production's scope is read, then it is offered", async () => {
    const { context } = released();

    const [choice] = scopeChoices(await readScope(context, "production"), "production");

    expect(choice).toMatchObject({
      pending: true,
      hint: "1.2.0 released, goes straight to production",
    });
  });

  it.each([
    ["production", [], true],
    ["nightly", [], true],
    ["latest", [], false],
    ["beta", ["web"], false],
  ])(
    "given doctor --ci for %s with units %j, when it checks, then it passes: %s",
    async (channel, units, ok) => {
      const { context } = released();
      const setup = {
        ...context,
        root: "/repo",
        adapters: [],
        load: () => Promise.resolve(context.release),
      };

      expect(await doctorCi(setup, { units, channel })).toBe(ok);
    },
  );
});
