import { describe, expect, it } from "vitest";

import type { ReleaseUnit } from "../../domain/unit";
import type { AppInput } from "../../modules/module";
import type { DeliveryAdapter } from "../../ports/adapter.port";
import type { VersionContribution } from "../../ports/delivery.port";
import type { MobileDistributionPort } from "../../ports/mobile-distribution.port";
import type { PackageRegistryPort } from "../../ports/package-registry.port";
import type { PlatformEnvPort } from "../../ports/platform-env.port";
import { mobileDistributionFake } from "../../adapters/mobile-distribution/__fakes__/mobile-distribution.fake";
import { packageRegistryFake } from "../../adapters/package-registry/__fakes__/package-registry.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { mobileApp } from "../../modules/mobile-app/mobile-app.module";
import { publishedPackage } from "../../modules/published-package/published-package.module";
import { moduleFor, suggestedModule } from "../../modules/suggest";
import { webApp } from "../../modules/web-app/web-app.module";
import { TEST_FLOW } from "../../testing/flow";
import { testContext, testUnit } from "../../testing/releaseContext";
import { decideContext } from "../targets";

// An app's module composed from the provider it ships with, run on that provider's Fake: what the
// release learns about the app, and what it falls back to when a provider cannot answer.

const MOBILE = testUnit("phone", { module: "mobile-app", version: "2.0.0" });
const PACKAGE = testUnit("kit", { module: "published-package", version: "1.2.0" });

const inputFor = (unit: ReleaseUnit, options: Record<string, unknown>): AppInput => ({
  flow: TEST_FLOW,
  unit,
  tag: `${unit.name}@${unit.version}`,
  environment: "staging",
  options,
  commit: "c1",
  defaultBranch: "main",
});

const contextFor = (units: ReleaseUnit[]) => decideContext(testContext({ units }).context);

/** A mobile platform that answers only the stages every port must. */
const bareMobile = (): DeliveryAdapter<MobileDistributionPort> => {
  const full = mobileDistributionFake();
  return {
    ...full,
    create: () => ({
      capability: "mobile-distribution",
      describe: full.fake.describe,
      jobs: full.fake.jobs,
      decide: full.fake.decide,
    }),
  };
};

describe("Feature: composing an app's module from the provider it ships with", () => {
  it("given a server host, when a backend service is composed from it, then the release knows its provider, its settings and how long a ship takes", () => {
    const adapter = serverHostingFake();

    const module = backendService({ serverHosting: adapter });

    expect(module).toMatchObject({
      type: "module",
      name: "backend-service",
      kind: "backend-service",
      provider: "fake",
      capability: "server-hosting",
      typicalMinutes: 1,
    });
    expect(module.settings).toBe(adapter.settings);
    expect(module.adapters).toEqual([adapter]);
    expect(module.env).toBeUndefined();
  });

  it("given a second web app under its own name, when it is composed, then apps pick it by that name and it still ships as a web app", () => {
    const module = webApp({ name: "marketing", staticHosting: staticHostingFake() });

    expect(module.name).toBe("marketing");
    expect(module.kind).toBe("web-app");
  });

  it("given a provider that can read its platform's env, when its module is composed, then the env check before deploy can use it", () => {
    const env = (): PlatformEnvPort => ({ names: () => Promise.resolve([]) }) as never;
    const adapter = { ...serverHostingFake(), env };

    expect(backendService({ serverHosting: adapter }).env).toBe(env);
  });

  it("given a store that decides between an update and a build, when a mobile app is composed, then status can say who decides and how to check", () => {
    expect(mobileApp({ mobileDistribution: mobileDistributionFake() }).decidedBy).toEqual({
      platform: "the fake platform",
      choice: "update or nothing",
      check: "shiplane status",
    });
  });

  it("given two apps whose provider needs a sign-in each, when doctor asks what to check, then each app's sign-in is listed in order", () => {
    const adapter = {
      ...serverHostingFake(),
      requirements: (unit: ReleaseUnit) => [
        { label: `sign-in for ${unit.name}`, check: { command: "true", args: [] } },
      ],
    } as unknown as ReturnType<typeof serverHostingFake>;

    const module = backendService({ serverHosting: adapter });

    expect(
      module.requirements?.([testUnit("api"), testUnit("worker")]).map(({ label }) => label),
    ).toEqual(["sign-in for api", "sign-in for worker"]);
  });

  it("given a provider that needs nothing, when doctor asks what to check, then there is nothing to check", () => {
    const adapter = { ...serverHostingFake(), requirements: undefined };

    expect(backendService({ serverHosting: adapter }).requirements?.([testUnit("api")])).toEqual(
      [],
    );
  });

  it("given a tagged backend, when its ship is planned, then the person sees the service it lands on and the deploy job", () => {
    const adapter = serverHostingFake();
    const unit = testUnit("api", { module: "backend-service" });

    const plan = backendService({ serverHosting: adapter }).ship(
      contextFor([unit]),
      inputFor(unit, { service: "api-svc" }),
    );

    expect(plan.where).toBe("api-svc (fake)");
    expect(plan.jobs.map(({ label }) => label)).toEqual(["deploy api@0.1.0 to api-svc (fake)"]);
  });
});

