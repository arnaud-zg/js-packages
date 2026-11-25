import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ReleaseModule } from "../../modules/module";
import type { Job } from "../../ports/delivery.port";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { internalTool } from "../../modules/internal-tool/internal-tool.module";
import { webApp } from "../../modules/web-app/web-app.module";
import { TEST_FLOW } from "../../testing/flow";
import { testContext, testUnit } from "../../testing/releaseContext";
import {
  afterShipContext,
  checkout,
  commandLine,
  decideContext,
  destination,
  dispatchShip,
  environmentLabel,
  runHere,
  shipPlanOf,
  unitTarget,
  versionFiles,
} from "../targets";

// Jobs run on a Fake shell and a Fake git: no command, worktree or deploy reaches this machine.

const API = testUnit("api", {
  module: "backend-service",
  packageName: "@acme/api",
  options: { service: "api", url: { preview: "https://api.preview", production: "https://api" } },
});
const WEB = testUnit("web", { module: "web-app", options: { site: "web" } });
const TOOL = testUnit("cli", { module: "internal-tool" });

/** The API's module also moves a version file of its own after a tag. */
const api = (): ReleaseModule => ({
  ...backendService({ serverHosting: serverHostingFake() }),
  versionFiles: (unit) => [`${unit.dir}/app.json`],
});

const world = (units = [API, WEB, TOOL]) => {
  const base = testContext({
    units,
    modules: [api(), webApp({ staticHosting: staticHostingFake() }), internalTool()],
  });
  return base;
};

const job = (overrides: Partial<Job> = {}): Job => ({
  label: "deploy",
  local: [{ command: "hostctl", args: ["deploy"] }],
  ...overrides,
});

const lines = (shell: RecordingShell) =>
  shell.calls.map(({ command, args }) => [command, ...args].join(" "));

describe("Feature: seeing the exact command a release runs", () => {
  it("given a command with variables and a secret, when the release shows it, then variables come first and the secret by name only, never its value", () => {
    expect(
      commandLine({
        command: "storectl",
        args: ["update"],
        env: { EXPO_ENV: "preview", CI: "1" },
        secrets: [{ flag: "--env", name: "SENTRY_TOKEN" }],
      }),
    ).toBe("EXPO_ENV=preview CI=1 storectl update --env SENTRY_TOKEN=$SENTRY_TOKEN");
  });

  it("given a bare deploy command, when the release shows it, then it is just the command and its arguments", () => {
    expect(commandLine({ command: "hostctl", args: ["deploy", "-a", "api"] })).toBe(
      "hostctl deploy -a api",
    );
  });
});

