import { readFileSync } from "node:fs";
import type { Feature, ReleaseModule } from "shiplane";
import { cloudflarePagesStaticHosting } from "@shiplane/cloudflare-pages";
import { easMobileDistribution } from "@shiplane/eas";
import { flyServerHosting } from "@shiplane/fly";
import { gitSourceControl } from "@shiplane/git";
import { gitHubActionsCiPipeline, gitHubCodeHost, releaseComments } from "@shiplane/github";
import { githubPagesStaticHosting } from "@shiplane/github-pages";
import { npmPackageRegistry } from "@shiplane/npm";
import { backendService, mobileApp, publishedPackage, webApp } from "shiplane/plugin";
import { callerNeedsOf, RecordingShell, testContext, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The workflow every repository ships from, read as GitHub reads it, against the secrets the
// official adapters read on a runner; and the ship.yml setup writes for a release of them.

const API = testUnit("api", { module: "backend-service", options: { app: "acme-api" } });
const ADMIN = testUnit("admin", { module: "web-app", options: { project: "acme-admin" } });
const EXPO = testUnit("expo", { module: "mobile-app" });

const FLY = backendService({ serverHosting: flyServerHosting() });
const PAGES = webApp({ staticHosting: cloudflarePagesStaticHosting() });
const EAS = mobileApp({ mobileDistribution: easMobileDistribution() });

/** Each secret an official adapter reads on a runner, but the GH_TOKEN the workflow sets itself. */
const ADAPTER_SECRETS = [
  ...(FLY.requirements?.([API]) ?? []),
  ...(PAGES.requirements?.([ADMIN]) ?? []),
  ...(EAS.requirements?.([EXPO]) ?? []),
]
  .flatMap(({ secrets = [] }) => secrets)
  .filter((name) => name !== "GH_TOKEN")
  .sort();

interface Step {
  name?: string;
  env?: Record<string, string>;
}
interface ShipWorkflow {
  on: { workflow_call: { secrets: Record<string, unknown> } };
  jobs: { ship: { steps: Step[] } };
}

const WORKFLOW = new URL("../../../../.github/workflows/shiplane-ship.yml", import.meta.url);
const workflow = parse(readFileSync(WORKFLOW, "utf8")) as ShipWorkflow;
const stepsNamed = (...names: string[]) =>
  workflow.jobs.ship.steps.filter(({ name = "" }) => names.includes(name));

const COMMIT = "c0ffee0000000000000000000000000000000000";

/** The ship.yml setup writes for a release of `modules` and `features`, as GitHub's adapter makes it. */
const callerOf = async (
  modules: ReleaseModule[],
  features: Feature[] = [],
  units = [API, ADMIN, EXPO],
) => {
  const { context } = testContext({ units, modules, features });
  const shell = new RecordingShell();
  shell.seed("gh api repos/arnaud-zg/js-packages/git/ref/tags/shiplane@0.6.0", {
    stdout: JSON.stringify({ object: { sha: COMMIT, type: "commit" } }),
  });
  const made = await gitHubActionsCiPipeline()
    .create({ root: "/repo", shell })
    .callerWorkflow?.("0.6.0", callerNeedsOf(context.release));
  if (!made || "error" in made) throw new Error("no caller workflow made");
  return parse(made.content) as {
    on: { workflow_dispatch: { inputs: Record<string, { options?: string[]; default: unknown }> } };
    permissions: Record<string, string>;
    jobs: { ship: { secrets?: Record<string, string>; with?: Record<string, string> } };
  };
};

const byName = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, `\${{ secrets.${name} }}`]));

