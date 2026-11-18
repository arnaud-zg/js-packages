import { describe, expect, it } from "vitest";

import type { Requirement } from "../../ports/delivery.port";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { RecordingProgress } from "../../adapters/terminal/__fakes__/progress.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { testContext } from "../../testing/releaseContext";
import { rehearse } from "../rehearse";

// A rehearsal in memory: what it says when builds, plans and sign-ins pass or fail.

const SIGNED_IN = {
  label: "fly signed in",
  check: { command: "flyctl", args: ["auth", "whoami"] },
  fix: { command: "flyctl", args: ["auth", "login"] },
};

const fly = (requirements: Requirement[] = [SIGNED_IN]) => ({
  ...detecting(serverHostingFake(), "fly", "fly.toml"),
  requirements: () => requirements,
});

const app = (name: string, scripts: Record<string, string> = { build: "tsc" }) => ({
  [`apps/${name}/package.json`]: JSON.stringify({
    name: `@acme/${name}`,
    version: "1.0.0",
    scripts,
  }),
  [`apps/${name}/shiplane.unit.yml`]: `module: backend-service\nservice: ${name}\n`,
});

const REPO = {
  "shiplane.config.ts": "// composed in memory",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  ...app("api"),
};

describe("Feature: rehearsing a release before anything is pushed", () => {
  it("given two apps with a build script, when the release is rehearsed, then it opens on its heading and one check builds both, each line naming its folder and time", async () => {
    // given
    const { context, output } = memoryRepository({ ...REPO, ...app("web") }, [fly([])]);

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(true);
    expect(output.lines.slice(0, 2)).toEqual([
      "",
      "  Rehearsal  · nothing is pushed, published or deployed",
    ]);
    expect(output.lines).toContain("  ✓ build 2 apps");
    expect(output.lines).toContainEqual(
      expect.stringMatching(/^ {5}✓ apps\/api {10}npm run build {2}\d+\.\ds$/),
    );
    expect(output.lines).toContainEqual(
      expect.stringMatching(/^ {5}✓ apps\/web {10}npm run build {2}\d+\.\ds$/),
    );
  });

  it("given a build that fails, when the release is rehearsed, then its last three lines and how to fix it are shown and the rehearsal fails", async () => {
    // given
    const { context, shell, output } = memoryRepository(REPO, [fly([])]);
    shell.seed("npm run build", {
      status: 2,
      stdout: "one\ntwo\nthree\nfour\n",
      stderr: "",
    });

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("  ✗ build 1 app");
    expect(output.lines).toContainEqual(expect.stringMatching(/^ {5}✗ apps\/api /));
    expect(output.lines).toEqual(
      expect.arrayContaining([
        "         two",
        "         three",
        "         four",
        "         fix the build, or set buildCommand: in apps/api/shiplane.unit.yml",
      ]),
    );
    expect(output.text).not.toContain("         one");
  });

  it("given no app with a build script, when the release is rehearsed, then nothing builds and it passes", async () => {
    // given
    const { context, shell, output } = memoryRepository({ ...REPO, ...app("api", {}) }, [fly([])]);

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(true);
    expect(shell.calls).toEqual([]);
    expect(output.text).not.toContain("build");
  });

  it("given a sign-in that is missing and has no fix, when the release is rehearsed, then it says the sign-in is not available here", async () => {
    // given
    const { context, shell, output } = memoryRepository(REPO, [
      fly([{ label: "token set", check: { command: "printenv", args: ["TOKEN"] } }]),
    ]);
    shell.seed("printenv", { status: 1 });

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("  ✗ token set");
    expect(output.lines).toContain("     not available here");
  });

  it("given every ship plan resolves, when the release is rehearsed without a spinner, then the plan line counts the apps", async () => {
    // given
    const { context, output } = memoryRepository(REPO, [fly([])]);
    context.compose = (release) =>
      testContext({ units: release.units, modules: release.modules }).context;

    // when
    await rehearse(context);

    // then
    expect(output.lines).toContain("  ✓ plan  1 apps, nothing runs");
  });

  it("given a ship plan that cannot resolve, when the release is rehearsed under a spinner, then the failed plan line is followed by the reason", async () => {
    // given
    const { context, output } = memoryRepository(REPO, [fly([])]);
    context.progress = new RecordingProgress(output);
    context.compose = (release) =>
      testContext({
        units: release.units,
        modules: release.modules.map((module) => ({
          ...module,
          ship: () => {
            throw new Error("service is not set for preview");
          },
        })),
      }).context;

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("  ✗ plan  1 apps, nothing runs");
    expect(output.lines).toContain("     service is not set for preview");
  });

  it("given a missing sign-in, when the release is rehearsed under a spinner, then the spinner reports it once and the fix command is shown", async () => {
    // given
    const { context, shell, output } = memoryRepository(REPO, [fly()]);
    context.progress = new RecordingProgress(output);
    shell.seed("flyctl auth whoami", { status: 1 });

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(false);
    expect(output.text).not.toContain("✗ fly signed in");
    expect(output.lines).toContain("     run flyctl auth login, then shiplane setup");
  });

  it("given a config with problems, when the release is rehearsed, then each problem is shown with its line and hint, and nothing builds", async () => {
    // given
    const { context, shell, output } = memoryRepository(REPO, [fly([])]);
    const load = context.load;
    context.load = async () => ({
      ...(await load()),
      problems: [
        {
          file: "shiplane.config.ts",
          line: 3,
          message: "unknown module",
          hint: "add it to modules",
        },
        { file: "apps/api/shiplane.unit.yml", message: "no service" },
      ],
    });

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(false);
    expect(output.lines).toContain("  ✗ shiplane.config.ts:3  unknown module");
    expect(output.lines).toContain("     add it to modules");
    expect(output.lines).toContain("  ✗ apps/api/shiplane.unit.yml  no service");
    expect(shell.calls).toEqual([]);
  });
});

describe("Feature: rehearsing builds with the repository's own package manager", () => {
  it.each([
    [{ "pnpm-lock.yaml": "" }, "pnpm"],
    [{ "yarn.lock": "" }, "yarn"],
    [{ "bun.lock": "" }, "bun"],
    [{ "bun.lockb": "" }, "bun"],
    [{}, "npm"],
  ])(
    "given the lockfile %o, when the release is rehearsed, then the app builds with %s run build in its folder",
    async (lockfile, pm) => {
      // given
      const { context, shell, output } = memoryRepository({ ...REPO, ...lockfile }, [fly([])]);

      // when
      await rehearse(context);

      // then
      expect(shell.calls).toEqual([
        { command: pm, args: ["run", "build"], cwd: "/memory/acme/apps/api", env: undefined },
      ]);
      expect(output.lines).toContainEqual(
        expect.stringContaining(`apps/api          ${pm} run build`),
      );
    },
  );

  it("given an app with no package.json beside one that builds, when the release is rehearsed, then only the one with a build script builds", async () => {
    // given
    const { context, shell, output } = memoryRepository(
      { ...REPO, "apps/worker/shiplane.unit.yml": "module: backend-service\nservice: worker\n" },
      [fly([])],
    );

    // when
    const ok = await rehearse(context);

    // then
    expect(ok).toBe(true);
    expect(output.lines).toContain("  ✓ build 1 app");
    expect(shell.calls.map(({ cwd }) => cwd)).toEqual(["/memory/acme/apps/api"]);
  });
});
