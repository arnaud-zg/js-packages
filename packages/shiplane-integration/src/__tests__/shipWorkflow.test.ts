import { readFileSync } from "node:fs";
import type { Feature, ReleaseModule } from "shiplane";
import { cloudflarePagesStaticHosting } from "@shiplane/cloudflare-pages";
import { easMobileDistribution } from "@shiplane/eas";
import { flyServerHosting } from "@shiplane/fly";
import { gitSourceControl } from "@shiplane/git";
import { gitHubActionsCiPipeline, gitHubCodeHost, releaseComments } from "@shiplane/github";
import { githubPagesStaticHosting } from "@shiplane/github-pages";
import { backendService, mobileApp, webApp } from "shiplane/plugin";
import { callerNeedsOf, RecordingShell, testContext, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The action every repository ships with, read as GitHub reads it, against the secrets the
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
    jobs: { ship: { env?: Record<string, string>; steps: { with: Record<string, unknown> }[] } };
  };
};

type Caller = Awaited<ReturnType<typeof callerOf>>;

/** What ship.yml gives the ship action. */
const given = (caller: Caller) => caller.jobs.ship.steps.at(-1)?.with ?? {};

/** The secrets among it, by name. */
const secretsOf = (caller: Caller) =>
  Object.fromEntries(
    Object.entries(given(caller)).filter(([, value]) => String(value).includes("secrets.")),
  );

const byName = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, `\${{ secrets.${name} }}`]));

const ACTION = new URL("../../../../.github/actions/ship/action.yml", import.meta.url);
const action = parse(readFileSync(ACTION, "utf8")) as {
  inputs: Record<string, unknown>;
  runs: { using: string; steps: (Step & { run?: string; shell?: string })[] };
};

describe("the ship action", () => {
  const shipping = action.runs.steps.filter(({ name = "" }) =>
    ["Check what ships", "Ship"].includes(name),
  );

  it("given the official adapters, when it is read, then it takes each secret they read and no other", () => {
    const taken = Object.keys(action.inputs).filter((name) => /^[A-Z_]+$/.test(name));

    expect(taken.sort()).toEqual(ADAPTER_SECRETS);
  });

  it("given it ships, when its steps are read, then only the check and the ship see a secret", () => {
    expect(shipping).toHaveLength(2);
    for (const { env = {} } of shipping) {
      expect(env).toMatchObject(
        Object.fromEntries(ADAPTER_SECRETS.map((name) => [name, `\${{ inputs.${name} }}`])),
      );
    }
    const others = action.runs.steps.filter((step) => !shipping.includes(step));
    for (const name of ADAPTER_SECRETS) expect(JSON.stringify(others)).not.toContain(name);
  });

  it("given a composite action, when its steps run, then each names its shell and reads no secret context", () => {
    expect(action.runs.using).toBe("composite");
    for (const step of action.runs.steps.filter(({ run }) => run)) expect(step.shell).toBeTruthy();
    expect(JSON.stringify(action.runs.steps)).not.toMatch(/\bsecrets\.|toJSON\(vars\)/);
  });
});

describe("the workflow every repository ships from", () => {
  it("given apps on Cloudflare Pages only, when setup writes ship.yml, then it passes the two Cloudflare secrets", async () => {
    const caller = await callerOf([PAGES]);

    expect(secretsOf(caller)).toEqual(byName(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]));
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

    expect(secretsOf(caller)).toEqual(byName(ADAPTER_SECRETS));
    expect(Object.keys(secretsOf(caller))).toEqual([
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
    expect(caller.jobs.ship.env).toEqual({
      SITE_KEY: "${{ vars.SITE_KEY }}",
      SITE_REGION: "${{ vars.SITE_REGION }}",
    });
    expect(secretsOf(caller)).toEqual({});
  });

  it("given modules whose adapters read no secret, when setup writes ship.yml, then it passes none", async () => {
    const caller = await callerOf([]);

    expect(secretsOf(caller)).toEqual({});
  });
});