describe("Feature: shipping an app from this machine", () => {
  it("given commands in a folder with variables, when the job runs here, then each runs there in order and the deploy is recorded", async () => {
    const { context, shell, host } = world();

    await runHere(
      context,
      job({
        local: [
          { command: "pnpm", args: ["build"], cwd: "apps/api", env: { NODE_ENV: "production" } },
          { command: "hostctl", args: ["deploy"] },
        ],
        record: true,
      }),
      { tag: "api@0.1.0", environment: "preview" },
    );

    expect(shell.calls).toEqual([
      { command: "pnpm", args: ["build"], cwd: "/repo/apps/api", env: { NODE_ENV: "production" } },
      { command: "hostctl", args: ["deploy"], cwd: "/repo", env: undefined },
    ]);
    expect(host.received).toContainEqual({
      type: "record",
      ref: "api@0.1.0",
      environment: "preview",
    });
  });

  it("given a job not asking to be recorded, when it runs here, then no deploy is recorded", async () => {
    const { context, host } = world();

    await runHere(context, job(), { tag: "api@0.1.0", environment: "preview" });

    expect(host.received).toEqual([]);
  });

  it("given a secret that is set, when the job runs, then it is passed with its flag and value", async () => {
    const { context, shell, output } = world();
    shell.seedEnv({ TOKEN: "s3cret" });

    await runHere(
      context,
      job({
        local: [
          { command: "storectl", args: ["build"], secrets: [{ flag: "--env", name: "TOKEN" }] },
        ],
      }),
      { tag: "app@1.0.0", environment: "production" },
    );

    expect(shell.calls[0]?.args).toEqual(["build", "--env", "TOKEN=s3cret"]);
    expect(output.lines).toEqual([]);
  });

  it("given a secret that is not set, when the job runs, then its flag is left out and said", async () => {
    const { context, shell, output } = world();

    await runHere(
      context,
      job({
        local: [
          { command: "storectl", args: ["build"], secrets: [{ flag: "--env", name: "TOKEN" }] },
        ],
      }),
      { tag: "app@1.0.0", environment: "production" },
    );

    expect(shell.calls[0]?.args).toEqual(["build"]);
    expect(output.lines).toEqual(["  ! TOKEN is not set: --env left out"]);
  });

  it("given a command that fails, when the job runs, then it stops there, says the exit status, and still cleans up", async () => {
    const { context, shell, host } = world();
    shell.seed("hostctl deploy", { status: 3 });

    await expect(
      runHere(
        context,
        job({
          local: [
            { command: "hostctl", args: ["deploy"] },
            { command: "hostctl", args: ["scale"] },
          ],
          cleanup: [{ command: "git", args: ["checkout", "app.json"] }],
          record: true,
        }),
        { tag: "api@0.1.0", environment: "preview" },
      ),
    ).rejects.toThrow("hostctl exited with 3");

    expect(lines(shell)).toEqual(["hostctl deploy", "git checkout app.json"]);
    expect(host.received).toEqual([]);
  });
});

