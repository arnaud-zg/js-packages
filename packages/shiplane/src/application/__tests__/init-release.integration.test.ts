import { afterEach, describe, expect, it } from "vitest";

import { initRelease } from "../initRelease";
import { initRepository, manifest, WORKSPACE } from "./init-repository";

// shiplane init --blank and the questions setup shares with it, run over a repository in memory
// whose folders are listed from a temp copy. Nothing outside that temp folder is touched.

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const given = (files: Record<string, string> = WORKSPACE, options?: { interactive?: boolean }) => {
  const repo = initRepository(files, options);
  cleanup = repo.remove;
  return repo;
};

const SCHEMA = "node_modules/.cache/shiplane/schema.json";

describe("Feature: setting up a monorepo for release in one go", () => {
  it("given apps an adapter recognises, when the person runs init with --yes, then each app gets a unit file from its strongest guess without a question", async () => {
    const { context, prompter, files, output } = given();

    const done = await initRelease(context, { yes: true, blank: false });

    expect(done).toBe(true);
    expect(prompter.asked).toEqual([]);
    expect(files.read("apps/api/shiplane.unit.yml")).toBe(
      [
        "# yaml-language-server: $schema=../../node_modules/.cache/shiplane/schema.json",
        "# Written by shiplane init. Every key: shiplane docs backend-service",
        "# Read from cloud.toml",
        "",
        "module: backend-service",
        "service: api",
        "",
      ].join("\n"),
    );
    expect(files.read("apps/web/shiplane.unit.yml")).toContain("module: web-app\nsite: web\n");
    expect(files.read("apps/web/shiplane.unit.yml")).toContain("# Read from vite.config.ts");
    expect(files.read("apps/web/shiplane.unit.yml")).not.toContain("build");
    expect(output.lines).toContain("◇  Wrote 4 files");
    expect(output.lines).toContain("◆  Write these files?");
    expect(output.lines).toContain("│  + shiplane.config.ts");
    expect(output.lines).toContain("│  + apps/api/shiplane.unit.yml");
    expect(output.lines).toContain(`│  + ${SCHEMA}`);
  });

  it("given a fresh repository, when the person runs init with --yes, then shiplane.config.ts ships each app with its adapter and the schema knows each module", async () => {
    const { context, files } = given();

    await initRelease(context, { yes: true, blank: false });

    const config = files.read("shiplane.config.ts") ?? "";
    expect(config).toContain('import { cloudServerHosting } from "@shiplane/cloud";');
    expect(config).toContain('import { pagesStaticHosting } from "@shiplane/pages";');
    expect(config).toContain("backendService({ serverHosting: cloudServerHosting() })");
    expect(config).toContain("webApp({ staticHosting: pagesStaticHosting() })");
    expect(files.read(SCHEMA)).toContain('"backend-service"');
    expect(files.read(SCHEMA)).toContain('"web-app"');
  });

  it("given a workspace, when the person runs init, then each app shows how it would ship and the apps nothing ships are counted", async () => {
    const { context, output } = given();

    await initRelease(context, { yes: true, blank: false });

    expect(output.lines.slice(0, 4)).toEqual([
      "┌  shiplane init",
      "│",
      "◇  Workspace  apps/*",
      "│",
    ]);
    expect(output.lines).toContain(`│  ${"apps/api".padEnd(16)}${"cloud".padEnd(18)}cloud.toml`);
    expect(output.lines).toContain(`│  ${"apps/web".padEnd(16)}${"?".padEnd(18)}vite.config.ts`);
    expect(output.lines).toContain(
      "│  ◻ 1 folder with nothing to ship them, versioned only (shiplane add <folder> ships one)",
    );
    expect(output.text).not.toContain("apps/notes");
    expect(output.text).not.toContain("Since the last init");
  });

  it("given two apps nothing ships and a long folder name, when the person runs init, then both are counted and the list stays aligned", async () => {
    const { context, output } = given({
      ...WORKSPACE,
      "apps/scripts/package.json": manifest("@acme/scripts"),
      "apps/a-very-long-dashboard/package.json": manifest("@acme/dash"),
      "apps/a-very-long-dashboard/cloud.toml": "",
    });

    await initRelease(context, { yes: true, blank: false });

    expect(output.text).toContain("◻ 2 folders with nothing to ship them");
    expect(output.lines).toContain(`│  ${"apps/api".padEnd(28)}${"cloud".padEnd(18)}cloud.toml`);
  });

  it("given an app that already has its unit file, when the person runs init, then their file is left as it was", async () => {
    const { context, files } = given({
      ...WORKSPACE,
      "apps/old/package.json": manifest("@acme/old"),
      "apps/old/cloud.toml": "",
      "apps/old/shiplane.unit.yml": "module: backend-service\nservice: kept\n",
    });

    await initRelease(context, { yes: true, blank: false });

    expect(files.read("apps/old/shiplane.unit.yml")).toBe(
      "module: backend-service\nservice: kept\n",
    );
    expect(files.changes.map(({ file }) => file)).not.toContain("apps/old/shiplane.unit.yml");
  });

  it("given --blank, when the person runs init, then each unit file names its module and lists every key commented out to fill", async () => {
    const { context, files } = given();

    await initRelease(context, { yes: true, blank: true });

    expect(files.read("apps/api/shiplane.unit.yml")).toBe(
      [
        "# yaml-language-server: $schema=../../node_modules/.cache/shiplane/schema.json",
        "# Written by shiplane init --blank. Uncomment and fill what applies.",
        "module: backend-service",
        "",
        "# The service it deploys (required)",
        "# service:",
        "",
        "# Where it answers, for other apps to read",
        "# url:",
        "",
      ].join("\n"),
    );
  });
});

