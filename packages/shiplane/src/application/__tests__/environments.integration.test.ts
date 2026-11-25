import { describe, expect, it } from "vitest";

import type { DeployFlow } from "../../domain/environment";
import { ciPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { packageRegistryFake } from "../../adapters/package-registry/__fakes__/package-registry.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { registryDecision } from "../../domain/registry";
import { scopeChoices } from "../../domain/scope";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { publishedPackage } from "../../modules/published-package/published-package.module";
import { TEST_FLOW } from "../../testing/flow";
import { testContext, testUnit } from "../../testing/releaseContext";
import { branchRelease } from "../branchRelease";
import { callerWrite } from "../callerWorkflow";
import { promote } from "../promote";
import { readScope } from "../readScope";
import { shipTo } from "../ship";
import { resolvedOptions } from "../targets";

const API = testUnit("api", {
  module: "backend-service",
  version: "1.0.0",
  options: { service: "acme-api" },
});
const LIB = testUnit("lib", { module: "published-package" });

const given = (config: object, units = [API]) => {
  const world = testContext({
    units,
    modules: [
      backendService({ serverHosting: serverHostingFake() }),
      publishedPackage({ packageRegistry: packageRegistryFake() }),
    ],
  });
  world.source.seed({ tags: { "api@1.0.0": "head" } });
  return {
    ...world,
    context: { ...world.context, release: { ...world.context.release, ...config } },
  };
};

const STRAIGHT: { appFlow: DeployFlow } = {
  appFlow: { path: ["production"], users: "production" },
};
const THREE: { appFlow: DeployFlow } = {
  appFlow: { path: ["dev", "staging", "prod"], users: "prod" },
};

describe("Feature: choosing the environments apps go through", () => {
  it("given production only, when a release ships, then production gets it with no environment before, its name typed", async () => {
    const { context, prompter, shell, host } = given(STRAIGHT);
    prompter.answer("production", true);

    expect(await shipTo(context, "production", { via: "local" })).toBe(true);

    expect(prompter.asked[0]).toBe('Type "production" to start:');
    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual(["deploy acme-api api@1.0.0"]);
    expect(host.received).toMatchObject([{ environment: "production" }]);
  });

  it.each([
    ["production", {}, "preview"],
    ["staging", THREE, "dev"],
    ["prod", THREE, "staging"],
  ])(
    "given %s asked before what comes first, when it ships, then it refuses",
    async (environment, config, first) => {
      const { context, prompter, output, shell } = given(config);
      if (environment !== "staging") prompter.answer(environment);

      await shipTo(context, environment, { via: "local" });

      expect(output.text).toContain(`not on ${first} yet: ship it there first`);
      expect(shell.calls).toEqual([]);
    },
  );

  it("given three environments and a version on the second, when it ships to the third, then it goes, its name typed", async () => {
    const { context, prompter, host } = given(THREE);
    host.seed({ deployments: [{ title: "Deploy api@1.0.0 to staging", state: "done" }] });
    prompter.answer("prod", true);

    expect(await shipTo(context, "prod", { via: "local" })).toBe(true);

    expect(prompter.asked[0]).toBe('Type "prod" to start:');
    expect(host.received).toMatchObject([{ environment: "prod" }]);
  });

  it("given three environments, when --yes ships to the one users are on, then it refuses, and not for the others", async () => {
    const { context, output, host } = given(THREE);
    const yes = { ...context, options: { yes: true, ci: false } };

    expect(await shipTo(yes, "prod", { via: "local" })).toBe(false);
    expect(output.text).toContain("No --yes on prod");
    expect(await shipTo(yes, "dev", { via: "local" })).toBe(true);
    expect(host.received).toMatchObject([{ environment: "dev" }]);
  });

  it.each([
    ["production", STRAIGHT, "1.0.0 released, not on production yet", true],
    ["dev", THREE, "1.0.0 released, not on dev yet", true],
    ["staging", THREE, "1.0.0 is not on dev yet: release it there first", false],
  ])(
    "given a tagged app, when %s's scope is read, then it says where it stands",
    async (environment, config, hint, pending) => {
      const { context } = given(config);

      const info = await readScope(context, environment);
      const [choice] = scopeChoices(info, environment, config.appFlow);

      expect(choice).toMatchObject({ pending, hint });
    },
  );

  it("given three environments, when a person promotes, then they pick where it goes", async () => {
    const { context, prompter, host } = given(THREE);
    host.seed({ deployments: [{ title: "Deploy api@1.0.0 to dev", state: "done" }] });
    prompter.answer("staging", ["api"], true);

    expect(await promote(context, "local")).toBe(true);

    expect(prompter.choices["Promote to?"]?.map(({ value, hint }) => [value, hint])).toEqual([
      ["staging", "from what dev runs"],
      ["prod", "from what staging runs"],
    ]);
    expect(host.received).toMatchObject([{ environment: "staging" }]);
  });

  it("given an option written per environment, when it is read, then each name has its value", () => {
    const { context } = given(THREE);
    const module = backendService({ serverHosting: serverHostingFake() });
    const unit = testUnit("api", {
      module: "backend-service",
      options: { service: "acme", url: { dev: "d", staging: "s", prod: "p" } },
    });

    const urls = THREE.appFlow.path.map(
      (name) => resolvedOptions(module, unit, name, context.release.units, THREE.appFlow.path).url,
    );

    expect(urls).toEqual(["d", "s", "p"]);
  });

  it.each([
    ["production", TEST_FLOW, "not-on-previous"],
    ["production", STRAIGHT.appFlow, "publish"],
    ["prod", THREE.appFlow, "not-on-previous"],
    ["dev", THREE.appFlow, "publish"],
  ])(
    "given a registry asked for %s, when it decides, then the environment before counts",
    async (environment, flow, ship) => {
      const decided = await registryDecision({
        environment,
        flow,
        facts: {
          tagged: () => Promise.resolve(true),
          published: () => Promise.resolve(false),
          sinceTagOnlyVersionFiles: () => Promise.resolve(true),
          onDistTag: () => Promise.resolve(false),
        },
      });

      expect(decided).toBe(ship);
    },
  );
});

describe("Feature: choosing the channels packages publish on", () => {
  it("given channels without beta, when beta is asked, then it refuses and names them", async () => {
    const { context, output } = given({ channels: ["nightly", "live"] }, [LIB]);

    expect(await branchRelease(context, { onDefault: "publish", channel: "beta" })).toBe(false);

    expect(output.text).toContain("publishPackages.channels is nightly, live");
  });
});

describe("Feature: choosing what a branch publishes", () => {
  it("given onBranch false, when a snapshot is asked, then it refuses", async () => {
    const { context, output } = given({ onBranch: false }, [LIB]);

    expect(await branchRelease(context, { onDefault: "publish", channel: "snapshot" })).toBe(false);

    expect(output.text).toContain("publishPackages.onBranch is false");
  });

  it("given channels only, when a snapshot is asked, then it is not refused", async () => {
    const { context, output } = given({ channels: ["live"] }, [LIB]);

    await branchRelease(context, { onDefault: "publish", channel: "snapshot", dryRun: true });

    expect(output.text).not.toContain("not published here");
  });
});

describe("Feature: deploying apps from a branch", () => {
  const onBranch = (config: object = { deployOnBranch: "preview" }, branch = "feat/x") => {
    const world = given(config);
    world.source.seed({ position: { branch, head: "abc1234def", originMain: "head" } });
    world.versioning.seed({
      plan: () => ({
        changesets: [],
        releases: [
          {
            name: "@acme/api",
            type: "minor",
            oldVersion: "1.0.0",
            newVersion: "1.1.0",
            changesets: [],
          },
        ],
      }),
    });
    const ran = () => world.shell.calls.map(({ args }) => args.join(" "));
    return { ...world, ran };
  };
  const snapshot = { onDefault: "publish", channel: "snapshot" } as const;

  it("given onBranch and a pending app, when a person agrees, then this checkout deploys there and no deploy is recorded", async () => {
    const { context, prompter, ran, host } = onBranch();
    prompter.answer(true);

    expect(await branchRelease(context, snapshot)).toBe(true);

    expect(prompter.asked).toEqual([
      "Deploy api from feat/x to preview? It replaces what runs there until the next release.",
    ]);
    expect(ran()).toEqual(["deploy acme-api api@1.0.0-feat-x.abc1234"]);
    expect(host.received).toEqual([]);
  });

  it("given the person declines, when asked, then nothing deploys", async () => {
    const { context, prompter, ran } = onBranch();
    prompter.answer(false);

    expect(await branchRelease(context, snapshot)).toBe(true);

    expect(ran()).toEqual([]);
  });

  it.each([
    ["no onBranch", onBranch({}), snapshot],
    ["the default branch", onBranch(undefined, "main"), snapshot],
    ["a numbered channel", onBranch(), { ...snapshot, channel: "beta" }],
    ["a dry run", onBranch(), { ...snapshot, dryRun: true }],
  ])(
    "given %s, when a test release runs, then no app deploys",
    async (_, { context, prompter, ran }, how) => {
      await branchRelease(context, how);

      expect(prompter.asked).toEqual([]);
      expect(ran()).toEqual([]);
    },
  );

  it("given a runner, when a test release runs, then no app deploys", async () => {
    const { context, ran } = onBranch();

    await branchRelease({ ...context, options: { yes: true, ci: true } }, snapshot);

    expect(ran()).toEqual([]);
  });
});

describe("Feature: ship.yml lists what the config says", () => {
  const every = ["snapshot", "nightly", "alpha", "beta", "rc", "live"];

  it.each([
    ["apps", {}, [API], ["preview", "production"]],
    ["apps on production only", STRAIGHT, [API], ["production"]],
    ["apps on three", THREE, [API], ["dev", "staging", "prod"]],
    ["packages", {}, [LIB], every],
    [
      "packages on two channels",
      { channels: ["nightly", "live"] },
      [LIB],
      ["snapshot", "nightly", "live"],
    ],
    ["packages with nothing on a branch", { channels: ["live"], onBranch: false }, [LIB], ["live"]],
    ["both", {}, [API, LIB], ["preview", "production", ...every]],
  ])("given %s, when setup writes it, then it asks for those", async (_, config, units, listed) => {
    const { context } = given(config, units);
    const asked: unknown[] = [];
    const pipeline = ciPipelineFake();
    Object.assign(pipeline.fake, {
      callerWorkflow: (_version: string, needs: { environments?: string[] }) => {
        asked.push(needs.environments);
        return Promise.resolve({ error: "asked" });
      },
    });
    const release = { ...context.release, flow: { ...context.release.flow, ciPipeline: pipeline } };

    await callerWrite(
      {
        ...context,
        root: "/repo",
        adapters: [],
        version: "0.6.0",
        files: new MemoryFiles(),
        load: () => Promise.resolve(release),
      },
      release,
    );

    expect(asked).toEqual([listed]);
  });
});
