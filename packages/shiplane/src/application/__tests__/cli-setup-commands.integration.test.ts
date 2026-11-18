import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { RecordingProgress } from "../../adapters/terminal/__fakes__/progress.fake";
import { runCli } from "../../cli/main";
import { detecting, memoryRepository } from "../../testing/memoryRepository";

// Setting up and changing what shiplane ships, as a person types it, on a repository in memory:
// files, shell and person are Fakes, so nothing on this machine is read or written.

const REPO = {
  "package.json": JSON.stringify({ name: "acme", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  ".github/workflows/ci.yml": "on: push\n",
  ".changeset/config.json": "{}\n",
  "apps/api/package.json": JSON.stringify({ name: "@acme/api", version: "0.1.0" }),
  "apps/api/fly.toml": "",
};

const CONFIGURED = {
  ...REPO,
  "shiplane.config.ts": "export default defineRelease({ modules: [backendService()] });\n",
  "apps/api/shiplane.unit.yml": "module: backend-service\nservice: api\n",
};

let printed: string[] = [];
beforeEach(() => {
  printed = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    printed.push(stripVTControlCharacters(String(chunk)));
    return true;
  });
});
afterEach(() => vi.restoreAllMocks());

const stdout = () => printed.join("");

const given = (files: Record<string, string> = REPO) => {
  const repo = memoryRepository(files, [
    detecting(serverHostingFake(), "fly", "fly.toml", (folder) => ({ service: folder.name })),
  ]);
  repo.shell.seed("git remote get-url origin", { stdout: "https://github.com/acme/mono\n" });
  const run = (...argv: string[]) =>
    runCli(argv, repo.context.root, {
      setup: { ...repo.context, progress: new RecordingProgress(repo.output) },
    });
  return { ...repo, run };
};

describe("Feature: setting up shiplane and changing what it ships from the command line", () => {
  it("given a repository with no config, when the person runs status, then shiplane reports the missing config and writes nothing", async () => {
    const { run, files } = given();

    expect(await run("status")).toBe(2);

    expect(stdout()).toContain("No shiplane.config.ts in this repository");
    expect(files.exists("shiplane.config.ts")).toBe(false);
  });

  it("given a config never written to disk, when the person types shiplane, then setup does not start over and no file changes", async () => {
    const { run, files } = given(CONFIGURED);
    const before = files.all;

    expect(await run()).toBe(2);

    expect(stdout()).toContain("No shiplane.config.ts in this repository");
    expect(files.all).toEqual(before);
  });

  it("given a person still typing shiplane init --yes, when it runs, then they are told init is now setup and the repository is set up without a question", async () => {
    const { run, prompter, output } = given();

    expect(await run("init", "--yes")).toBe(0);

    expect(stdout()).toContain("init is now shiplane setup");
    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("Ready.");
  });

  it("given a person asking for a blank config, when they run init --blank, then the config is written with no notice that init moved", async () => {
    const { run, files } = given();

    expect(await run("init", "--blank", "--yes")).toBe(0);

    expect(stdout()).not.toContain("init is now shiplane setup");
    expect(files.exists("shiplane.config.ts")).toBe(true);
  });

  it("given a configured repository, when the person removes an app and confirms, then its unit file is deleted and it stays versioned", async () => {
    const { run, prompter, files } = given(CONFIGURED);
    prompter.answer(true);

    expect(await run("remove", "api")).toBe(0);

    expect(prompter.asked).toEqual(["Stop shipping api? It stays versioned."]);
    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(false);
  });

  it.each([
    ["no unit", [], ""],
    ["a unit that does not exist", ["ghost"], "ghost"],
  ])(
    "given a configured repository, when the person removes %s, then shiplane names what it could not find and fails",
    async (_, args, name) => {
      const { run, output, files } = given(CONFIGURED);

      expect(await run("remove", ...args)).toBe(1);

      expect(output.text).toContain(`no unit named "${name}"`);
      expect(files.exists("apps/api/shiplane.unit.yml")).toBe(true);
    },
  );

  it.each([
    ["a subcommand other than new", ["list"]],
    ["no name for the new adapter", ["new"]],
  ])(
    "given a person scaffolding an adapter, when they give %s, then shiplane shows the usage and fails",
    async (_, args) => {
      const { run } = given(CONFIGURED);

      expect(await run("adapter", ...args)).toBe(1);

      expect(stdout()).toContain("✗  shiplane adapter new <name>");
    },
  );

  it("given a person writing their own provider, when they run adapter new my-host, then its adapter file is scaffolded", async () => {
    const { run, files } = given(CONFIGURED);

    await run("adapter", "new", "my-host");

    expect(stdout()).not.toContain("shiplane adapter new <name>");
    expect(files.exists("release/adapters/my-host.ts")).toBe(true);
  });

  it("given a provider the config uses, when the person asks for its docs, then its unit file keys are listed", async () => {
    const { run, output } = given(CONFIGURED);

    expect(await run("docs", "fly")).toBe(0);

    expect(output.text).toContain("service");
  });

  it("given a name the config does not use, when the person asks for its docs, then shiplane says so and fails", async () => {
    const { run, output } = given(CONFIGURED);

    expect(await run("docs", "nothing")).toBe(1);

    expect(output.text).toContain('no module or adapter "nothing"');
  });

  it("given a configured repository, when the person runs doctor, then the repository's checks are shown", async () => {
    const { run, output } = given(CONFIGURED);

    await run("doctor");

    expect(output.text).toContain("shiplane doctor");
  });
});
