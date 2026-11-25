import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "../../testing/workspace";
import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import { RecordingProgress } from "../../adapters/terminal/__fakes__/progress.fake";
import { MemoryOutput, ScriptedPrompter } from "../../adapters/terminal/__fakes__/terminal.fake";
import { runCli } from "../../cli/main";
import { endRehearsal, rehearsal } from "../../testing/rehearsal";
import { createWorkspace, packageJson, SOURCE_ALIASES } from "../../testing/workspace";

// shiplane as a person types it, on a repository whose config ships through Fakes: what they read
// in the terminal, the exit code their scripts rely on, and what each word and flag sets off.
const CONFIG = `
import { backendService, defineRelease, releaseFlow, webApp } from "shiplane";
import { rehearsal } from "shiplane/rehearsal";

const fakes = rehearsal();

export default defineRelease({ deployApps: { promote: [{ from: "preview", to: "production" }] },
  flow: releaseFlow({
    sourceControl: fakes.sourceControl,
    codeHost: fakes.codeHost,
    ciPipeline: fakes.ciPipeline,
    versioning: fakes.versioning,
  }),
  modules: [
    backendService({ serverHosting: fakes.serverHosting }),
    webApp({ staticHosting: fakes.staticHosting }),
  ],
  display: { verbose: false, mascot: false },
});
`;

const WITH_FEATURE = CONFIG.replace(
  'import { backendService, defineRelease, releaseFlow, webApp } from "shiplane";',
  'import { backendService, defineRelease, internalTool, releaseFlow, webApp } from "shiplane";',
)
  .replace(
    "webApp({ staticHosting: fakes.staticHosting }),",
    "webApp({ staticHosting: fakes.staticHosting }),\n    internalTool(),",
  )
  .replace(
    "display:",
    `features: [
    {
      type: "feature",
      name: "announce-in-the-changelog",
      adapters: [fakes.codeHost, fakes.ciPipeline],
      afterShip: () => Promise.resolve([]),
    },
  ],
  display:`,
  );

const ALIASES = {
  ...SOURCE_ALIASES,
  "shiplane/rehearsal": path.resolve(import.meta.dirname, "../../testing/rehearsal.ts"),
};

let workspace: Workspace | undefined;
let printed: string[] = [];

beforeEach(() => {
  printed = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    printed.push(stripVTControlCharacters(String(chunk)));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  workspace?.remove();
  workspace = undefined;
  endRehearsal();
});

const stdout = () => printed.join("");

const given = ({
  config = CONFIG,
  configFile = "shiplane.config.ts",
  apiUnit = "module: backend-service\nservice: api\n",
}: { config?: string; configFile?: string; apiUnit?: string } = {}) => {
  workspace = createWorkspace({
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    [configFile]: config,
    "apps/api/package.json": packageJson("@acme/api", "1.0.0"),
    "apps/api/shiplane.unit.yml": apiUnit,
    "apps/site/package.json": packageJson("@acme/site", "1.0.0"),
    "apps/site/shiplane.unit.yml": "module: web-app\nsite: site\n",
  });
  const fakes = rehearsal();
  fakes.sourceControl.fake.seed({
    position: { branch: "main", head: "h1", originMain: "h1" },
    tags: { "api@1.0.0": "t1", "site@1.0.0": "t2" },
    files: {
      "api@1.0.0:ci/ship.yml": "on: workflow_dispatch",
      "site@1.0.0:ci/ship.yml": "on: workflow_dispatch",
    },
  });
  const prompter = new ScriptedPrompter();
  const output = new MemoryOutput();
  const shell = new RecordingShell();
  const root = workspace.root;
  const run = (...argv: string[]) =>
    runCli(argv, root, {
      aliases: ALIASES,
      prompter,
      output,
      progress: new RecordingProgress(output),
      shell,
    });
  return { fakes, prompter, output, shell, run, workspace };
};

