import { afterEach, describe, expect, it } from "vitest";

import type { Workspace } from "../../../testing/workspace";
import type { Release } from "../loadRelease";
import { nodeFiles } from "../../../adapters/files/node-files.adapter";
import { RecordingShell } from "../../../adapters/shell/__fakes__/shell.fake";
import { MemoryOutput, ScriptedPrompter } from "../../../adapters/terminal/__fakes__/terminal.fake";
import { loadReleaseOnDisk } from "../../../cli/compose";
import {
  ADMIN_UNIT,
  FAKES_CATALOG,
  MODULE_CONFIG,
  SERVER_UNIT,
  YAML_MODULE_CONFIG,
} from "../../../testing/moduleConfig";
import { createWorkspace, packageJson, SOURCE_ALIASES } from "../../../testing/workspace";
import { doctor } from "../../doctor";
import { keysAt } from "../unitSchema";

let workspace: Workspace | undefined;
afterEach(() => workspace?.remove());

const setUp = (config: Record<string, string>) => {
  workspace = createWorkspace({
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    "apps/api/package.json": packageJson("@acme/api", "0.4.2"),
    "apps/api/shiplane.unit.yml": SERVER_UNIT,
    "apps/admin/package.json": packageJson("@acme/admin", "0.1.2"),
    "apps/admin/shiplane.unit.yml": ADMIN_UNIT,
    "shiplane/adapters/fakes.ts": FAKES_CATALOG,
    ...config,
  });
  return workspace;
};

const load = (root: string) => loadReleaseOnDisk(root, { aliases: SOURCE_ALIASES });

const yaml = (text: string) => setUp({ "shiplane.yml": text });

/** What `shiplane plugins --json` prints of a release, and what it ships in which order. */
const composed = (release: Release) => ({
  flow: [
    release.flow.sourceControl.name,
    release.flow.codeHost.name,
    release.flow.ciPipeline.name,
    release.flow.versioning.name,
    release.flow.approval,
  ],
  modules: release.modules.map(({ name, kind, provider, settings }) => ({
    name,
    kind,
    provider,
    keys: keysAt(settings, []),
  })),
  features: release.features.map(({ name }) => name),
  units: release.units.map(({ name, module, after }) => ({ name, module, after })),
  tagFormat: release.tagFormat,
  problems: release.problems,
});

describe("shiplane.yml beside shiplane.config.ts", () => {
  it("given the same release in TypeScript and in YAML, when each loads, then both compose the same flow, modules and units", async () => {
    const fromTs = await load(setUp({ "shiplane.config.ts": MODULE_CONFIG }).root);
    workspace?.remove();
    const fromYaml = await load(yaml(YAML_MODULE_CONFIG).root);

    expect(fromYaml.problems).toEqual([]);
    expect(composed(fromYaml)).toEqual(composed(fromTs));
    expect(fromYaml.configFile).toBe("shiplane.yml");
  });

  it("given both config files, when the release loads, then it names both and says how to keep one", async () => {
    const { root } = setUp({
      "shiplane.config.ts": MODULE_CONFIG,
      "shiplane.yml": YAML_MODULE_CONFIG,
    });

    const release = await load(root);

    expect(release.problems).toEqual([
      {
        file: "shiplane.yml",
        message: "shiplane.config.ts and shiplane.yml both hold the config: shiplane reads one",
        hint: "keep one; shiplane migrate writes shiplane.yml from shiplane.config.ts",
      },
    ]);
  });

  it("given an adapter name no catalog holds, when the release loads, then the problem has its line and the names it could be", async () => {
    const { root } = yaml(
      YAML_MODULE_CONFIG.replace(
        "staticHosting: ./shiplane/adapters/fakes.ts",
        "staticHosting: netlify",
      ),
    );

    const release = await load(root);

    expect(release.problems).toEqual([
      {
        file: "shiplane.yml",
        line: 12,
        message: 'no staticHosting adapter named "netlify"',
        // What it lists depends on the plugins installed where the test runs.
        hint: expect.stringMatching(
          /^name one of: .*\.\/shiplane\/adapters\/fakes\.ts; a plugin installed adds its own$/,
        ),
      },
    ]);
  });

  it("given an option the adapter does not take, when the release loads, then the problem names the key, its line and what it takes", async () => {
    const { root } = yaml(
      YAML_MODULE_CONFIG.replace(
        "  - use: web-app\n    with:\n",
        "  - use: web-app\n    with:\n      region: eu\n",
      ),
    );

    const release = await load(root);

    expect(release.problems).toEqual([
      {
        file: "shiplane.yml",
        line: 12,
        message: "web-app takes no region",
        hint: "it takes name, staticHosting",
      },
    ]);
  });

  it("given YAML that does not parse, when the release loads, then the problem has the line it breaks on", async () => {
    const { root } = yaml(`${YAML_MODULE_CONFIG}tag: [unclosed\n`);

    const release = await load(root);

    expect(release.problems).toEqual([expect.objectContaining({ file: "shiplane.yml", line: 14 })]);
  });

  it("given a key shiplane.yml does not hold, when the release loads, then it lists the keys it does", async () => {
    const { root } = yaml(`${YAML_MODULE_CONFIG}plugins: []\n`);

    const release = await load(root);

    expect(release.problems[0]).toMatchObject({
      line: 13,
      message: "plugins is not a key of shiplane.yml",
    });
  });

  it("given presets by name, when the release loads, then they mean what a TS config imports", async () => {
    const { root } = yaml(
      `${YAML_MODULE_CONFIG}tag: package\ntestComment: compact\ntestRelease: nightly\nvia: ci\n`,
    );

    const release = await load(root);

    expect(release.problems).toEqual([]);
    expect(release).toMatchObject({
      tagFormat: "{name}@{version}",
      testComment: "📦 Test version of `{branch}` ({commit}): {install}\n",
      testRelease: { main: "nightly" },
      via: "ci",
    });
  });

  it("given a local file the config names that does not exist, when the release loads, then it says use takes a path from the root", async () => {
    const { root } = yaml(
      YAML_MODULE_CONFIG.replace(
        "versioning: ./shiplane/adapters/fakes.ts",
        "versioning: ./shiplane/missing.ts",
      ),
    );

    const release = await load(root);

    expect(release.problems[0]).toMatchObject({
      file: "shiplane.yml",
      message: "./shiplane/missing.ts does not exist",
    });
  });

  it("given a repository with only shiplane.yml, when doctor runs, then it passes", async () => {
    const { root } = yaml(YAML_MODULE_CONFIG);
    const output = new MemoryOutput();

    const passed = await doctor({
      root,
      files: nodeFiles(root),
      shell: new RecordingShell(),
      prompter: new ScriptedPrompter(false),
      output,
      adapters: [],
      load: () => load(root),
    });

    expect(output.text).not.toContain("✗");
    expect(passed).toBe(true);
  });
});
