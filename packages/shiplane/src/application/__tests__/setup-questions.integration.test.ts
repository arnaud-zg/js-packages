import { describe, expect, it } from "vitest";

import { packageRegistryFake } from "../../adapters/package-registry/__fakes__/package-registry.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { setup } from "../setup";
import { SCHEMA_FILE, schemaText } from "../setupFiles";

// Every run is in memory: files, shell, person and adapters are Fakes. Nothing on this machine is
// read, written, pushed, published or deployed.

const fly = () =>
  detecting(serverHostingFake(), "fly", "fly.toml", (folder) => ({ service: folder.name }));
const pages = () => ({
  ...detecting(staticHostingFake(), "pages", "wrangler.toml", (folder) => ({ site: folder.name })),
  questions: (_folder: unknown, found: Record<string, unknown>) =>
    found.site ? [] : [{ key: "site", message: "Site name?", initial: "web" }],
});
const ADAPTERS = () => [fly(), pages(), packageRegistryFake()];

const manifest = (name: string, scripts: Record<string, string> = { build: "tsc" }) =>
  JSON.stringify({ name, version: "0.1.0", scripts });

const PROVEN = {
  "package.json": JSON.stringify({ name: "acme", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  ".github/workflows/ci.yml": "on: push\n",
  ".changeset/config.json": "{}\n",
  "apps/api/package.json": manifest("@acme/api"),
  "apps/api/fly.toml": 'app = "acme-api"\n',
};

/** The files without these ones. */
const without = (files: Record<string, string>, ...dropped: string[]) =>
  Object.fromEntries(Object.entries(files).filter(([file]) => !dropped.includes(file)));

/** A repository where nothing proves the flow: no git, no GitHub, no workflow, no changesets. */
const BARE = {
  "package.json": "{}",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  "apps/web/package.json": manifest("@acme/web"),
};

const given = (
  files: Record<string, string>,
  { interactive = true, remote = "git@github.com:acme/mono.git\n" } = {},
) => {
  const repo = memoryRepository(files, ADAPTERS(), { interactive });
  repo.shell.seed("git remote get-url origin", { stdout: remote });
  return repo;
};

/** The initial value each text question offered, by question. */
const recordTextInitials = (prompter: ReturnType<typeof given>["prompter"]) => {
  const initials: Record<string, string | undefined> = {};
  const text = prompter.text;
  prompter.text = (message: string, initial?: string) => {
    initials[message] = initial;
    return text(message);
  };
  return initials;
};

describe("Feature: setup says what it found", () => {
  it("given every flow part proven, when setup runs, then each part is shown with its proof and the files written are listed", async () => {
    const { context, prompter, output, files } = given(PROVEN);
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(output.lines).toEqual([
      "",
      "  shiplane setup  acme",
      "",
      "  Flow",
      "  ✓ git             .git",
      "  ✓ GitHub          remote github.com/acme/mono",
      "  ✓ GitHub Actions  .github/workflows/ci.yml",
      "  ✓ Changesets      .changeset/config.json",
      "",
      "  Apps",
      "  ✓ apps/api          Backend service → fly   proof: fly.toml",
      "",
      "  Rehearsal  · nothing is pushed, published or deployed",
      "  ✓ build 1 app",
      "     ✓ apps/api          npm run build  0.0s",
      "  + shiplane.config.ts",
      "  + apps/api/shiplane.unit.yml",
      "",
      "  ✓ Ready. Add a changeset, merge, and run shiplane",
    ]);
    expect(prompter.initials["Your apps and packages are in apps/* (1 folders)?"]).toBe(true);
    expect(prompter.initials["Releasable. Write it?"]).toBe(true);
    expect(files.read(SCHEMA_FILE)).toBe(schemaText((await context.load()).modules));
    expect(files.read("apps/api/shiplane.unit.yml")).toContain(
      "# yaml-language-server: $schema=../../node_modules/.cache/shiplane/schema.json",
    );
  });

  it("given a GitHub remote over https, when setup reads it, then the code host is proven", async () => {
    const { context, prompter, output } = given(PROVEN, {
      remote: "https://github.com/acme/web-site.git\n",
    });
    prompter.answer(true, true);

    await setup(context, { yes: false });

    expect(output.lines).toContain("  ✓ GitHub          remote github.com/acme/web-site");
  });

  it("given a remote that is not GitHub and a workflow folder with no workflow, when setup runs, then the code host and the CI pipeline are asked", async () => {
    const noCi = without(PROVEN, ".github/workflows/ci.yml");
    const { context, prompter, output } = given(
      { ...noCi, ".github/workflows/README.md": "notes" },
      { remote: "git@gitlab.com:acme/mono.git\n" },
    );
    prompter.answer("ready", "ready", "ready", "ready", true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(output.lines).toContain("  ? Code host       not sure: nothing here proves one");
    expect(output.lines).toContain("  ? CI pipeline     not sure: nothing here proves one");
    expect(prompter.asked.slice(0, 4)).toEqual([
      "Source control?",
      "Code host?",
      "CI pipeline?",
      "Versioning?",
    ]);
    expect(prompter.choices["Versioning?"]?.[0]).toEqual({
      value: "ready",
      label: "Changesets",
      hint: "@shiplane/changesets",
    });
    expect(prompter.initials["Source control?"]).toBe("ready");
    expect(prompter.initials["Code host?"]).toBe("custom");
    expect(prompter.choices["Source control?"]?.[0]?.hint).toBe("@shiplane/git");
    expect(prompter.choices["Code host?"]?.[0]?.hint).toBe("@shiplane/github, not found here");
  });

  it("given a workflow written as .yaml, when setup runs, then the CI pipeline is proven by it", async () => {
    const noCi = without(PROVEN, ".github/workflows/ci.yml");
    const { context, prompter, output } = given({
      ...noCi,
      ".github/workflows/ship.yaml": "on: push",
    });
    prompter.answer(true, true);

    await setup(context, { yes: false });

    expect(output.lines).toContain("  ✓ GitHub Actions  .github/workflows/ship.yaml");
  });

  it("given no git folder, when setup runs, then it never asks git for a remote", async () => {
    const { context, prompter, shell } = given(BARE);
    prompter.answer(null);

    expect(await setup(context, { yes: false })).toBe(false);

    expect(shell.calls).toEqual([]);
  });

  it("given a git folder, when setup reads the remote, then git runs at the repository's root", async () => {
    const { context, prompter, shell } = given(PROVEN);
    prompter.answer(true, false);

    await setup(context, { yes: false });

    expect(shell.calls[0]).toEqual({
      command: "git",
      args: ["remote", "get-url", "origin"],
      cwd: "/memory/acme",
      env: undefined,
    });
  });
});

describe("Feature: what setup asks when nothing proves the flow", () => {
  it("given a bare repository, when setup runs, then it asks each part, how to release, and what each app is, with the choices a person reads", async () => {
    const { context, prompter, output, files } = given(BARE);
    prompter.answer(
      "ready",
      "ready",
      "ready",
      "commits",
      true,
      "static-hosting",
      "pages",
      "acme",
      true,
    );

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked).toEqual([
      "Source control?",
      "Code host?",
      "CI pipeline?",
      "How do you want to release?",
      "Your apps and packages are in apps/* (1 folders)?",
      "What is apps/web?",
      "Where does apps/web go?",
      "apps/web · Site name?",
      "Releasable. Write it?",
    ]);
    const custom = { value: "custom", label: "Custom", hint: "a no-op in memory you implement" };
    expect(prompter.choices["Source control?"]).toEqual([
      { value: "ready", label: "git", hint: "@shiplane/git, not found here" },
      custom,
    ]);
    expect(prompter.choices["Code host?"]).toEqual([
      { value: "ready", label: "GitHub", hint: "@shiplane/github, not found here" },
      custom,
    ]);
    expect(prompter.choices["CI pipeline?"]).toEqual([
      { value: "ready", label: "GitHub Actions", hint: "@shiplane/github, not found here" },
      custom,
    ]);
    expect(prompter.choices["How do you want to release?"]).toEqual([
      {
        value: "commits",
        label: "From commits",
        hint: "feat, fix and ! set the version, nothing to write",
      },
      { value: "changesets", label: "From changesets", hint: "you write what ships, and when" },
      custom,
    ]);
    expect(prompter.choices["What is apps/web?"]).toEqual([
      { value: "server-hosting", label: "Backend service", hint: "a server that runs" },
      { value: "static-hosting", label: "Web application", hint: "static files on a CDN" },
      {
        value: "mobile-distribution",
        label: "Mobile application",
        hint: "store builds and updates",
      },
      { value: "package-registry", label: "Published package", hint: "a library others install" },
      { value: "skip", label: "Internal tool", hint: "versioned, never deployed" },
    ]);
    expect(prompter.choices["Where does apps/web go?"]).toEqual([
      { value: "pages", label: "pages" },
      { value: "custom", label: "Custom", hint: "a no-op adapter you implement" },
    ]);
    expect(prompter.initials["Where does apps/web go?"]).toBe("pages");
    expect(output.lines.slice(3, 12)).toEqual([
      "  Flow",
      "  ? Source control  not sure: nothing here proves one",
      "  ? Code host       not sure: nothing here proves one",
      "  ? CI pipeline     not sure: nothing here proves one",
      "  ? Versioning      not sure: nothing here proves one",
      "",
      "  Apps",
      "  ? apps/web          not sure what this is",
      "",
    ]);
    expect(output.lines.slice(-6)).toEqual([
      "  + shiplane.config.ts",
      "  + .changeset/config.json",
      "  ~ package.json",
      "  + apps/web/shiplane.unit.yml",
      "",
      "  ✓ Ready. Run npm install, then merge a commit, and run shiplane",
    ]);
    expect(files.read("apps/web/shiplane.unit.yml")).toContain("site: acme");
  });

  it("given a custom source control, when it is named, then the config imports it and setup says to fill it in", async () => {
    const { context, prompter, output, files } = given(BARE);
    prompter.answer(
      "custom",
      "svnSourceControl",
      "ready",
      "ready",
      "commits",
      true,
      "static-hosting",
      "pages",
      "acme",
      true,
    );

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("shiplane.config.ts")).toContain("sourceControl: svnSourceControl(),");
    expect(output.lines).toContain("  + shiplane/adapters/svn-source-control.ts");
    expect(output.lines).toContain("  + shiplane/adapters/svn-source-control.test.ts");
    expect(output.text).toContain(
      "Custom adapters start in memory: fill them in until their contract test passes.",
    );
    expect(output.text).toContain(
      "Works? Share it as shiplane-<name>, or open a pull request at github.com/arnaud-zg/packages.",
    );
  });

  it("given custom versioning, when it is named, then its adapter is written and no changesets file is", async () => {
    const noChangesets = without(PROVEN, ".changeset/config.json");
    const { context, prompter, files } = given(noChangesets);
    prompter.answer("custom", "calverVersioning", true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("shiplane.config.ts")).toContain("versioning: calverVersioning(),");
    expect(files.read("shiplane.config.ts")).toContain(
      'import { calverVersioning } from "./shiplane/adapters/calver-versioning";',
    );
    expect(files.exists("shiplane/adapters/calver-versioning.ts")).toBe(true);
    expect(files.exists(".changeset/config.json")).toBe(false);
  });

  it("given a custom name already taken, when it is typed, then it says so and asks again", async () => {
    const noChangesets = without(PROVEN, ".changeset/config.json");
    const { context, prompter, output } = given({
      ...noChangesets,
      "shiplane/adapters/calver-versioning.ts": "// mine",
    });
    const initials = recordTextInitials(prompter);
    prompter.answer("custom", "calverVersioning", "otherVersioning", true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(output.text).toContain("✗ shiplane/adapters/calver-versioning.ts already exists");
    expect(initials["Name it (you can rename it later)"]).toBe("customVersioning");
  });

  it("given an unclear app with no adapter for its kind, when Custom is named, then the name offered comes from its folder", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "apps/my-app/package.json": manifest("@acme/my-app"),
    });
    const initials = recordTextInitials(prompter);
    prompter.answer(true, "mobile-distribution", "myAppDelivery", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(initials["Name it (you can rename it later)"]).toBe("myAppDelivery");
    expect(files.read("shiplane.config.ts")).toContain(
      'mobileApp({ name: "my-app-delivery", mobileDistribution: myAppDelivery() })',
    );
  });

  it("given an unclear app and an adapter for its kind, when Custom is picked anyway, then a custom static host ships it", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "apps/docs/package.json": manifest("@acme/docs"),
    });
    prompter.answer(true, "static-hosting", "custom", "docsDelivery", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("shiplane.config.ts")).toContain(
      'webApp({ name: "docs-delivery", staticHosting: docsDelivery() })',
    );
    expect(files.read("shiplane/adapters/docs-delivery.ts")).toContain("staticHostingMemory");
  });

  it("given an unclear app, when it is a published package, then the registry's adapter ships it with no question", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "apps/lib/package.json": manifest("@acme/lib"),
    });
    prompter.answer(true, "package-registry", "fake", "snapshot", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("apps/lib/shiplane.unit.yml")).toContain("module: published-package");
    expect(files.read("shiplane.config.ts")).toContain("publishedPackage(");
    expect(files.read("shiplane.config.ts")).not.toContain("testRelease");
  });

  it("given a published package, when the person picks git-flow test releases, then the config holds the preset and imports it", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "apps/lib/package.json": manifest("@acme/lib"),
    });
    prompter.answer(true, "package-registry", "fake", "gitflow", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked).toContain("How do test releases work? (shiplane test-release)");
    const config = files.read("shiplane.config.ts") ?? "";
    expect(config).toContain("  testRelease: testReleases.gitflow,");
    expect(config).toMatch(/import \{[^}]*\btestReleases\b[^}]*\} from "shiplane";/);
  });

  it("given no published package, when setup runs, then it never asks how test releases work", async () => {
    const { context, prompter } = given(PROVEN);
    prompter.answer(true, true);

    await setup(context, { yes: false });

    expect(prompter.asked).not.toContain("How do test releases work? (shiplane test-release)");
  });
});