describe("Feature: knowing whether a mobile build is live on its store", () => {
  it("given a build already on staging with healthy launches, when shiplane checks the app, then it skips the ship, calls it live and reports its health and version", async () => {
    const adapter = mobileDistributionFake();
    adapter.fake.seed({
      live: { staging: "2.0.0" },
      health: { "phone@2.0.0": { ok: true, summary: "3 launches" } },
    });
    const module = mobileApp({ mobileDistribution: adapter });
    const context = contextFor([MOBILE]);
    const input = inputFor(MOBILE, { app: "phone" });

    expect(await module.decide?.(context, input)).toEqual({
      action: "none",
      status: "phone 2.0.0 is on staging",
    });
    expect(await module.live?.(context, input)).toBe(true);
    expect(await module.health?.(context, input)).toEqual({ ok: true, summary: "3 launches" });
    expect(await module.inspect?.(context, input)).toEqual({ live: "2.0.0" });
  });

  it("given an older build on staging, when shiplane checks the app, then the new version is not live yet", async () => {
    const adapter = mobileDistributionFake();
    adapter.fake.seed({ live: { staging: "1.0.0" } });
    const module = mobileApp({ mobileDistribution: adapter });

    expect(await module.live?.(contextFor([MOBILE]), inputFor(MOBILE, { app: "phone" }))).toBe(
      false,
    );
  });

  it("given a store that can only ship, when shiplane checks or versions the app, then it counts as live and adds nothing to the release PR", async () => {
    const module = mobileApp({ mobileDistribution: bareMobile() });
    const context = contextFor([MOBILE]);
    const input = inputFor(MOBILE, { app: "phone" });

    expect(await module.live?.(context, input)).toBe(true);
    expect(await module.health?.(context, input)).toBeNull();
    expect(await module.inspect?.(context, input)).toBeUndefined();
    expect(module.versionFiles?.(MOBILE, [MOBILE], context.open)).toEqual([]);
    expect(await module.version?.(context, { ...input, bump: undefined })).toEqual({
      added: [],
      writes: [],
      summary: [],
      onMerge: "",
    });
  });

  it("given a store that bumps its own app files, when a release PR is prepared, then those files and the store's notes go in the PR", async () => {
    const full = mobileDistributionFake();
    const contribution: VersionContribution = {
      added: [],
      writes: [],
      summary: ["a store build"],
      onMerge: "builds",
    };
    const adapter: DeliveryAdapter<MobileDistributionPort> = {
      ...full,
      create: () =>
        Object.assign(full.fake, {
          versionFiles: (unit: ReleaseUnit, units: readonly ReleaseUnit[]) => [
            `${unit.dir}/app.json`,
            `${units.length}`,
          ],
          beforeVersion: () => Promise.resolve(contribution),
        }),
    };
    const module = mobileApp({ mobileDistribution: adapter });
    const context = contextFor([MOBILE]);

    expect(module.versionFiles?.(MOBILE, [MOBILE], context.open)).toEqual([
      "apps/phone/app.json",
      "1",
    ]);
    expect(
      await module.version?.(context, { ...inputFor(MOBILE, { app: "phone" }), bump: undefined }),
    ).toBe(contribution);
  });
});

describe("Feature: knowing whether a package version is already published", () => {
  it("given a version already on the registry, when shiplane checks the package, then nothing ships and it is live under its workspace name", async () => {
    const adapter = packageRegistryFake();
    adapter.fake.seed({ published: ["@acme/kit@1.2.0"] });
    const module = publishedPackage({ packageRegistry: adapter });
    const context = contextFor([PACKAGE]);
    const input = inputFor(PACKAGE, {});

    expect(await module.decide?.(context, input)).toEqual({
      action: "none",
      status: "@acme/kit@1.2.0 is published",
    });
    expect(await module.live?.(context, input)).toBe(true);
    expect(module.publishedName?.(context, input)).toBe("@acme/kit");
  });

  it("given a version not on the registry yet, when shiplane checks the package, then it is not live", async () => {
    const module = publishedPackage({ packageRegistry: packageRegistryFake() });

    expect(await module.live?.(contextFor([PACKAGE]), inputFor(PACKAGE, {}))).toBe(false);
  });

  it("given a package published under another name, when shiplane looks it up, then the registry's name is used", () => {
    const full = packageRegistryFake();
    const adapter: DeliveryAdapter<PackageRegistryPort> = {
      ...full,
      create: () => Object.assign(full.fake, { publishedName: () => "kit-cli" }),
    };

    expect(
      publishedPackage({ packageRegistry: adapter }).publishedName?.(
        contextFor([PACKAGE]),
        inputFor(PACKAGE, {}),
      ),
    ).toBe("kit-cli");
  });

  it("given a registry that does not rename packages, when shiplane looks it up, then the workspace name is used", () => {
    const full = packageRegistryFake();
    const adapter: DeliveryAdapter<PackageRegistryPort> = {
      ...full,
      create: () => Object.assign(full.fake, { publishedName: undefined }),
    };

    expect(
      publishedPackage({ packageRegistry: adapter }).publishedName?.(
        contextFor([PACKAGE]),
        inputFor(PACKAGE, {}),
      ),
    ).toBe("@acme/kit");
  });
});

describe("Feature: setup writing the right module for each provider it finds", () => {
  it.each([
    ["backend-service", serverHostingFake(), "backendService", "serverHosting"],
    ["web-app", staticHostingFake(), "webApp", "staticHosting"],
    ["mobile-app", mobileDistributionFake(), "mobileApp", "mobileDistribution"],
    ["published-package", packageRegistryFake(), "publishedPackage", "packageRegistry"],
  ])(
    "given a provider for a %s, when setup adds it to the config, then the module it writes is the module the release runs",
    (kind, adapter, factory, port) => {
      expect(suggestedModule(adapter)).toEqual({ kind, factory, port });

      const module = moduleFor(adapter, `my-${kind}`);

      expect(module.kind).toBe(kind);
      expect(module.name).toBe(`my-${kind}`);
      expect(module.adapters).toEqual([adapter]);
    },
  );
});