describe("Feature: finding the right command from the help", () => {
  it.each([[["--help"]], [["setup", "--help"]], [["-h"]]])(
    "given %j, when it is run, then the help is shown and nothing else happens",
    async (argv) => {
      const { run } = given();

      expect(await run(...argv)).toBe(0);

      expect(stdout()).toContain("shiplane help all");
    },
  );

  it("given a flag shiplane does not know, when it is run, then it says so in one line and shows the help", async () => {
    const { run } = given();

    expect(await run("status", "--chanel")).toBe(1);

    expect(stdout()).toContain("✗  Unknown option '--chanel'");
    expect(stdout()).toContain("shiplane help all");
  });

  it("given a person who needs a reminder, when they run shiplane help, then the day-to-day commands are listed and the rarer ones are kept for help all", async () => {
    const { run } = given();

    expect(await run("help")).toBe(0);

    expect(stdout()).toContain(
      "shiplane status                 where every unit stands, and what to run next",
    );
    expect(stdout()).toContain("shiplane help all");
    expect(stdout()).not.toContain("--channel preview|production");
  });

  it("given a person looking for a rarer command, when they run shiplane help all, then every command and flag is listed", async () => {
    const { run } = given();

    expect(await run("help", "all")).toBe(0);

    expect(stdout()).toContain("shiplane remove <unit>          stop shipping a unit");
    expect(stdout()).toContain("--channel <environment>         one deployApps.promote names");
  });

  it("given a mistyped command, when the person runs it, then shiplane names the word, lists every command and fails", async () => {
    const { run } = given();

    expect(await run("deploy")).toBe(1);

    expect(stdout()).toContain('✗  no command "deploy"');
    expect(stdout()).toContain("shiplane adapter new <name>");
  });
});

describe("Feature: choosing how and where a command ships with flags", () => {
  it("given a script still passing --via github, when a ship is dry-run, then the person is told the flag is now --via ci", async () => {
    const { run } = given();

    expect(await run("ship", "--dry-run", "--via", "github")).toBe(0);

    expect(stdout()).toContain("--via github is now --via ci: the flow's CI pipeline");
  });

  it("given a ship through a way shiplane does not know, when the person runs it, then shiplane refuses before anything is dispatched", async () => {
    const { run, fakes } = given();

    await expect(run("ship", "--via", "carrier-pigeon")).rejects.toThrow();

    expect(fakes.ciPipeline.fake.received).toEqual([]);
  });

  it("given a channel shiplane does not know, when status is asked for it, then shiplane refuses rather than guess", async () => {
    const { run } = given();

    expect(await run("status", "--channel", "elsewhere")).toBe(1);

    expect(stdout()).toContain('unknown environment "elsewhere": preview, production');
  });

  it("given a ship through this machine, when it is dry-run, then no renamed-flag notice is shown", async () => {
    const { run } = given();

    expect(await run("ship", "--dry-run", "--via", "local")).toBe(0);

    expect(stdout()).not.toContain("--via github is now");
  });

  it("given a person who turns the mascot and verbose output off, when they list the plugins, then the command still succeeds", async () => {
    const { run } = given();

    expect(await run("plugins", "--json", "--no-mascot", "--no-verbose")).toBe(0);
  });
});

describe("Feature: checking a runner before it ships", () => {
  it("given a channel the config does not have, when doctor --ci runs, then it names the known ones and the docs, and exits 1", async () => {
    const { run } = given();

    expect(await run("doctor", "--ci", "api", "--channel", "qa")).toBe(1);

    expect(stdout()).toContain("✓ units  api");
    expect(stdout()).toContain('✗ unknown environment "qa": preview, production');
    expect(stdout()).toContain("reference.md#github-actions-workflow");
  });

  it("given a person reading help all, when they look for the runner's check, then doctor --ci is listed", async () => {
    const { run } = given();

    expect(await run("help", "all")).toBe(0);

    expect(stdout()).toContain("shiplane doctor --ci [unit...]");
  });
});