describe("Feature: where the apps are", () => {
  it("given a workspace that excludes a folder and lists an empty one, when setup asks, then only the folders it ships from are named and written", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - libs/*\n  - '!apps/legacy'\n",
    });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked[0]).toBe("Your apps and packages are in apps/* (1 folders)?");
    expect(files.read("shiplane.config.ts")).toContain('units: ["apps/*", "!apps/legacy"]');
  });

  it("given the workspace folders refused, when two folders are typed with a comma, then both are written to the config", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "tools/cli/package.json": manifest("@acme/cli"),
      "tools/cli/fly.toml": "",
    });
    prompter.answer(false, " apps/* , tools/*, ", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.read("shiplane.config.ts")).toContain('units: ["apps/*", "tools/*"]');
    expect(files.exists("tools/cli/shiplane.unit.yml")).toBe(true);
  });

  it("given nothing typed, when setup asks where the apps are, then it says nothing matched and asks again", async () => {
    const { context, prompter, output } = given({
      ...PROVEN,
      "pnpm-workspace.yaml": "packages:\n  - services/*\n",
    });
    prompter.answer(" , ", "apps/*, nowhere/*", "apps/*", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(output.text).toContain("✗ nothing typed matches no folder: try again");
    expect(output.text).toContain("✗ nowhere/* matches no folder: try again");
  });

  it("given --yes and no workspace folders, when setup runs, then it says where the apps are needs a person", async () => {
    const { context, output, files } = given(
      { ...PROVEN, "pnpm-workspace.yaml": "packages:\n  - services/*\n" },
      { interactive: false },
    );

    expect(await setup(context, { yes: true })).toBe(false);

    expect(output.lines.slice(-3)).toEqual([
      "  ✗ 1 thing needs a person:",
      "     where the apps are (no workspace folders found)",
      "  Run shiplane setup without --yes. Nothing written.",
    ]);
    expect(files.changes).toEqual([]);
  });

  it("given --yes, an unproven flow and an unclear app, when setup runs, then each thing is listed for a person", async () => {
    const { context, output } = given(BARE, { interactive: false });

    expect(await setup(context, { yes: true })).toBe(false);

    expect(output.lines.slice(-6)).toEqual([
      "  ✗ 4 things need a person:",
      "     the source control (nothing proves one)",
      "     the code host (nothing proves one)",
      "     the ci pipeline (nothing proves one)",
      "     apps/web (no adapter is sure what it is)",
      "  Run shiplane setup without --yes. Nothing written.",
    ]);
  });

  it("given --yes and a proven app without a build script, when setup runs, then no build command is asked", async () => {
    const { context, prompter, files } = given(
      { ...PROVEN, "apps/api/package.json": manifest("@acme/api", {}) },
      { interactive: false },
    );

    expect(await setup(context, { yes: true })).toBe(true);

    expect(prompter.asked).toEqual([]);
    expect(files.read("apps/api/shiplane.unit.yml")).not.toContain("buildCommand");
  });

  it("given no build script, when the person leaves the build command empty, then none is saved", async () => {
    const { context, prompter, files } = given({
      ...PROVEN,
      "apps/api/package.json": manifest("@acme/api", {}),
    });
    prompter.answer(true, "   ", true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked[1]).toBe(
      'apps/api has no "build" script. Command to build it? (empty: nothing to build)',
    );
    expect(files.read("apps/api/shiplane.unit.yml")).not.toContain("buildCommand");
  });

  it("given a folder with no package.json, when setup looks for apps, then it is not one", async () => {
    const { context, prompter, files } = given({ ...PROVEN, "apps/assets/logo.svg": "<svg/>" });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(prompter.asked).not.toContain("What is apps/assets?");
    expect(files.exists("apps/assets/shiplane.unit.yml")).toBe(false);
  });
});

describe("Feature: stopping setup part way writes nothing", () => {
  const stops: [string, Record<string, string>, unknown[]][] = [
    ["the source control question", BARE, [null]],
    ["the versioning question", BARE, ["ready", "ready", "ready", null]],
    ["a custom adapter's name", BARE, ["custom", null]],
    ["custom versioning's name", BARE, ["ready", "ready", "ready", "custom", null]],
    [
      "where the apps are",
      { ...PROVEN, "pnpm-workspace.yaml": "packages:\n  - services/*\n" },
      [null],
    ],
    ["what an app is", { ...PROVEN, "apps/web/package.json": manifest("@acme/web") }, [true, null]],
    [
      "where an app goes",
      { ...PROVEN, "apps/web/package.json": manifest("@acme/web") },
      [true, "static-hosting", null],
    ],
    [
      "a custom app adapter's name",
      { ...PROVEN, "apps/app/package.json": manifest("@acme/app") },
      [true, "mobile-distribution", null],
    ],
  ];

  it.each(stops)(
    "given the person cancels %s, when setup stops, then it says nothing was written",
    async (_at, files, answers) => {
      const repo = given(files);
      repo.prompter.answer(...(answers as Parameters<typeof repo.prompter.answer>));

      expect(await setup(repo.context, { yes: false })).toBe(false);

      expect(repo.output.lines.at(-1)).toBe("  Nothing written.");
      expect(repo.files.changes).toEqual([]);
    },
  );
});