describe("the workflow every repository ships from", () => {
  it("given the official adapters, when shiplane-ship.yml is read, then it declares each secret they read and no other", () => {
    const declared = Object.keys(workflow.on.workflow_call.secrets)
      .filter((name) => !name.startsWith("SHIPLANE_APP_"))
      .sort();

    expect(declared).toEqual(ADAPTER_SECRETS);
  });

  it("given the official adapters, when shiplane-ship.yml checks and ships, then those two steps alone see each secret they read, and GH_TOKEN", () => {
    const shipping = stepsNamed("Check what ships", "Ship");

    expect(shipping).toHaveLength(2);
    for (const { env = {} } of shipping) {
      expect(env).toMatchObject(byName(ADAPTER_SECRETS));
      expect(env.GH_TOKEN).toBe("${{ steps.app.outputs.token || github.token }}");
    }
    const others = workflow.jobs.ship.steps.filter((step) => !shipping.includes(step));
    expect(JSON.stringify(others.map(({ env }) => env))).not.toContain("secrets.");
  });

  it("given apps on Cloudflare Pages only, when setup writes ship.yml, then it passes the two Cloudflare secrets", async () => {
    const caller = await callerOf([PAGES]);

    expect(caller.jobs.ship.secrets).toEqual(
      byName(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]),
    );
    expect(caller.permissions).toEqual({
      contents: "read",
      deployments: "write",
      actions: "read",
    });
  });

  it("given apps on EAS, Fly and Cloudflare Pages with release comments, when setup writes ship.yml, then it passes their four secrets and may comment", async () => {
    const comments = releaseComments({
      codeHost: gitHubCodeHost(),
      sourceControl: gitSourceControl(),
    });

    const caller = await callerOf([FLY, PAGES, EAS], [comments]);

    expect(caller.jobs.ship.secrets).toEqual(byName(ADAPTER_SECRETS));
    expect(Object.keys(caller.jobs.ship.secrets ?? {})).toEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "EXPO_TOKEN",
      "FLY_API_TOKEN",
    ]);
    expect(caller.permissions).toMatchObject({ issues: "write", "pull-requests": "write" });
  });

  it("given a site on GitHub Pages whose build reads variables, when setup writes ship.yml, then it may publish and passes them by name", async () => {
    const site = testUnit("site", {
      module: "web-app",
      options: { url: "https://acme.github.io/", variables: ["SITE_REGION", "SITE_KEY"] },
    });
    const caller = await callerOf(
      [webApp({ staticHosting: githubPagesStaticHosting() })],
      [],
      [site],
    );

    expect(caller.permissions).toEqual({
      contents: "write",
      deployments: "write",
      actions: "read",
      pages: "write",
    });
    expect(caller.jobs.ship.with).toMatchObject({ variables: "SITE_KEY SITE_REGION" });
    expect(caller.jobs.ship).not.toHaveProperty("secrets");
  });

  const KIT = testUnit("kit", { module: "published-package" });
  const NPM = publishedPackage({ packageRegistry: npmPackageRegistry() });
  const CHANNELS = ["snapshot", "nightly", "alpha", "beta", "rc", "live"];

  it.each([
    ["packages only", [NPM], [KIT], CHANNELS],
    ["packages and an app", [NPM, FLY], [KIT, API], ["preview", "production", ...CHANNELS]],
  ])(
    "given %s, when setup writes ship.yml, then it offers their environments and a dry run, and may publish",
    async (_, modules, units, environments) => {
      const caller = await callerOf(modules, [], units);
      const { inputs } = caller.on.workflow_dispatch;

      expect(inputs.environment).toMatchObject({ options: environments, default: environments[0] });
      expect(inputs["dry-run"]).toMatchObject({ default: false });
      expect(caller.jobs.ship.with).toMatchObject({ "dry-run": "${{ inputs.dry-run }}" });
      expect(caller.permissions).toMatchObject({ contents: "write", "id-token": "write" });
    },
  );

  it("given modules whose adapters read no secret, when setup writes ship.yml, then it passes none", async () => {
    const caller = await callerOf([]);

    expect(caller.jobs.ship).not.toHaveProperty("secrets");
  });
});