describe("Feature: seeing where every unit stands and what to run next", () => {
  it("given an open release PR and an app with nothing new, when the person runs status, then they see each unit's state, the PR link and the next step", async () => {
    const { run, fakes, workspace: repo } = given();
    fakes.codeHost.fake.seed({
      openPrs: [{ branch: "shiplane/release-1", pr: { number: 7, url: "https://x/pr/7" } }],
    });
    repo.write("apps/api/package.json", packageJson("@acme/api", "1.1.0"));

    expect(await run("status")).toBe(0);

    expect(stdout().split("\n")).toEqual([
      "",
      "  Release status  ·  preview",
      "",
      "  Unit      Version     Target            Where it stands",
      "  api       1.1.0       fake              · nothing new",
      "  site      1.0.0       fake              ↑ 1.0.0 released, not on preview yet",
      "",
      "  Release PR  https://x/pr/7",
      "",
      "→ Next: merge the release PR, then: shiplane",
      "",
      "",
    ]);
  });

  it("given a release PR merged but its version not tagged, when the person runs status, then the app shows as untagged and the next step is to tag it", async () => {
    const { run, fakes, workspace: repo } = given();
    repo.write("apps/api/package.json", packageJson("@acme/api", "1.1.0"));
    fakes.sourceControl.fake.seed({
      versionCommits: { "apps/api@1.1.0": { sha: "v2", subject: "chore(api): release v1.1.0" } },
    });

    expect(await run("status")).toBe(0);

    const lines = stdout().split("\n");
    expect(lines).toContain(
      "  api       1.1.0       fake              ↑ 1.1.0 versioned, not tagged yet",
    );
    expect(lines).toContain("  Untagged  api@1.1.0");
    expect(lines).toContain("→ Next: tag what was versioned and ship it: shiplane");
  });

  it("given an app with a long name, when the person runs status, then the table widens so its columns stay aligned", async () => {
    const { run, workspace: repo } = given();
    repo.write("apps/api/shiplane.unit.yml", "module: backend-service\nservice: api\n");
    repo.write("apps/storefront-web/package.json", packageJson("@acme/storefront-web", "1.0.0"));
    repo.write("apps/storefront-web/shiplane.unit.yml", "module: web-app\nsite: shop\n");

    expect(await run("status")).toBe(0);

    expect(stdout()).toContain(`  ${"Unit".padEnd(16)}${"Version".padEnd(12)}`);
  });

  it("given a script reading production, when it runs status --json, then it gets every unit's production status as JSON", async () => {
    const { run } = given();

    expect(await run("status", "--json", "--channel", "production")).toBe(0);

    const status = JSON.parse(stdout()) as { environment: string; units: { unit: string }[] };
    expect(status.environment).toBe("production");
    expect(status.units.map(({ unit }) => unit)).toEqual(["api", "site"]);
  });
});

describe("Feature: seeing which providers and modules the release is wired to", () => {
  it("given a configured release, when the person lists the plugins, then each provider, each module with its settings and the apps using it are shown in columns", async () => {
    const { run } = given();

    expect(await run("plugins")).toBe(0);

    const lines = stdout().split("\n");
    expect(lines).toContain("Flow in shiplane.config.ts");
    expect(lines).toContain(`  ${"sourceControl".padEnd(17)}fake`);
    expect(lines).toContain(`  ${"ciPipeline".padEnd(17)}fake`);
    expect(lines).toContain("Modules, in release order");
    expect(lines).toContain(`  ${"backend-service".padEnd(17)}fake  service, url`);
    expect(lines).toContain(`  ${" ".repeat(17)}used by api`);
    expect(lines).toContain(`  ${"web-app".padEnd(17)}fake  site`);
    expect(lines).toContain(`  ${" ".repeat(17)}used by site`);
    expect(lines).toContain("Features, after the ship");
    expect(lines).toContain("  none");
  });

  it("given a script reading the wiring, when it lists the plugins as JSON, then it gets the flow, the modules with their apps and the features", async () => {
    const { run } = given();

    expect(await run("plugins", "--json")).toBe(0);

    expect(JSON.parse(stdout())).toEqual({
      flow: { sourceControl: "fake", codeHost: "fake", ciPipeline: "fake", versioning: "fake" },
      modules: [
        {
          name: "backend-service",
          kind: "backend-service",
          provider: "fake",
          keys: ["service", "url"],
          apps: ["api"],
        },
        { name: "web-app", kind: "web-app", provider: "fake", keys: ["site"], apps: ["site"] },
      ],
      features: [],
    });
  });

  it("given an after-ship feature and a module no app uses, when the person lists the plugins, then both are shown with the columns widened to the longest name", async () => {
    const { run } = given({ config: WITH_FEATURE });

    expect(await run("plugins")).toBe(0);

    const lines = stdout().split("\n");
    const width = "announce-in-the-changelog".length + 2;
    expect(lines).toContain(`  ${"sourceControl".padEnd(width)}fake`);
    expect(lines).toContain(`  ${"internal-tool".padEnd(width)}release-only  no options`);
    expect(lines).toContain(`  ${" ".repeat(width)}no app names it`);
    expect(lines).toContain(`  ${"announce-in-the-changelog".padEnd(width)}uses fake, fake`);
    expect(lines).not.toContain("  none");
  });
});

