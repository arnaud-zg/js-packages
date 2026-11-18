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

const repository = (toml?: string, file = "fly-preview.toml") => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fly-env-"));
  if (toml !== undefined) {
    fs.mkdirSync(path.join(root, "apps/api"), { recursive: true });
    fs.writeFileSync(path.join(root, "apps/api", file), toml);
  }
  return root;
};

const noSecrets = () =>
  new RecordingShell().seed("flyctl secrets list -a acme-api-preview --json", { stdout: "[]" });

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

  it("given an [env] block between other sections, when listed, then only its own keys are names, commented or bracketed values included", async () => {
    const at = repository(
      [
        'app = "acme-api-preview"',
        "[env]",
        '  NODE_ENV = "production"',
        '  PORT="3000"',
        '  # LEGACY_FLAG = "1"',
        '  LOG_FORMAT = "[json]"',
        '  REGION = "fra"',
        "  [processes]",
        '  WEB = "node server.js"',
        "[http_service]",
        '  HTTP_ONLY = "1"',
        "",
      ].join("\n"),
    );

    const listed = await envOf(noSecrets(), at).listNames({
      unit,
      environment: "preview",
      options,
    });

    expect([...listed]).toEqual(["NODE_ENV", "PORT", "LOG_FORMAT", "REGION"]);
  });

  it("given the [env] block is the toml's last, when listed, then its last key is a name too", async () => {
    const at = repository(
      'app = "acme-api-preview"\n\n[env]  \n  NODE_ENV = "production"\n  REGION = "fra"',
    );

    const listed = await envOf(noSecrets(), at).listNames({
      unit,
      environment: "preview",
      options,
    });

    expect([...listed]).toEqual(["NODE_ENV", "REGION"]);
  });

  it("given a unit with no config set, when listed, then the [env] keys come from its fly.toml", async () => {
    const at = repository(
      'app = "acme-api-preview"\n[env]\n  NODE_ENV = "production"\n',
      "fly.toml",
    );

    const listed = await envOf(noSecrets(), at).listNames({
      unit,
      environment: "preview",
      options: { app: "acme-api-preview" },
    });

    expect([...listed]).toEqual(["NODE_ENV"]);
  });

  it("given a secret whose name is no variable name, when listed, then it is left out", async () => {
    const shell = new RecordingShell().seed("flyctl secrets list -a acme-api-preview --json", {
      stdout: JSON.stringify([{ name: "SENTRY_DSN" }, { name: "legacy-token" }]),
    });

    const listed = await envOf(shell, repository()).listNames({
      unit,
      environment: "preview",
      options,
    });

    expect([...listed]).toEqual(["SENTRY_DSN"]);
  });

  it("given flyctl wraps its JSON in notices that hold brackets, when listed, then the secrets still come back as names", async () => {
    const shell = new RecordingShell().seed("flyctl secrets list -a acme-api-preview --json", {
      stdout: `Notice [beta]: secrets are now staged\n${JSON.stringify([{ name: "SENTRY_DSN" }])}\nDone in 1s\n`,
    });

    const listed = await envOf(shell, repository()).listNames({
      unit,
      environment: "preview",
      options,
    });

    expect([...listed]).toEqual(["SENTRY_DSN"]);
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
