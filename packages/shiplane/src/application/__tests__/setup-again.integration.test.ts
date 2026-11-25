import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { setup } from "../setup";
import { SCHEMA_FILE } from "../setupFiles";

// Setup run on a repository it already set up, in memory: nothing on this machine is touched.

const cloud = () =>
  detecting(serverHostingFake(), "cloud", "cloud.toml", (folder) => ({ service: folder.name }));
const pages = () =>
  detecting(staticHostingFake(), "pages", "pages.toml", (folder) => ({ site: folder.name }));

const manifest = (name: string, scripts: Record<string, string> = { build: "tsc" }) =>
  JSON.stringify({ name, version: "0.1.0", scripts });

const PROVEN = {
  "package.json": JSON.stringify({ name: "acme", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  ".github/workflows/ci.yml": "on: push\n",
  ".changeset/config.json": "{}\n",
  "apps/api/package.json": manifest("@acme/api"),
  "apps/api/cloud.toml": 'app = "acme-api"\n',
};

/** The files without these ones. */
const without = (files: Record<string, string>, ...dropped: string[]) =>
  Object.fromEntries(Object.entries(files).filter(([file]) => !dropped.includes(file)));

/** A repository set up once, with only the API. */
const setUpOnce = async (files: Record<string, string> = PROVEN) => {
  const repo = memoryRepository(files, [cloud(), pages()]);
  repo.shell.seed("git remote get-url origin", { stdout: "git@github.com:acme/mono.git\n" });
  repo.prompter.answer(true, true);
  await setup(repo.context, { yes: false });
  repo.output.lines.length = 0;
  return repo;
};

const wrote = (changes: { kind: string; file: string }[], file: string) =>
  changes.some((change) => change.kind === "write" && change.file === file);

describe("Feature: running setup again", () => {
  it("given a config already there, when setup runs again, then the flow is not asked and the apps are kept", async () => {
    const { context, prompter, output } = await setUpOnce();
    const asked = prompter.asked.length;

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked).toHaveLength(asked);
    expect(output.lines.slice(0, 6)).toEqual([
      "",
      "  shiplane setup  acme",
      "",
      "  ✓ flow  shiplane.config.ts",
      "  ✓ 1 apps  unchanged, your edits kept",
      "",
    ]);
    expect(output.lines.at(-1)).toBe("  ✓ all set");
  });

  it("given a new app shipped by a new custom module, when setup runs again, then the module is added to the config and the editor schema is refreshed", async () => {
    const { context, prompter, output, files } = await setUpOnce();
    files.write("apps/bot/package.json", manifest("@acme/bot"));
    files.remove(SCHEMA_FILE);
    prompter.answer("server-hosting", "custom", "botDelivery", true);

    expect(await setup(context, { yes: false })).toBe(true);

    const config = files.read("shiplane.config.ts") ?? "";
    expect(config).toContain(
      [
        "    backendService({ serverHosting: cloudServerHosting() }),",
        '    backendService({ name: "bot-delivery", serverHosting: botDelivery() }),',
      ].join("\n"),
    );
    expect(config).toContain('import { botDelivery } from "./shiplane/adapters/bot-delivery";');
    expect(output.lines).toContain("  ~ shiplane.config.ts");
    expect(output.lines).toContain("  + apps/bot/shiplane.unit.yml");
    expect(files.exists(SCHEMA_FILE)).toBe(true);
  });

  it("given a new app of a kind already there, when setup runs again, then the config and the schema are left as they are", async () => {
    const { context, prompter, output, files } = await setUpOnce();
    const config = files.read("shiplane.config.ts");
    files.write("apps/worker/package.json", manifest("@acme/worker"));
    files.write("apps/worker/cloud.toml", "");
    const before = files.changes.length;
    prompter.answer(true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("shiplane.config.ts")).toBe(config);
    const changes = files.changes.slice(before);
    expect(wrote(changes, SCHEMA_FILE)).toBe(false);
    expect(wrote(changes, "shiplane.config.ts")).toBe(false);
    expect(output.lines).not.toContain("  ~ shiplane.config.ts");
  });

  it("given a config with no apps yet, when setup runs again, then it asks where the apps are", async () => {
    const { context, prompter, files } = await setUpOnce();
    files.remove("apps/api/shiplane.unit.yml");
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked.at(-2)).toBe("Your apps and packages are in apps/* (1 folders)?");
    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(true);
  });

  it("given a config with no apps, when the person cancels where they are, then nothing is written", async () => {
    const { context, prompter, output, files } = await setUpOnce();
    files.remove("apps/api/shiplane.unit.yml");
    files.write("pnpm-workspace.yaml", "packages:\n  - services/*\n");
    const before = files.changes.length;
    prompter.answer(null);

    expect(await setup(context, { yes: false })).toBe(false);

    expect(output.lines.at(-1)).toBe("  Nothing written.");
    expect(files.changes).toHaveLength(before);
  });

  it("given a config that versions from commits, when a new app is added, then setup says to merge a commit", async () => {
    const { context, prompter, output, files } = await setUpOnce();
    const load = context.load;
    context.load = async () => {
      const release = await load();
      return {
        ...release,
        flow: { ...release.flow, versioning: { ...release.flow.versioning, name: "commits" } },
      };
    };
    files.write("apps/worker/package.json", manifest("@acme/worker"));
    files.write("apps/worker/cloud.toml", "");
    prompter.answer(true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(output.lines.at(-1)).toBe("  ✓ Ready. Merge a commit, and run shiplane");
  });

  it("given a config that does not load, when setup runs again, then each problem is shown with its hint and nothing is written", async () => {
    const { context, output, files } = await setUpOnce();
    const load = context.load;
    context.load = async () => ({
      ...(await load()),
      problems: [
        { file: "shiplane.config.ts", message: "cannot find module", hint: "pnpm install" },
        { file: "apps/api/shiplane.unit.yml", line: 2, message: "unknown key" },
      ],
    });
    const before = files.changes.length;

    expect(await setup(context, { yes: false })).toBe(false);

    expect(output.lines.slice(3)).toEqual([
      "  ✗ shiplane.config.ts  cannot find module",
      "     pnpm install",
      "  ✗ apps/api/shiplane.unit.yml:2  unknown key",
      "  Fix these, then run shiplane setup again. Nothing written.",
    ]);
    expect(files.changes).toHaveLength(before);
  });

  it("given a failing build on a new app, when setup runs again, then it puts the files back and says to fix it", async () => {
    const { context, prompter, output, files, shell } = await setUpOnce();
    files.write("apps/web/package.json", manifest("@acme/web"));
    files.write("apps/web/pages.toml", "");
    const config = files.read("shiplane.config.ts");
    shell.seed("npm run build", { status: 1, stderr: "boom" });
    const asked = prompter.asked.length;

    expect(await setup(context, { yes: false })).toBe(false);

    expect(prompter.asked).toHaveLength(asked);
    expect(output.lines.at(-1)).toBe("  Fix it, then run shiplane setup again. Nothing written.");
    expect(files.read("shiplane.config.ts")).toBe(config);
    expect(files.exists("apps/web/shiplane.unit.yml")).toBe(false);
  });

  it("given a passing rehearsal, when the person says no, then it only says nothing was written", async () => {
    const { context, prompter, output } = await setUpOnce();
    context.files.write("apps/web/package.json", manifest("@acme/web"));
    context.files.write("apps/web/pages.toml", "");
    prompter.answer(false);

    expect(await setup(context, { yes: false })).toBe(false);

    expect(output.lines.at(-1)).toBe("  Nothing written.");
  });

  it("given every app skipped as an internal tool, when setup runs, then no editor schema is written", async () => {
    const unclear = without(PROVEN, "apps/api/cloud.toml");
    const repo = memoryRepository(unclear, []);
    repo.shell.seed("git remote get-url origin", { stdout: "git@github.com:acme/mono.git\n" });
    repo.prompter.answer(true, "skip", true);

    expect(await setup(repo.context, { yes: false })).toBe(true);

    expect(repo.files.exists(SCHEMA_FILE)).toBe(false);
    expect(repo.files.read("shiplane.config.ts")).toContain("  modules: [\n  ],");
  });
});