describe("Feature: dry-running a ship before anything runs", () => {
  it("given tagged apps, when the person dry-runs a ship, then they see the preview dispatch and nothing is dispatched", async () => {
    const { run, output, fakes } = given();

    expect(await run("ship", "--dry-run")).toBe(0);

    expect(output.text).toContain("-f environment=preview");
    expect(output.text).not.toContain("-f environment=production");
    expect(fakes.ciPipeline.fake.received).toEqual([]);
  });

  it("given tagged apps, when the person dry-runs a promote, then they see the production dispatch and nothing is dispatched", async () => {
    const { run, output, fakes } = given();

    expect(await run("promote", "--dry-run")).toBe(0);

    expect(output.text).toContain("-f environment=production");
    expect(fakes.ciPipeline.fake.received).toEqual([]);
  });

  it("given a person still typing shiplane plan, when it runs, then they are told it is now --dry-run and still see the preview", async () => {
    const { run, output } = given();

    expect(await run("plan")).toBe(0);

    expect(stdout()).toContain(
      "plan is now --dry-run: shiplane ship --dry-run, shiplane promote --dry-run",
    );
    expect(output.text).toContain("-f environment=preview");
  });

  it("given a person passing --dry-run to status, when it runs, then status reads as usual since only ships have a preview", async () => {
    const { run, output } = given();

    expect(await run("status", "--dry-run")).toBe(0);

    expect(stdout()).toContain("Release status");
    expect(output.text).not.toContain("fake-ci run");
  });

  it("given a person who types shiplane --dry-run, when it runs, then they see the preview plan without being asked anything", async () => {
    const { run, output, prompter } = given();

    expect(await run("--dry-run")).toBe(0);

    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("Plan  ·  preview  · nothing runs");
  });
});

describe("Feature: shipping one app or every tagged app through CI", () => {
  it("given two tagged apps, when the person ships api through CI, then only api's tag is dispatched", async () => {
    const { run, fakes } = given();

    expect(await run("ship", "api", "--via", "ci", "--yes")).toBe(0);

    expect(fakes.ciPipeline.fake.received.map(({ ref }) => ref)).toEqual(["api@1.0.0"]);
  });

  it("given two tagged apps, when the person ships without naming one, then both tags are dispatched", async () => {
    const { run, fakes } = given();

    expect(await run("ship", "-y", "--via", "ci")).toBe(0);

    expect(fakes.ciPipeline.fake.received.map(({ ref }) => ref)).toEqual([
      "api@1.0.0",
      "site@1.0.0",
    ]);
  });
});

