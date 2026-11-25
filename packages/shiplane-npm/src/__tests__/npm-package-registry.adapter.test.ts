import { publishedPackage } from "shiplane/plugin";
import { readStatus, shipTo, testContext, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { npmPackageRegistry } from "../npm-package-registry.adapter";

const BUDGET = testUnit("context-budget", {
  dir: "packages/context-budget",
  file: "packages/context-budget/shiplane.unit.yml",
  packageName: "@acme/context-budget",
  version: "0.2.0",
  module: "published-package",
  options: {
    publishAs: "@acme/context-budget",
    tag: { staging: "next", prod: "latest" },
  },
});

const setUp = (unit = BUDGET) => {
  const world = testContext({
    units: [unit],
    modules: [publishedPackage({ packageRegistry: npmPackageRegistry() })],
  });
  world.source.seed({ tags: { "context-budget@0.2.0": "head-1" } });
  return world;
};

const notOnRegistry = { status: 1, stderr: "npm error code E404" };

describe("publishing a package to npm by default", () => {
  const PLAIN = testUnit("context-budget", {
    dir: "packages/context-budget",
    file: "packages/context-budget/shiplane.unit.yml",
    packageName: "context-budget",
    version: "0.2.0",
    module: "published-package",
  });

  it("given a released version npm does not have, when it ships, then it is published straight under latest", async () => {
    const { context, shell, prompter } = setUp(PLAIN);
    shell.seed("npm view context-budget@0.2.0 version", notOnRegistry);
    prompter.answer(true);

    expect(await shipTo(context, "staging", {})).toBe(true);

    expect(shell.calls.at(-1)).toMatchObject({
      command: "pnpm",
      args: ["publish", "--no-git-checks", "--access", "public", "--tag", "latest"],
    });
  });

  it("given the version is already latest on npm, when prod ships, then nothing runs and it says so", async () => {
    const { context, shell, prompter, output } = setUp(PLAIN);
    shell.seed("npm view context-budget@0.2.0 version", { stdout: "0.2.0" });
    shell.seed("npm view context-budget dist-tags", {
      stdout: JSON.stringify({ latest: "0.2.0" }),
    });
    prompter.answer("prod");

    expect(await shipTo(context, "prod", {})).toBe(true);

    expect(shell.calls.map(({ args }) => args[0])).toEqual(["view", "view"]);
    expect(output.text).toContain("on npm under latest");
  });
});

describe("publishing a package to npm under next, then latest", () => {
  it("given a released version npm does not have, when it ships to staging, then it is published under next with its public name, put back after", async () => {
    const { context, shell, prompter } = setUp();
    shell.seed("npm view @acme/context-budget@0.2.0 version", notOnRegistry);
    prompter.answer(true);

    expect(await shipTo(context, "staging", {})).toBe(true);

    expect(shell.calls.slice(1).map(({ command, args }) => [command, ...args].join(" "))).toEqual([
      "npm pkg set name=@acme/context-budget",
      "pnpm publish --no-git-checks --access public --tag next",
      "npm pkg set name=@acme/context-budget",
    ]);
    expect(prompter.asked).not.toContain("How should context-budget@0.2.0 ship to staging?");
  });

  it("given the publish fails, when it ships, then the package name is put back anyway", async () => {
    const { context, shell, prompter } = setUp();
    shell.seed("npm view @acme/context-budget@0.2.0 version", notOnRegistry);
    shell.seed("pnpm publish", { status: 1 });
    prompter.answer(true);

    expect(await shipTo(context, "staging", {})).toBe(false);

    expect(shell.calls.at(-1)?.args).toEqual(["pkg", "set", "name=@acme/context-budget"]);
  });

  it("given the version is published and next points at it, when it ships to staging, then nothing runs", async () => {
    const { context, shell, output } = setUp();
    shell.seed("npm view @acme/context-budget@0.2.0 version", { stdout: "0.2.0" });
    shell.seed("npm view @acme/context-budget dist-tags", {
      stdout: JSON.stringify({ latest: "0.1.0", next: "0.2.0" }),
    });

    await shipTo(context, "staging", {});

    expect(shell.calls.map(({ args }) => args[0])).toEqual(["view", "view"]);
    expect(output.text).toContain("on npm under next");
  });

  it("given staging published it, when prod ships, then latest moves to it without publishing again", async () => {
    const { context, shell, prompter } = setUp();
    shell.seed("npm view @acme/context-budget@0.2.0 version", { stdout: "0.2.0" });
    shell.seed("npm view @acme/context-budget dist-tags", {
      stdout: JSON.stringify({ latest: "0.1.0", next: "0.2.0" }),
    });
    prompter.answer("prod", true);

    await shipTo(context, "prod", {});

    expect(shell.calls.at(-1)).toMatchObject({
      command: "npm",
      args: ["dist-tag", "add", "@acme/context-budget@0.2.0", "latest"],
    });
  });

  it("given npm answers the dist-tags with a warning instead of JSON, when prod ships, then latest is moved to it as if no tag were set", async () => {
    const { context, shell, prompter } = setUp();
    shell.seed("npm view @acme/context-budget@0.2.0 version", { stdout: "0.2.0" });
    shell.seed("npm view @acme/context-budget dist-tags", {
      stdout: "npm warn config prod Use `--omit=dev` instead.\n",
    });
    prompter.answer("prod", true);

    await shipTo(context, "prod", {});

    expect(shell.calls.at(-1)).toMatchObject({
      command: "npm",
      args: ["dist-tag", "add", "@acme/context-budget@0.2.0", "latest"],
    });
  });

  it("given prod and a version npm never got, when it ships, then it says to release it to staging first", async () => {
    const { context, shell, prompter, output } = setUp();
    shell.seed("npm view @acme/context-budget@0.2.0 version", notOnRegistry);
    prompter.answer("prod");

    await shipTo(context, "prod", {});

    expect(shell.calls.some(({ args }) => args[0] === "publish")).toBe(false);
    expect(output.text).toContain("not on npm yet: ship it to staging first");
  });
});

describe("recognising a package to publish", () => {
  it("given a public package with a bin, when init looks at it, then npm is found", () => {
    const detection = npmPackageRegistry().detect?.({
      dir: "packages/context-budget",
      name: "context-budget",
      files: ["package.json"],
      has: () => true,
      read: () =>
        JSON.stringify({ name: "context-budget", bin: { "context-budget": "dist/cli.js" } }),
    });

    expect(detection).toMatchObject({ certainty: "found", reason: "package.json, public, bin" });
  });

  it("given a private package, when init looks at it, then npm does not claim it", () => {
    const detection = npmPackageRegistry().detect?.({
      dir: "packages/ui",
      name: "ui",
      files: ["package.json"],
      has: () => true,
      read: () => JSON.stringify({ name: "@acme/ui", private: true, exports: "./src/index.ts" }),
    });

    expect(detection).toBeNull();
  });
});

describe("where a package stands, read from npm", () => {
  const PUBLISHED = testUnit("agent-context-budget", {
    dir: "packages/agent-context-budget",
    packageName: "agent-context-budget",
    version: "0.1.0",
    module: "published-package",
  });

  const setUpStatus = (distTags: Record<string, string>) => {
    const world = testContext({
      units: [PUBLISHED],
      modules: [publishedPackage({ packageRegistry: npmPackageRegistry() })],
    });
    world.source.seed({ tags: { "agent-context-budget@0.1.0": "t1" } });
    world.shell.seed("npm view agent-context-budget@0.1.0 version", { stdout: "0.1.0" });
    world.shell.seed("npm view agent-context-budget dist-tags", {
      stdout: JSON.stringify(distTags),
    });
    return world;
  };

  it("given the tagged version is latest on npm and no deploy record, when the status is read, then nothing is left to release", async () => {
    const { context } = setUpStatus({ latest: "0.1.0" });

    const status = await readStatus(context, "staging");

    expect(status.units).toEqual([
      expect.objectContaining({ unit: "agent-context-budget", pending: false }),
    ]);
  });

  it("given the tagged version is not on npm, when the status is read, then it is offered to publish", async () => {
    const { context, shell } = setUpStatus({});
    shell.seedOnce("npm view agent-context-budget@0.1.0 version", notOnRegistry);

    const status = await readStatus(context, "staging");

    expect(status.units).toEqual([
      expect.objectContaining({
        unit: "agent-context-budget",
        pending: true,
        hint: "0.1.0 released, not live yet",
      }),
    ]);
  });
});
