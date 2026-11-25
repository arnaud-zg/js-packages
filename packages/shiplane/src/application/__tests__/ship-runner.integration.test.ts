import { describe, expect, it } from "vitest";

import { shipTo } from "../ship";
import { shipWorld } from "./shipWorld";

// Shipping on a GitHub Actions runner: every unit goes, each in its own log group, and the run page
// gets the plan and the result. On a laptop the first failure still stops the rest.

const SUMMARY = "/runner/summary.md";

/** api, web and worker tagged, web's deploy failing, the run page named when on a runner. */
const threeUnits = ({
  runner,
  prepare,
  failing = "web",
}: {
  runner: boolean;
  prepare?: string;
  /** The unit whose deploy fails, or none. */
  failing?: string | null;
}) => {
  const world = shipWorld(["api", "web", "worker"], { yes: true, prepare });
  world.context.options.ci = runner;
  world.shell.seedEnv({ GITHUB_STEP_SUMMARY: SUMMARY });
  if (failing) world.shell.seed(`echo deploy acme-${failing}`, { status: 1 });
  return world;
};

const deploys = (calls: readonly { command: string; args: string[] }[]) =>
  calls
    .filter(({ command, args }) => command === "echo" && args[0] === "deploy")
    .map(({ args }) => args[1]);

describe("Feature: shipping every unit on a runner, whatever fails", () => {
  it("given three units on a runner and the second failing, when shipped, then the third still ships, each in its own group, both tables are written and the run fails", async () => {
    // given
    const { context, shell, output, files } = threeUnits({ runner: true });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(false);
    expect(deploys(shell.calls)).toEqual(["acme-api", "acme-web", "acme-worker"]);
    expect(output.lines.filter((line) => line.startsWith("::"))).toEqual([
      "::group::api",
      "::endgroup::",
      "::group::web",
      "::endgroup::",
      "::group::worker",
      "::endgroup::",
    ]);
    expect(output.text).toContain(
      "deploy web@0.1.0 to acme-web (fake) failed: echo exited with 1, the next unit still goes.",
    );
    const summary = files.read(SUMMARY);
    expect(summary).toContain(
      "### Ship to staging\n\n| Unit | Target | Version | Where it stands |\n| --- | --- | --- | --- |\n| api | fake | 0.1.0 |",
    );
    expect(summary?.indexOf("| api |")).toBeLessThan(summary?.indexOf("| worker |") ?? 0);
    expect(summary).toContain(
      [
        "### Result",
        "",
        "| Unit | Prepare | Ship |",
        "| --- | --- | --- |",
        "| api | skipped | success |",
        "| web | skipped | failed |",
        "| worker | skipped | success |",
      ].join("\n"),
    );
    expect(summary?.indexOf("### Ship to staging")).toBeLessThan(
      summary?.indexOf("### Result") ?? 0,
    );
  });

  it("given the second of three units failed on a runner, when shipped again, then only it ships: the two that went are not deployed twice", async () => {
    // given
    const { context, shell } = threeUnits({ runner: true, failing: null });
    shell.seedOnce("echo deploy acme-web", { status: 1 });
    await shipTo(context, "staging", {});
    const before = shell.calls.length;

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(deploys(shell.calls.slice(before))).toEqual(["acme-web"]);
  });

  it("given three units on a runner and none failing, when shipped, then the run passes and every ship says success", async () => {
    // given
    const { context, files } = threeUnits({ runner: true, failing: null });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(true);
    expect(files.read(SUMMARY)).toContain("| web | skipped | success |");
  });

  it("given a runner with no run page, when shipped, then nothing is written yet every unit still goes", async () => {
    // given
    const { context, shell, files } = threeUnits({ runner: true });
    shell.seedEnv({ GITHUB_STEP_SUMMARY: "" });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(false);
    expect(deploys(shell.calls)).toEqual(["acme-api", "acme-web", "acme-worker"]);
    expect(files.changes).toEqual([]);
  });
});

describe("Feature: stopping at the first failure on a laptop", () => {
  it("given three units on a laptop and the second failing, when shipped, then it stops at the second and writes no table", async () => {
    // given
    const { context, shell, output, files } = threeUnits({ runner: false });

    // when
    const ok = await shipTo(context, "staging", { via: "local" });

    // then
    expect(ok).toBe(false);
    expect(deploys(shell.calls)).toEqual(["acme-api", "acme-web"]);
    expect(output.text).toContain(
      "deploy web@0.1.0 to acme-web (fake) failed: echo exited with 1, nothing after it ran.",
    );
    expect(output.lines.some((line) => line.startsWith("::group::"))).toBe(false);
    expect(files.changes).toEqual([]);
  });
});

describe("Feature: preparing each unit before it ships", () => {
  it("given a prepare naming {unit} and {dir}, when shipped from this machine, then it runs from the root before each unit's deploy, filled in", async () => {
    // given
    const { context, shell } = shipWorld(["api", "web"], {
      yes: true,
      prepare: "pnpm --filter {unit} build && ls {dir}",
    });

    // when
    const ok = await shipTo(context, "staging", { via: "local" });

    // then
    expect(ok).toBe(true);
    expect(
      shell.calls
        .filter(({ command }) => command === "sh" || command === "echo")
        .map(({ command, args, cwd }) => [command, args.join(" "), cwd]),
    ).toEqual([
      ["sh", "-c pnpm --filter api build && ls apps/api", "/repo"],
      ["echo", "deploy acme-api api@0.1.0", "/repo"],
      ["sh", "-c pnpm --filter web build && ls apps/web", "/repo"],
      ["echo", "deploy acme-web web@0.1.0", "/repo"],
    ]);
  });

  it("given a prepare, when shipped through the CI pipeline, then this machine prepares nothing", async () => {
    // given
    const { context, shell } = shipWorld(["api"], { yes: true, prepare: "make {unit}" });

    // when
    await shipTo(context, "staging", { via: "ci" });

    // then
    expect(shell.calls.filter(({ command }) => command === "sh")).toEqual([]);
  });

  it("given web's prepare failing on a runner, when shipped, then web is not deployed, worker still is, and the result says so", async () => {
    // given
    const { context, shell, files } = threeUnits({
      runner: true,
      prepare: "make {unit}",
      failing: null,
    });
    shell.seed("sh -c make web", { status: 2 });

    // when
    const ok = await shipTo(context, "staging", {});

    // then
    expect(ok).toBe(false);
    expect(deploys(shell.calls)).toEqual(["acme-api", "acme-worker"]);
    expect(files.read(SUMMARY)).toContain(
      "| api | success | success |\n| web | failed | skipped |\n| worker | success | success |",
    );
  });

  it("given a prepare failing on a laptop, when shipped, then nothing after it runs", async () => {
    // given
    const { context, shell, output } = shipWorld(["api", "web"], {
      yes: true,
      prepare: "make {unit}",
    });
    shell.seed("sh -c make api", { status: 2 });

    // when
    const ok = await shipTo(context, "staging", { via: "local" });

    // then
    expect(ok).toBe(false);
    expect(deploys(shell.calls)).toEqual([]);
    expect(output.text).toContain(
      "prepare api@0.1.0: make api failed: make api exited with 2, nothing after it ran.",
    );
  });
});
