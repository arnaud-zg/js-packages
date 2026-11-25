import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import type { Requirement } from "shiplane/plugin";
import { publishedPackage } from "shiplane/plugin";
import { testUnit } from "shiplane/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { npmPackageRegistry } from "../npm-package-registry.adapter";
import { trustRequirement } from "../trusted-publishing";

const asked: { method: string | undefined; url: string | undefined; auth: string | undefined }[] =
  [];
let exchange = 201;
let base = "";
let dir = "";
const server = createServer((request, response) => {
  asked.push({ method: request.method, url: request.url, auth: request.headers.authorization });
  const minting = request.url?.startsWith("/mint");
  response.writeHead(minting ? 200 : exchange, { "content-type": "application/json" });
  response.end(JSON.stringify(minting ? { value: "id-token" } : { token: "npm-token" }));
});

beforeEach(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  dir = mkdtempSync(path.join(os.tmpdir(), "npm-trust-"));
  // An npm with no sign-in, first on PATH.
  writeFileSync(path.join(dir, "npm"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/kit" }));
  asked.length = 0;
  exchange = 201;
  vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", `${base}/mint?v=1`);
  vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "runner-token");
  vi.stubEnv("GITHUB_REPOSITORY", "acme/kit");
  vi.stubEnv("GITHUB_WORKFLOW_REF", "acme/kit/.github/workflows/release.yml@refs/heads/main");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
});

/** The check run for real, as the shell runs it. */
const run = ([requirement]: Requirement[]) =>
  new Promise<{ status: number; printed: string }>((resolve) => {
    const { command, args } = requirement?.check ?? { command: "false", args: [] };
    const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` };
    execFile(command, args, { cwd: dir, env }, (error, stdout, stderr) =>
      resolve({ status: error ? 1 : 0, printed: stdout + stderr }),
    );
  });
const kit = () => trustRequirement({ name: "@acme/kit", dir: "." }, base);

describe("asking npm whether it trusts the workflow", () => {
  it("given npm trusts it, when checked, then it passes and prints no token", async () => {
    expect(await run(kit())).toEqual({ status: 0, printed: "" });
    expect(asked).toEqual([
      {
        method: "GET",
        url: "/mint?v=1&audience=npm%3Aregistry.npmjs.org",
        auth: "Bearer runner-token",
      },
      {
        method: "POST",
        url: "/-/npm/v1/oidc/token/exchange/package/@acme%2fkit",
        auth: "Bearer id-token",
      },
    ]);
  });

  it.each([400, 401, 403, 404])(
    "given npm answers %d, when checked, then it fails",
    async (code) => {
      exchange = code;
      expect((await run(kit())).status).toBe(1);
    },
  );

  it.each([429, 500, 503])(
    "given npm cannot say (%d), when checked, then it passes",
    async (code) => {
      exchange = code;
      expect((await run(kit())).status).toBe(0);
    },
  );

  it("given an npm token signs in instead, when npm refuses, then it passes", async () => {
    exchange = 404;
    writeFileSync(path.join(dir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect((await run(kit())).status).toBe(0);
  });

  it("given a package of another registry, when checked, then npm is not asked", async () => {
    exchange = 404;
    const publishConfig = { registry: "https://npm.pkg.github.com" };
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ publishConfig }));
    expect((await run(kit())).status).toBe(0);
    expect(asked).toEqual([]);
  });
});

describe("saying how to make npm trust the workflow", () => {
  const module = () => publishedPackage({ packageRegistry: npmPackageRegistry() });
  const needs = (options = {}) =>
    module().requirements?.([
      testUnit("kit", { packageName: "@acme/kit", module: "published-package", options }),
    ]) ?? [];

  it("given a runner, when the requirements are read, then the fix names the package, this workflow and repository", () => {
    const trust = needs().find(({ help }) => help);
    expect(trust?.label).toBe("npm trust for @acme/kit");
    expect(trust?.help).toContain("npm does not let release.yml of acme/kit publish");
    expect(trust?.fix?.args.join(" ")).toBe(
      "--yes npm@^11.21.0 trust github @acme/kit --file release.yml --repo acme/kit --allow-publish --allow-stage-publish --yes",
    );
  });

  it("given a package published under another name, when the requirements are read, then that name is asked", () => {
    expect(needs({ publishAs: "kit-pub" }).map(({ label }) => label)).toContain(
      "npm trust for kit-pub",
    );
  });

  it("given no OIDC, as on a laptop, when the requirements are read, then npm alone is needed", () => {
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", undefined);
    expect(needs().map(({ label }) => label)).toEqual(["npm"]);
  });
});
