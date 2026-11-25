import { publishedPackage } from "shiplane/plugin";
import { changesetText, planFrom, releaseToEntry, testContext, testUnit } from "shiplane/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { npmPackageRegistry } from "../npm-package-registry.adapter";

const NEW_FLAG = {
  id: "budget-new-flag",
  summary: "The budget check takes a --max flag.",
  releases: [{ name: "@acme/budget", type: "minor" as const }],
};

const setUp = (options: { yes?: boolean; interactive?: boolean } = {}) => {
  const world = testContext({
    units: [testUnit("budget", { version: "0.1.0", module: "published-package" })],
    modules: [publishedPackage({ packageRegistry: npmPackageRegistry() })],
    ...options,
  });
  world.versioning.seed({
    pending: [
      { id: NEW_FLAG.id, text: changesetText({ "@acme/budget": "minor" }, NEW_FLAG.summary) },
    ],
    plan: planFrom([NEW_FLAG], { "@acme/budget": "0.1.0" }),
  });
  // The release PR is closed unmerged, so a release that gets that far stops there.
  world.host.seed({ prStates: { 1800: ["CLOSED"] } });
  return world;
};

const OIDC = "ACTIONS_ID_TOKEN_REQUEST_URL";

beforeEach(() => {
  vi.stubEnv(OIDC, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checking sign-ins before a release writes anything", () => {
  it("given npm is not signed in, when a release starts, then it stops before any release PR and names npm login", async () => {
    const { context, shell, host, output } = setUp({ yes: true });
    shell.seed("npm whoami", { status: 1 });

    expect(await releaseToEntry(context)).toBe(false);

    expect(host.received.filter(({ type }) => type === "pr")).toEqual([]);
    expect(output.text).toContain("npm login");
  });

  it("given npm is not signed in and the person runs npm login when offered, when a release starts, then it checks again and goes on", async () => {
    const { context, shell, prompter } = setUp({ interactive: true });
    shell.seedOnce("npm whoami", { status: 1 });
    prompter.answer(["budget"], true, false);

    await releaseToEntry(context);

    expect(prompter.asked).toContain("Run npm login now?");
    expect(shell.calls.some(({ command, args }) => command === "npm" && args[0] === "login")).toBe(
      true,
    );
    expect(shell.calls.filter(({ args }) => args[0] === "whoami")).toHaveLength(2);
  });

  it("given every sign-in works, when a release starts, then the check says nothing and the release goes on to its PR", async () => {
    const { context, prompter, host } = setUp({ interactive: true });
    prompter.answer(["budget"], "minor");

    await releaseToEntry(context);

    expect(prompter.asked).not.toContain("Run npm login now?");
    expect(host.received.some(({ type }) => type === "pr")).toBe(true);
  });

  it("given a runner that mints OIDC tokens, when a release starts, then npm whoami is not asked", async () => {
    vi.stubEnv(OIDC, "https://token.example");
    const { context, shell, host } = setUp({ yes: true });
    shell.seed("npm whoami", { status: 1 });

    await releaseToEntry(context);

    expect(shell.calls.some(({ args }) => args[0] === "whoami")).toBe(false);
    expect(host.received.some(({ type }) => type === "pr")).toBe(true);
  });
});
