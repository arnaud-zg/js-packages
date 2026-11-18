import { afterEach, describe, expect, it } from "vitest";

import { addUnit, removeUnit } from "../addUnit";
import { initRepository, WORKSPACE } from "./init-repository";

// shiplane add and shiplane remove over a repository in memory, its folders listed from a temp copy.

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const given = (files: Record<string, string> = WORKSPACE) => {
  const repo = initRepository(files);
  cleanup = repo.remove;
  return repo;
};

/** A config whose modules list is still empty, as written before any app shipped. */
const composingNothing = (repo: ReturnType<typeof given>) => {
  const load = repo.context.load;
  return { ...repo.context, load: async () => ({ ...(await load()), modules: [] }) };
};

const SCHEMA = "node_modules/.cache/shiplane/schema.json";
const CONFIG =
  'import { defineRelease } from "shiplane";\n\nexport default defineRelease({\n  modules: [],\n});\n';

describe("Feature: starting to ship one more app", () => {
  it("given a folder outside the workspace, when the person adds it, then it is refused and nothing is written", async () => {
    const { context, files, output } = given();

    expect(await addUnit(context, "apps/nothing")).toBe(false);

    expect(output.lines).toEqual([
      "✗  apps/nothing is not a workspace folder without a shiplane.unit.yml",
    ]);
    expect(files.changes).toEqual([]);
  });

  it("given an app an adapter is sure of, when the person adds it with a trailing slash, then only the write is confirmed and the config ships it", async () => {
    const repo = given({ ...WORKSPACE, "shiplane.config.ts": CONFIG });
    const { prompter, files, output } = repo;
    prompter.answer(true);

    expect(await addUnit(composingNothing(repo), "apps/api/")).toBe(true);

    expect(prompter.asked).toEqual(["Write apps/api/shiplane.unit.yml?"]);
    expect(files.read("apps/api/shiplane.unit.yml")).toBe(
      [
        "# Written by shiplane init. Every key: shiplane docs backend-service",
        "# Read from fly.toml",
        "",
        "module: backend-service",
        "service: api",
        "",
      ].join("\n"),
    );
    expect(files.read("shiplane.config.ts")).toContain(
      "backendService({ serverHosting: flyServerHosting() })",
    );
    expect(files.read(SCHEMA)).toContain('"backend-service"');
    expect(output.lines.at(-1)).toBe("◇  Wrote apps/api/shiplane.unit.yml");
  });

  it("given no config to add to, when the person adds an app, then they are told which module to add to shiplane.config.ts", async () => {
    const { context, prompter, files, output } = given();
    prompter.answer(true);

    await addUnit(context, "apps/api");

    expect(files.exists("shiplane.config.ts")).toBe(false);
    expect(output.lines).toContain(
      "!  add backendService({ serverHosting: flyServerHosting() }) to the modules in shiplane.config.ts",
    );
    expect(files.read(SCHEMA)).toContain('"backend-service"');
  });

  it("given a config that already ships that kind of app, when the person adds one, then shiplane.config.ts is left as it was", async () => {
    const { context, prompter, files } = given({ ...WORKSPACE, "shiplane.config.ts": CONFIG });
    prompter.answer(true);

    await addUnit(context, "apps/api");

    expect(files.read("shiplane.config.ts")).toBe(CONFIG);
    expect(files.read(SCHEMA)).toContain('"web-app"');
  });

  it("given an app an adapter only thinks likely, when the person adds it, then that adapter is recommended and its options are asked", async () => {
    const { context, prompter, files } = given({ ...WORKSPACE, "shiplane.config.ts": CONFIG });
    prompter.answer("pages", "acme-web", "", true);

    expect(await addUnit(context, "apps/web")).toBe(true);

    expect(prompter.asked).toEqual([
      "How does apps/web ship?",
      "apps/web · Site name?",
      "apps/web · Build command?",
      "Write apps/web/shiplane.unit.yml?",
    ]);
    expect(prompter.initials["How does apps/web ship?"]).toBe("pages");
    expect(prompter.choices["How does apps/web ship?"]).toEqual([
      { value: "docker", label: "docker", hint: "" },
      { value: "fly", label: "fly", hint: "" },
      { value: "pages", label: "pages", hint: "vite.config.ts (recommended)" },
    ]);
    expect(files.read("apps/web/shiplane.unit.yml")).toContain("module: web-app\nsite: acme-web\n");
  });

  it("given the person picks another adapter than the one guessed, when the app is added, then it ships with the adapter they picked", async () => {
    const repo = given({ ...WORKSPACE, "shiplane.config.ts": CONFIG });
    const { prompter, files } = repo;
    prompter.answer("docker", true);

    await addUnit(composingNothing(repo), "apps/web");

    const unit = files.read("apps/web/shiplane.unit.yml") ?? "";
    expect(unit).toContain("module: backend-service\n");
    expect(files.read("shiplane.config.ts")).toContain("dockerServerHosting()");
  });

  it("given an app nothing recognises, when the person picks no adapter, then nothing is recommended and nothing is written", async () => {
    const { context, prompter, files } = given();
    prompter.answer(null);

    expect(await addUnit(context, "apps/tools")).toBe(false);

    expect(prompter.initials["How does apps/tools ship?"]).toBeUndefined();
    expect(prompter.choices["How does apps/tools ship?"]?.map(({ hint }) => hint)).toEqual([
      "",
      "",
      "",
    ]);
    expect(files.changes).toEqual([]);
  });

  it("given the person declines the write, when they add an app, then nothing is written", async () => {
    const { context, prompter, files, output } = given();
    prompter.answer(false);

    expect(await addUnit(context, "apps/api")).toBe(true);

    expect(output.lines.at(-1)).toBe("Nothing written.");
    expect(files.changes).toEqual([]);
  });
});

describe("Feature: stopping shipping an app", () => {
  const SHIPPING = {
    ...WORKSPACE,
    "shiplane.config.ts": CONFIG,
    "apps/api/shiplane.unit.yml": "module: backend-service\nservice: api\n",
  };

  it("given no app by that name, when the person removes it, then it is refused and nothing changes", async () => {
    const { context, output, files } = given(SHIPPING);

    expect(await removeUnit(context, "nothing")).toBe(false);

    expect(output.lines).toEqual(['✗  no unit named "nothing"']);
    expect(files.changes).toEqual([]);
  });

  it("given a shipped app, when the person confirms its removal, then its unit file goes and it stays versioned", async () => {
    const { context, prompter, output, files } = given(SHIPPING);
    prompter.answer(true);

    expect(await removeUnit(context, "api")).toBe(true);

    expect(prompter.asked).toEqual(["Stop shipping api? It stays versioned."]);
    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(false);
    expect(output.lines).toEqual(["◇  Removed apps/api/shiplane.unit.yml"]);
  });

  it("given a shipped app, when the person declines its removal, then its unit file stays", async () => {
    const { context, prompter, files } = given(SHIPPING);
    prompter.answer(false);

    expect(await removeUnit(context, "api")).toBe(true);

    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(true);
  });
});