describe("Feature: choosing how each app ships while setting up", () => {
  it("given an app an adapter only thinks likely, when the person is asked how it ships, then that adapter is recommended and only what the folder did not say is asked", async () => {
    const { context, prompter, files } = given();
    prompter.answer(["apps/api", "apps/web"], "pages", "acme-web", "make web", "write");

    await initRelease(context, { yes: false, blank: false });

    expect(prompter.asked).toEqual([
      "Which folders ship somewhere?",
      "How does apps/web ship?",
      "apps/web · Site name?",
      "apps/web · Build command?",
      "Write these files?",
    ]);
    expect(prompter.initials["Which folders ship somewhere?"]).toEqual(["apps/api", "apps/web"]);
    expect(prompter.choices["Which folders ship somewhere?"]).toEqual([
      { value: "apps/api", label: "apps/api", hint: "cloud · cloud.toml" },
      { value: "apps/web", label: "apps/web", hint: "pages · vite.config.ts" },
    ]);
    expect(prompter.initials["How does apps/web ship?"]).toBe("pages");
    expect(prompter.choices["How does apps/web ship?"]).toEqual([
      { value: "docker", label: "docker", hint: "" },
      { value: "cloud", label: "cloud", hint: "" },
      { value: "pages", label: "pages", hint: "vite.config.ts (recommended)" },
      { value: "skip", label: "skip", hint: "versioned, never shipped" },
    ]);
    expect(prompter.initials["Write these files?"]).toBe("write");
    expect(files.read("apps/web/shiplane.unit.yml")).toContain(
      "module: web-app\nsite: acme-web\nbuild:\n  command: make web\n",
    );
  });

  it("given an option left empty, when the person answers init, then the unit file leaves that option out", async () => {
    const { context, prompter, files } = given();
    prompter.answer(["apps/web"], "pages", "", null, "write");

    await initRelease(context, { yes: false, blank: false });

    expect(files.read("apps/web/shiplane.unit.yml")).toContain("module: web-app\n");
    expect(files.read("apps/web/shiplane.unit.yml")).not.toContain("site");
    expect(files.read("apps/web/shiplane.unit.yml")).not.toContain("build");
    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(false);
  });

  it("given the person picks another adapter than the one guessed, when init writes, then nothing the guess read lands in the unit file", async () => {
    const { context, prompter, files } = given();
    prompter.answer(["apps/web"], "docker", "write");

    await initRelease(context, { yes: false, blank: false });

    const unit = files.read("apps/web/shiplane.unit.yml") ?? "";
    expect(unit).toContain("module: backend-service\n");
    expect(unit).not.toContain("Read from");
  });

  it("given --blank, when the person picks an adapter, then no option is asked and each is left commented to fill", async () => {
    const { context, prompter, files } = given();
    prompter.answer(["apps/web"], "pages", "write");

    await initRelease(context, { yes: false, blank: true });

    expect(prompter.asked).not.toContain("apps/web · Site name?");
    expect(files.read("apps/web/shiplane.unit.yml")).toContain("# site:");
  });

  it("given an app the person marks skip, when init writes, then it gets no unit file", async () => {
    const { context, prompter, files, output } = given();
    prompter.answer(["apps/web"], "skip", "write");

    await initRelease(context, { yes: false, blank: false });

    expect(files.exists("apps/web/shiplane.unit.yml")).toBe(false);
    expect(output.lines).toContain("◇  Wrote 2 files");
  });

  it("given the person cancels the choice of apps, when init stops, then nothing is written", async () => {
    const { context, prompter, files, output } = given();
    prompter.answer(null);

    expect(await initRelease(context, { yes: false, blank: false })).toBe(true);

    expect(output.lines.at(-1)).toBe("Nothing written.");
    expect(files.changes).toEqual([]);
  });

  it("given the files listed to write, when the person cancels, then nothing is written", async () => {
    const { context, prompter, files, output } = given();
    prompter.answer(["apps/api"], "cancel");

    expect(await initRelease(context, { yes: false, blank: false })).toBe(true);

    expect(output.lines.at(-1)).toBe("Nothing written.");
    expect(files.changes).toEqual([]);
  });

  it("given the files listed to write, when the person asks to see them, then each is shown in full and they are asked again before writing", async () => {
    const { context, prompter, output, files } = given();
    prompter.answer(["apps/api"], "diff", "write");

    await initRelease(context, { yes: false, blank: false });

    expect(prompter.asked.filter((question) => question === "Write these files?")).toHaveLength(2);
    const shown = output.lines.indexOf("apps/api/shiplane.unit.yml");
    expect(shown).toBeGreaterThan(0);
    expect(output.lines[shown - 1]).toBe("");
    expect(output.lines.slice(shown + 1, shown + 6)).toEqual([
      "  # yaml-language-server: $schema=../../node_modules/.cache/shiplane/schema.json",
      "  # Written by shiplane init. Every key: shiplane docs backend-service",
      "  # Read from cloud.toml",
      "  ",
      "  module: backend-service",
    ]);
    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(true);
  });
});

