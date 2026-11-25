import { isEnvVarName } from "shiplane/plugin";
import { RecordingShell, TEST_FLOW, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { easMobileDistribution } from "../eas-mobile-distribution.adapter";

const unit = testUnit("expo", { module: "mobile-app", dir: "apps/expo" });
const options = {};
const names = (...list: string[]) => list.filter(isEnvVarName);

const envOf = (shell: RecordingShell) => {
  const env = easMobileDistribution().env;
  if (!env) throw new Error("the EAS adapter lists no env");
  return env({ root: "/repo", shell });
};

describe("the env EAS holds for an app", () => {
  it("given two variables on the staging environment, when listed, then their names come back and run from the app's folder", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas env:list staging", {
      stdout: "EXPO_PUBLIC_API_URL=https://api-staging.example.com\nSENTRY_DSN=*****\n",
    });

    const listed = await envOf(shell).listNames({
      flow: TEST_FLOW,
      unit,
      environment: "staging",
      options,
    });

    expect([...listed]).toEqual(["EXPO_PUBLIC_API_URL", "SENTRY_DSN"]);
    expect(shell.calls[0]).toMatchObject({
      args: ["exec", "eas", "env:list", "staging", "--format", "short"],
      cwd: "/repo/apps/expo",
      env: { APP_VARIANT: "staging" },
    });
  });

  it("given eas is not signed in, when listed, then it fails naming the command and the reason", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas env:list", {
      status: 1,
      stderr: "Not logged in\n",
    });

    await expect(
      envOf(shell).listNames({ flow: TEST_FLOW, unit, environment: "prod", options }),
    ).rejects.toThrow("eas env:list prod: Not logged in");
  });

  it("given two unset names, when the set command is printed, then each is created as a secret on that environment, run from the app's folder", () => {
    const command = envOf(new RecordingShell()).setCommand({
      flow: TEST_FLOW,
      unit,
      environment: "prod",
      options,
      names: names("SENTRY_DSN", "EXPO_PUBLIC_API_URL"),
    });

    expect(command).toBe(
      "cd apps/expo && pnpm exec eas env:create --environment prod --name SENTRY_DSN --value ... --visibility secret && pnpm exec eas env:create --environment prod --name EXPO_PUBLIC_API_URL --value ... --visibility secret",
    );
  });
});