describe("Feature: being told what is wrong with the config before anything runs", () => {
  it("given a unit file with a mistyped key, when any command runs, then shiplane stops naming the file, the line and the key it meant", async () => {
    const { run } = given({ apiUnit: "module: backend-service\nservice: api\nulr: x\n" });

    expect(await run("status")).toBe(2);

    expect(stdout()).toContain("✗  apps/api/shiplane.unit.yml:3  ");
    expect(stdout()).toMatch(/\n {3}.*url/);
  });

  it("given a config under its old name, when a command runs, then the person is asked to rename it and the command still runs", async () => {
    const { run } = given({ configFile: "release.config.ts" });

    expect(await run("plugins", "--json")).toBe(0);

    expect(stdout()).toContain("!  rename release.config.ts to shiplane.config.ts");
  });

  it("given a config that loads, when a command runs, then the editor schema for unit files is written for autocomplete", async () => {
    const { run, workspace: repo } = given();

    expect(await run("plugins", "--json")).toBe(0);

    expect(repo.exists("node_modules/.cache/shiplane/schema.json")).toBe(true);
  });

  it("given a tag format that names no unit, when a command runs, then shiplane stops and shows how to fix the format", async () => {
    const { run } = given({
      config: CONFIG.replace("display:", 'tag: "v{version}",\n  display:'),
    });

    expect(await run("status")).toBe(2);

    expect(stdout()).toContain(
      '✗  shiplane.config.ts  tag "v{version}" names no unit, so 2 units would share each tag\n',
    );
    expect(stdout()).toContain('   add {name} to the format, such as "{name}--v{version}"');
  });
});

describe("Feature: releasing to preview and production step by step", () => {
  it("given the preview channel, when the person types shiplane, then they are asked what to release to preview", async () => {
    const { run, prompter, output } = given();
    prompter.answer([]);

    expect(await run()).toBe(0);

    expect(prompter.asked).toEqual([
      "What do you want to release to preview? Greyed units have nothing to release.",
    ]);
    expect(output.text).toContain("Nothing ran.");
  });

  it("given nothing on preview yet, when the person types shiplane on production, then they are told to release to preview first", async () => {
    const { run, prompter, output } = given();

    expect(await run("--channel", "production")).toBe(0);

    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("Nothing to release to production. Release to preview first:");
  });

  it.each(["test-release", "branch"])(
    "given no change since the last release, when the person runs %s, then they are told there is nothing to publish",
    async (command) => {
      const { run, prompter, output } = given();

      expect(await run(command)).toBe(0);

      expect(prompter.asked).toEqual([]);
      expect(output.text).toContain(
        "nothing pending: a test release publishes what the changesets release",
      );
    },
  );

  it.each([
    ["picks no app", []],
    ["closes the question", null],
  ])(
    "given a person preparing a release, when they %s, then nothing is prepared and shiplane exits cleanly",
    async (_, answer) => {
      const { run, prompter } = given();
      prompter.answer(answer);

      expect(await run("version")).toBe(0);

      expect(prompter.asked).toHaveLength(1);
    },
  );

  it("given a person preparing a release, when they pick an app and agree, then the release PR is opened", async () => {
    const { run, prompter, output } = given();
    prompter.answer(["api"], true, true, true);

    expect(await run("version")).toBe(0);

    expect(prompter.asked).toContain("Release these to preview?");
    expect(output.text).toContain("1. Open the release PR");
  });

  it("given a person preparing a release, when they decline it, then nothing runs and shiplane fails", async () => {
    const { run, prompter, output } = given();
    prompter.answer(["api"], false);

    expect(await run("version")).toBe(1);

    expect(output.text).toContain("Nothing ran.");
  });

  it("given a release PR merged but its version not tagged, when the person runs shiplane tag, then the app is tagged with its release notes", async () => {
    const { run, fakes, output, workspace: repo } = given();
    repo.write("apps/api/package.json", packageJson("@acme/api", "1.1.0"));
    fakes.sourceControl.fake.seed({
      versionCommits: { "apps/api@1.1.0": { sha: "v2", subject: "chore(api): release v1.1.0" } },
    });

    expect(await run("tag", "--yes")).toBe(0);

    expect(output.text).toContain("Tags and release notes  api@1.1.0");
  });
});