describe("Feature: getting unit file autocompletion in VS Code", () => {
  const VSCODE = { ...WORKSPACE, ".vscode/extensions.json": "{}\n" };

  it("given a .vscode folder, when the person takes autocompletion, then the settings map unit files to the schema and the unit files need no schema comment", async () => {
    const { context, prompter, files, output } = given(VSCODE);
    prompter.answer(["apps/api"], ["editor"], "write");

    await initRelease(context, { yes: false, blank: false });

    expect(prompter.choices["Also set up"]).toEqual([
      { value: "editor", label: "editor autocompletion", hint: ".vscode/settings.json" },
    ]);
    expect(prompter.initials["Also set up"]).toEqual(["editor"]);
    expect(files.read(".vscode/settings.json")).toBe(
      `{\n  "yaml.schemas": { "./${SCHEMA}": "**/shiplane.unit.yml" }\n}\n`,
    );
    expect(output.lines).toContain("│  + .vscode/settings.json");
    expect(files.read("apps/api/shiplane.unit.yml")).not.toContain("yaml-language-server");
  });

  it("given a .vscode folder, when the person declines autocompletion, then the settings are left alone", async () => {
    const { context, prompter, files } = given(VSCODE);
    prompter.answer(["apps/api"], [], "write");

    await initRelease(context, { yes: false, blank: false });

    expect(files.exists(".vscode/settings.json")).toBe(false);
    expect(files.read("apps/api/shiplane.unit.yml")).toContain("yaml-language-server");
  });

  it("given the person cancels the autocompletion question, when init writes, then the settings are left alone and the unit files keep the schema comment", async () => {
    const { context, prompter, files } = given(VSCODE);
    prompter.answer(["apps/api"], null, "write");

    await initRelease(context, { yes: false, blank: false });

    expect(files.exists(".vscode/settings.json")).toBe(false);
    expect(files.read("apps/api/shiplane.unit.yml")).toContain("yaml-language-server");
  });

  it("given VS Code settings of their own, when the person runs init with --yes, then the schema mapping joins their settings", async () => {
    const { context, files, output } = given({
      ...VSCODE,
      ".vscode/settings.json": '{\n  "editor.tabSize": 2\n}\n',
    });

    await initRelease(context, { yes: true, blank: false });

    expect(files.read(".vscode/settings.json")).toBe(
      `{\n  "yaml.schemas": { "./${SCHEMA}": "**/shiplane.unit.yml" },\n  "editor.tabSize": 2\n}\n`,
    );
    expect(output.lines).toContain("│  ~ .vscode/settings.json");
  });

  it("given settings an earlier init mapped, when the person runs init with --yes, then the settings are not rewritten", async () => {
    const settings = `{ "yaml.schemas": { "./${SCHEMA}": "**/shiplane.unit.yml" } }\n`;
    const { context, files } = given({ ...VSCODE, ".vscode/settings.json": settings });

    await initRelease(context, { yes: true, blank: false });

    expect(files.changes.map(({ file }) => file)).not.toContain(".vscode/settings.json");
  });

  it("given settings mapping other schemas, when the person runs init with --yes, then they are told what to add and their settings are left alone", async () => {
    const settings = '{ "yaml.schemas": { "./other.json": "*.yml" } }\n';
    const { context, files, output } = given({ ...VSCODE, ".vscode/settings.json": settings });

    await initRelease(context, { yes: true, blank: false });

    expect(files.read(".vscode/settings.json")).toBe(settings);
    expect(output.lines).toContain(
      `│  .vscode/settings.json already maps yaml.schemas: add ./${SCHEMA} for **/shiplane.unit.yml`,
    );
  });
});

