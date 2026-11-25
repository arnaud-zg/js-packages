import { isEnvVarName } from "shiplane/plugin";
import { RecordingShell, TEST_FLOW, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { cloudflarePagesStaticHosting } from "../cloudflare-pages-static-hosting.adapter";

const unit = testUnit("admin", { module: "web-app", dir: "apps/admin" });
const names = (...list: string[]) => list.filter(isEnvVarName);

const options = {
  project: "acme-admin",
  secretsIn: "theirs",
  build: { env: { VITE_API_URL: "https://api-staging.example.com" } },
};

const envOf = (shell: RecordingShell) => {
  const env = cloudflarePagesStaticHosting().env;
  if (!env) throw new Error("the Pages adapter lists no env");
  return env({ root: "/repo", shell });
};

describe("the env Cloudflare Pages holds for a site", () => {
  it("given a secret on the staging environment and a build variable in the unit file, when listed, then both are names", async () => {
    const shell = new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
      stdout:
        'The "staging" environment of your Pages project "acme-admin" has access to the following secrets:\n  - TURNSTILE_SECRET: Value Encrypted\n',
    });

    const listed = await envOf(shell).listNames({
      flow: TEST_FLOW,
      unit,
      environment: "staging",
      options,
    });

    expect([...listed]).toEqual(["TURNSTILE_SECRET", "VITE_API_URL"]);
    expect(shell.calls[0]?.args).toEqual([
      "--yes",
      "wrangler@4.141.0",
      "pages",
      "secret",
      "list",
      "--project-name",
      "acme-admin",
      "--env",
      "theirs",
    ]);
  });

  it("given wrangler is not signed in, when listed, then it fails naming the command and the reason", async () => {
    const shell = new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
      status: 1,
      stderr: "\n✘ [ERROR] You are not logged in\n",
    });

    await expect(
      envOf(shell).listNames({ flow: TEST_FLOW, unit, environment: "prod", options }),
    ).rejects.toThrow("wrangler pages secret list --env theirs: ✘ [ERROR] You are not logged in");
  });

  it("given an unset name, when the set command is printed, then wrangler puts it on that environment of the project", () => {
    const command = envOf(new RecordingShell()).setCommand({
      flow: TEST_FLOW,
      unit,
      environment: "prod",
      options,
      names: names("TURNSTILE_SECRET"),
    });

    expect(command).toBe(
      "npx --yes wrangler@4.141.0 pages secret put TURNSTILE_SECRET --project-name acme-admin --env theirs",
    );
  });

  it("given two secrets not set yet, when shiplane prints how to set them, then one command puts each with wrangler in turn, stopping at the first that fails", () => {
    const command = envOf(new RecordingShell()).setCommand({
      flow: TEST_FLOW,
      unit,
      environment: "staging",
      options,
      names: names("TURNSTILE_SECRET", "STRIPE_KEY"),
    });

    expect(command).toBe(
      "npx --yes wrangler@4.141.0 pages secret put TURNSTILE_SECRET --project-name acme-admin --env theirs && npx --yes wrangler@4.141.0 pages secret put STRIPE_KEY --project-name acme-admin --env theirs",
    );
  });

  it("given wrangler's listing carries a note beside widely spaced secrets, when shiplane checks which variables a site has, then it counts only the secrets", async () => {
    const shell = new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
      stdout: "Note - NOT_A_SECRET: read the docs\n  -   TURNSTILE_SECRET: Value Encrypted\n",
    });

    const listed = await envOf(shell).listNames({
      flow: TEST_FLOW,
      unit,
      environment: "staging",
      options: { project: "acme-admin", secretsIn: "theirs" },
    });

    expect([...listed]).toEqual(["TURNSTILE_SECRET"]);
  });

  it("given the unit file gives the build a key that is not a variable name, when shiplane checks which variables a site has, then that key is not counted", async () => {
    const shell = new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
      stdout: "",
    });

    const listed = await envOf(shell).listNames({
      flow: TEST_FLOW,
      unit,
      environment: "staging",
      options: {
        project: "acme-admin",
        secretsIn: "theirs",
        build: { env: { "not-a-name": "x", API_URL: "y" } },
      },
    });

    expect([...listed]).toEqual(["API_URL"]);
  });

  it("given wrangler fails without saying why, when shiplane checks which variables a site has, then the error names its exit status", async () => {
    const shell = new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
      status: 2,
      stderr: "",
    });

    await expect(
      envOf(shell).listNames({ flow: TEST_FLOW, unit, environment: "staging", options }),
    ).rejects.toThrow("wrangler pages secret list --env theirs: exit 2");
  });

  it("given a unit file that does not say where Cloudflare holds its secrets, when listed, then it fails saying what to set", async () => {
    await expect(
      envOf(new RecordingShell()).listNames({
        flow: TEST_FLOW,
        unit,
        environment: "staging",
        options: { project: "acme-admin" },
      }),
    ).rejects.toThrow("set secretsIn in the unit file");
  });
});