describe("Feature: shipping exactly what a tag holds", () => {
  const at = new Date("2026-10-12T09:00:00Z").getTime();
  const dir = path.join(os.tmpdir(), `shiplane-api-0.1.0-${at}`);

  it("given a job from a tag, when it runs here, then a worktree at the tag gets the env files, is installed, runs the job and is removed", async () => {
    const { context, shell, source } = world();
    source.seed({ ignored: [".env", "apps/api/.env.local", "apps/web/.env", "notes.txt"] });

    await runHere(
      context,
      job({
        from: "api@0.1.0",
        local: [{ command: "hostctl", args: ["deploy"], cwd: "apps/api" }],
      }),
      { tag: "api@0.1.0", environment: "preview" },
    );

    expect(source.received).toEqual([
      { type: "worktree-add", dir, ref: "api@0.1.0" },
      { type: "worktree-remove", dir },
    ]);
    expect(shell.calls).toEqual([
      {
        command: "cp",
        args: [path.join("/repo", ".env"), path.join(dir, ".env")],
        cwd: undefined,
        env: undefined,
      },
      {
        command: "cp",
        args: [path.join("/repo", "apps/api/.env.local"), path.join(dir, "apps/api/.env.local")],
        cwd: undefined,
        env: undefined,
      },
      { command: "pnpm", args: ["install", "--frozen-lockfile"], cwd: dir, env: undefined },
      { command: "hostctl", args: ["deploy"], cwd: path.join(dir, "apps/api"), env: undefined },
    ]);
  });

  it("given a job from a tag, when it runs, then Ctrl-C is caught only while it runs and the worktree is still removed", async () => {
    const { context, source } = world();
    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    const during: number[] = [];
    context.shell = Object.assign(new RecordingShell(), {
      attach: () => {
        during.push(process.listenerCount("SIGINT"), process.listenerCount("SIGTERM"));
        return Promise.resolve(0);
      },
    });

    await runHere(context, job({ from: "api@0.1.0" }), {
      tag: "api@0.1.0",
      environment: "preview",
    });

    expect(during.slice(0, 2)).toEqual([
      process.listenerCount("SIGINT") + 1,
      process.listenerCount("SIGTERM") + 1,
    ]);
    expect(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")).toBe(before);
    expect(source.received.at(-1)).toEqual({ type: "worktree-remove", dir });
  });

  it("given an env file that cannot be copied, when the job runs from its tag, then it fails saying why and removes the worktree", async () => {
    const { context, shell, source } = world();
    source.seed({ ignored: [".env"] });
    shell.seed("cp", { status: 1, stderr: "permission denied\n" });

    await expect(
      runHere(context, job({ from: "api@0.1.0" }), { tag: "api@0.1.0", environment: "preview" }),
    ).rejects.toThrow("copying .env failed: permission denied");

    expect(lines(shell)).not.toContain("pnpm install --frozen-lockfile");
    expect(source.received.at(-1)).toEqual({ type: "worktree-remove", dir });
  });

  it("given an install that fails, when the job runs from its tag, then the job never runs", async () => {
    const { context, shell } = world();
    shell.seed("pnpm install", { status: 1 });

    await expect(
      runHere(context, job({ from: "api@0.1.0" }), { tag: "api@0.1.0", environment: "preview" }),
    ).rejects.toThrow("pnpm install exited with 1");

    expect(lines(shell)).toEqual(["pnpm install --frozen-lockfile"]);
  });

  it("given a worktree that cannot be removed, when the job ends, then it says how to remove it by hand", async () => {
    const { context, source, output } = world();
    source.failAt("worktree-remove", 1, new Error("locked"));

    await runHere(context, job({ from: "api@0.1.0" }), {
      tag: "api@0.1.0",
      environment: "preview",
    });

    expect(output.lines).toEqual([
      `  ! could not remove the worktree ${dir}: locked`,
      `    git worktree remove --force ${dir}`,
    ]);
  });
});

describe("Feature: aiming an app at an environment", () => {
  it("given a checkout on a feature branch, when the release aims an app, then it ships the current commit and knows the default branch", async () => {
    const { context, source } = world();
    source.seed({
      position: { branch: "feature", head: "abc123", originMain: "def" },
      defaultBranch: "trunk",
    });

    expect(await checkout(context)).toEqual({ commit: "abc123", defaultBranch: "trunk" });
  });

  it("given an app with per-environment settings, when it is aimed at an environment, then its tag and that environment's settings are given", () => {
    const { context } = world();

    const target = unitTarget(context, {
      unit: { ...API, version: "1.2.0" },
      environment: "production",
      commit: "c1",
      defaultBranch: "main",
    });

    expect(target?.module.name).toBe("backend-service");
    expect(target?.tag).toBe("api@1.2.0");
    expect(target?.input).toEqual({
      unit: { ...API, version: "1.2.0" },
      tag: "api@1.2.0",
      environment: "production",
      commit: "c1",
      defaultBranch: "main",
      flow: TEST_FLOW,
      options: { service: "api", url: "https://api" },
    });
  });

  it("given an app no module ships, when it is aimed, then there is no target", () => {
    const { context } = world();

    expect(
      unitTarget(context, {
        unit: testUnit("ghost", { module: "nowhere" }),
        environment: "preview",
        commit: "c",
        defaultBranch: "main",
      }),
    ).toBeNull();
  });

  it("given an app aimed at preview, when its module plans the ship, then the job deploys its service at that tag", () => {
    const { context } = world();
    const target = unitTarget(context, {
      unit: API,
      environment: "preview",
      commit: "c",
      defaultBranch: "main",
    });

    const plan = target && shipPlanOf(context, target.module, target.input);

    expect(plan?.jobs[0]?.local[0]).toEqual({
      command: "echo",
      args: ["deploy", "api", "api@0.1.0"],
    });
  });

  it("given a module that bumps a version file of its own, when the release checks which files it may change, then only that file is allowed", () => {
    const { context } = world();

    expect(versionFiles(context)).toEqual(new Set(["apps/api/app.json"]));
  });

  it("given apps to ship through CI, when the release dispatches them on a ref, then the ship workflow runs once with every app and the environment", async () => {
    const { context, ci } = world();

    await dispatchShip(context, { ref: "main", units: ["api", "web"] }, "production");

    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: "main",
        inputs: { units: "api web", environment: "production" },
      },
    ]);
  });
});

