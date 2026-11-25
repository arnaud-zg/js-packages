import { describe, expect, it } from "vitest";

import type { EnvVarName } from "../../domain/checkEnvBeforeDeploy";
import type { Environment } from "../../domain/environment";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { EnvToCheck, isEnvVarName } from "../../domain/checkEnvBeforeDeploy";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { reportEnvToCheck } from "../reportEnvToCheck";

// doctor's env section: each unit that lists env to check, read on every environment.

const names = (...list: string[]) => list.filter(isEnvVarName);

/** A platform holding these names per environment; one it cannot read throws. */
const platform = (held: Partial<Record<Environment, EnvVarName[]>>) => ({
  listNames: ({ environment }: { environment: Environment }) => {
    const set = held[environment];
    return set ? Promise.resolve(new Set(set)) : Promise.reject(new Error("401 unauthorized"));
  },
  setCommand: ({
    environment,
    names: unset,
  }: {
    environment: Environment;
    names: readonly EnvVarName[];
  }) => `hostctl secrets set -a acme-${environment} ${unset.join(" ")}`,
});

const setUp = (
  toCheck: EnvToCheck | undefined,
  held: Partial<Record<Environment, EnvVarName[]>>,
  { withEnv = true }: { withEnv?: boolean } = {},
) => {
  const hosting = serverHostingFake();
  const world = testContext({
    units: [
      testUnit("api", {
        module: "backend-service",
        options: { service: "acme-api" },
        ...(toCheck ? { checkEnvBeforeDeploy: toCheck } : {}),
      }),
    ],
    modules: [
      backendService({
        serverHosting: withEnv ? { ...hosting, env: () => platform(held) } : hosting,
      }),
    ],
  });
  const report = () =>
    reportEnvToCheck({ release: world.context.release, shell: world.shell, output: world.output });
  return { ...world, report };
};

describe("Feature: doctor checking that the env each app needs is set before deploy", () => {
  it("given no app lists env to check, when doctor runs, then it passes and prints nothing", async () => {
    // given
    const { report, output } = setUp(undefined, {});

    // when / then
    expect(await report()).toBe(true);
    expect(output.lines).toEqual([]);
  });

  it("given every env var set on both environments, when doctor runs, then each environment says how many are set and it passes", async () => {
    // given
    const all = names("SENTRY_DSN", "API_KEY");
    const { report, output } = setUp(new EnvToCheck(all), { staging: all, prod: all });

    // when / then
    expect(await report()).toBe(true);
    expect(output.lines).toEqual([
      "│   Check env before deploy",
      "│  ✓ api on staging: 2 of 2 set",
      "│  ✓ api on prod: 2 of 2 set",
    ]);
  });

  it("given an env var unset on staging only, when doctor runs, then staging names it with the command to set it and doctor fails", async () => {
    // given
    const { report, output } = setUp(new EnvToCheck(names("SENTRY_DSN", "API_KEY")), {
      staging: names("API_KEY"),
      prod: names("SENTRY_DSN", "API_KEY"),
    });

    // when / then
    expect(await report()).toBe(false);
    expect(output.lines).toEqual([
      "│   Check env before deploy",
      "│  ✗ api on staging: 1 unset env vars: SENTRY_DSN",
      "│      you set them: hostctl secrets set -a acme-staging SENTRY_DSN",
      "│  ✓ api on prod: 2 of 2 set",
    ]);
  });

  it("given the platform cannot be read on prod, when doctor runs, then it says why and fails, staging still checked", async () => {
    // given
    const all = names("SENTRY_DSN");
    const { report, output } = setUp(new EnvToCheck(all), { staging: all });

    // when / then
    expect(await report()).toBe(false);
    expect(output.lines).toContain("│  ✓ api on staging: 1 of 1 set");
    expect(output.lines).toContain("│  ✗ api on prod: 401 unauthorized");
  });

  it("given an env var listed for all environments and again for prod, when doctor runs, then it warns about the repeat", async () => {
    // given
    const toCheck = new EnvToCheck({
      all: names("SENTRY_DSN"),
      prod: names("SENTRY_DSN"),
    });
    const all = names("SENTRY_DSN");
    const { report, output } = setUp(toCheck, { staging: all, prod: all });

    // when / then
    expect(await report()).toBe(true);
    expect(output.lines).toContain("│  ! api: SENTRY_DSN is in all and listed again");
  });

  it("given a host that cannot list env vars, when doctor runs, then it says it can't check there and still passes", async () => {
    // given
    const { report, output } = setUp(new EnvToCheck(names("SENTRY_DSN")), {}, { withEnv: false });

    // when / then
    expect(await report()).toBe(true);
    expect(output.lines).toEqual([
      "│   Check env before deploy",
      "│  ! api: can't check env on fake",
    ]);
  });
});