describe("Feature: picking up apps added since the last setup", () => {
  const CONFIGURED = {
    ...WORKSPACE,
    "shiplane.config.ts":
      'import { defineRelease } from "shiplane";\n\nexport default defineRelease({\n  modules: [],\n});\n',
    "apps/api/shiplane.unit.yml": "module: backend-service\nservice: api\n",
    [SCHEMA]: "{}\n",
  };

  it("given a set-up repository and an app added since, when the person runs init again, then the new app is listed and their edited unit files are kept", async () => {
    const { context, output, files } = given(CONFIGURED);

    await initRelease(context, { yes: true, blank: false });

    expect(output.lines).toContain("◆  Since the last init");
    expect(output.lines).toContain(`│  + ${"apps/web".padEnd(14)}new folder, vite.config.ts`);
    expect(output.lines).toContain(`│  = ${"1 folders".padEnd(14)}unchanged, your edits kept`);
    expect(output.text).not.toContain("+ apps/tools");
    expect(files.read("apps/api/shiplane.unit.yml")).toBe(
      "module: backend-service\nservice: api\n",
    );
    expect(output.lines).toContain(`│  ~ ${SCHEMA}`);
  });

  it("given a config that already ships every kind of app, when the person runs init again, then shiplane.config.ts is not rewritten", async () => {
    const { context, files, output } = given(CONFIGURED);

    await initRelease(context, { yes: true, blank: false });

    expect(files.read("shiplane.config.ts")).toBe(CONFIGURED["shiplane.config.ts"]);
    expect(output.text).not.toContain("shiplane.config.ts");
  });

  it("given a new app whose kind the config does not ship yet, when the person runs init again, then shiplane.config.ts gains it with its adapter", async () => {
    const repo = given(CONFIGURED);
    const load = repo.context.load;
    const context = {
      ...repo.context,
      load: async () => ({ ...(await load()), modules: [] }),
    };

    await initRelease(context, { yes: true, blank: false });

    const config = repo.files.read("shiplane.config.ts") ?? "";
    expect(config).toContain("webApp({ staticHosting: pagesStaticHosting() })");
    expect(config).toContain('import { pagesStaticHosting } from "@shiplane/pages";');
    expect(repo.output.lines).toContain("│  ~ shiplane.config.ts");
  });
});
