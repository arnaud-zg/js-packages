import { describe, expect, it } from "vitest";

import { ciPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { packageRegistryFake } from "../../adapters/package-registry/__fakes__/package-registry.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { registryDecision } from "../../domain/registry";
import { scopeChoices } from "../../domain/scope";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { publishedPackage } from "../../modules/published-package/published-package.module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { branchRelease } from "../branchRelease";
import { callerWrite } from "../callerWorkflow";
import { readScope } from "../readScope";
import { shipTo } from "../ship";

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

describe("Feature: choosing the environments apps ship to", () => {
  it("given production only, when a release ships, then production gets it with no preview before, its name typed", async () => {
    const { context, prompter, shell, host } = given({ environments: ["production"] });
    prompter.answer("production", true);

    expect(await shipTo(context, "preview", { via: "local" })).toBe(true);

    expect(prompter.asked[0]).toBe('Type "production" to start:');
    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual(["deploy acme-api api@1.0.0"]);
    expect(host.received).toMatchObject([{ environment: "production" }]);
  });

  it("given both, when production ships before preview, then it still refuses", async () => {
    const { context, prompter, output, shell } = given({});
    prompter.answer("production");

    await shipTo(context, "production", { via: "local" });

    expect(output.text).toContain("not on preview yet");
    expect(shell.calls).toEqual([]);
  });

  it("given production only and a tagged app, when the release's scope is read, then it is offered for production", async () => {
    const { context } = given({ environments: ["production"] });

    const [choice] = scopeChoices(await readScope(context, "preview"), "preview");

    expect(choice).toMatchObject({ pending: true, hint: "1.0.0 released, not on production yet" });
  });

  it.each([
    [true, "not-on-preview"],
    [false, "publish"],
  ])(
    "given a registry whose repository has a preview: %s, when production is asked, then it decides %s",
    async (stages, ship) => {
      const decided = await registryDecision({
        environment: "production",
        stages,
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

describe("Feature: ship.yml lists what the config says", () => {
  const every = ["snapshot", "nightly", "alpha", "beta", "rc", "live"];

  it.each([
    ["apps", {}, [API], undefined],
    ["apps on production only", { environments: ["production"] }, [API], ["production"]],
    ["packages", {}, [LIB], every],
    ["packages on two channels", { channels: ["nightly", "live"] }, [LIB], ["nightly", "live"]],
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