describe("Feature: shipping an app only when its code changed", () => {
  const seeded = () => {
    const found = world();
    found.versioning.seed({
      dependencies: { "@acme/api": ["@acme/lib"] },
      folders: {
        "@acme/api": "apps/api",
        "@acme/lib": "packages/lib",
        "@acme/web": "apps/web",
      },
    });
    return found;
  };
  const CHANGED = [
    "apps/api/src/index.ts",
    "packages/lib/index.ts",
    "apps/web/index.ts",
    "pnpm-lock.yaml",
    "apps/api/app.json",
    "README.md",
  ];

  it("given changes across the repository, when a module decides whether the API ships, then its code, its library and the lockfile count, and it sees the repository, its clock and its services", async () => {
    const { context, source } = seeded();
    source.seed({ diffs: { "a..b": CHANGED } });

    const decide = decideContext(context);

    expect(await decide.changedCode(API, "a", "b")).toEqual([
      "apps/api/src/index.ts",
      "packages/lib/index.ts",
      "pnpm-lock.yaml",
    ]);
    expect(decide.root).toBe("/repo");
    expect(decide.units).toBe(context.release.units);
    expect(decide.tagFormat).toBe(context.release.tagFormat);
    expect(decide.versionFiles).toEqual(new Set(["apps/api/app.json"]));
    expect(decide.now()).toEqual(new Date("2026-10-12T09:00:00Z"));
    expect(decide.shell).toBe(context.shell);
    expect(decide.sourceControl).toBe(context.services.sourceControl);
    expect(decide.codeHost).toBe(context.services.codeHost);
    expect(decide.ciPipeline).toBe(context.services.ciPipeline);
    expect(decide.open).toBe(context.open);
  });

  it("given commits after the last ship, when the release writes what reached the API, then only the subjects touching it are listed", async () => {
    const { context, source } = seeded();
    source.seed({
      commits: {
        "v1..v2": [
          { subject: "feat: faster api", files: ["apps/api/src/index.ts"] },
          { subject: "docs: web", files: ["apps/web/index.ts", "README.md"] },
          { subject: "fix: lib", files: ["packages/lib/index.ts"] },
        ],
      },
    });

    const after = afterShipContext(context);

    expect(await after.subjectsReaching(API, "v1", "v2")).toEqual(["feat: faster api", "fix: lib"]);
    expect(after.tagFormat).toBe(context.release.tagFormat);
    expect(after.open).toBe(context.open);
  });
});

describe("Feature: reading where a release goes", () => {
  it("given only internal tools, when a preview release is announced, then it reads live", () => {
    const { context } = world();

    expect(environmentLabel(context, ["cli"], "preview")).toBe("live");
    expect(destination(context, ["cli"], "preview")).toBe("live");
  });

  it("given an app that deploys, when a preview release is announced, then it reads preview", () => {
    const { context } = world();

    expect(environmentLabel(context, ["cli", "api"], "preview")).toBe("preview");
    expect(destination(context, ["api"], "preview")).toBe("to preview");
  });

  it("given a production release, when it is announced, then it reads production whatever the apps", () => {
    const { context } = world();

    expect(environmentLabel(context, ["cli"], "production")).toBe("production");
    expect(destination(context, ["cli"], "production")).toBe("to production");
  });

  it("given no app picked, when a preview release is announced, then the whole repository decides how it reads", () => {
    expect(environmentLabel(world([TOOL]).context, [], "preview")).toBe("live");
    expect(environmentLabel(world([TOOL, WEB]).context, [], "preview")).toBe("preview");
    expect(environmentLabel(world([]).context, [], "preview")).toBe("preview");
  });

  it("given an app no module knows, when a preview release is announced, then it reads preview", () => {
    const { context } = world();

    expect(environmentLabel(context, ["ghost"], "preview")).toBe("preview");
  });
});
