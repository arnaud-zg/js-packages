import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isEnvVarName } from "shiplane/plugin";
import { RecordingShell, testUnit } from "shiplane/testing";
import { afterEach, describe, expect, it } from "vitest";

import { flyServerHosting } from "../fly-server-hosting.adapter";

const unit = testUnit("api", { module: "backend-service", dir: "apps/api" });
const options = { app: "acme-api-preview", config: "fly-preview.toml" };
const names = (...list: string[]) => list.filter(isEnvVarName);

let root: string | undefined;
afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));

const repository = (toml?: string) => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fly-env-"));
  if (toml !== undefined) {
    fs.mkdirSync(path.join(root, "apps/api"), { recursive: true });
    fs.writeFileSync(path.join(root, "apps/api/fly-preview.toml"), toml);
  }
  return root;
};

const envOf = (shell: RecordingShell, at: string) => {
  const env = flyServerHosting().env;
  if (!env) throw new Error("the Fly adapter lists no env");
  return env({ root: at, shell });
};

describe("the env Fly holds for an app", () => {
  it("given two secrets on the app and a toml [env] block, when listed, then both secrets and the toml keys are names", async () => {
    const shell = new RecordingShell().seed("flyctl secrets list -a acme-api-preview --json", {
      stdout: JSON.stringify([{ name: "SENTRY_DSN" }, { Name: "CLOUDFLARE_R2_BUCKET_NAME" }]),
    });
    const at = repository(
      'app = "acme-api-preview"\n\n[env]\n  NODE_ENV = "production"\n\n[http_service]\n  internal_port = 3000\n',
    );

    const listed = await envOf(shell, at).listNames({ unit, environment: "preview", options });

    expect([...listed]).toEqual(["SENTRY_DSN", "CLOUDFLARE_R2_BUCKET_NAME", "NODE_ENV"]);
  });

  it("given flyctl prints a notice before its JSON, when listed, then the secrets still come back as names", async () => {
    const shell = new RecordingShell().seed("flyctl secrets list -a acme-api-preview --json", {
      stdout: `A new release of flyctl is available: v0.3.1 -> v0.3.2\n${JSON.stringify([{ name: "SENTRY_DSN" }])}\n`,
    });

    const listed = await envOf(shell, repository()).listNames({
      unit,
      environment: "preview",
      options,
    });

    expect([...listed]).toEqual(["SENTRY_DSN"]);
  });

  it("given flyctl answers with no JSON at all, when listed, then it fails naming the command", async () => {
    const shell = new RecordingShell().seed("flyctl secrets list", {
      stdout: "Upgrade flyctl to list secrets as JSON\n",
    });

    await expect(
      envOf(shell, repository()).listNames({ unit, environment: "preview", options }),
    ).rejects.toThrow("flyctl secrets list -a acme-api-preview: no secrets list in its output");
  });

  it("given flyctl is not signed in, when listed, then it fails naming the command and Fly's reason", async () => {
    const shell = new RecordingShell().seed("flyctl secrets list", {
      status: 1,
      stderr: "Error: no access token available. Please login with 'flyctl auth login'\n",
    });

    await expect(
      envOf(shell, repository()).listNames({ unit, environment: "preview", options }),
    ).rejects.toThrow("flyctl secrets list -a acme-api-preview: Error: no access token available");
  });

  it("given two unset names, when the set command is printed, then it stages them on the app with no value", () => {
    const command = envOf(new RecordingShell(), "/repo").setCommand({
      unit,
      environment: "preview",
      options,
      names: names("SENTRY_DSN", "WAITLIST_CONFIRM_URL"),
    });

    expect(command).toBe(
      "flyctl secrets set --stage -a acme-api-preview SENTRY_DSN=... WAITLIST_CONFIRM_URL=...",
    );
  });
});
