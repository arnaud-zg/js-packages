import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Adapter, AdapterContext } from "../../ports/adapter.port";
import type { Release } from "../config/loadRelease";
import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import { RecordingProgress } from "../../adapters/terminal/__fakes__/progress.fake";
import { MemoryOutput } from "../../adapters/terminal/__fakes__/terminal.fake";
import { composeContext, composeServices, composeSetup, opener } from "../../cli/compose";
import { findRoot } from "../../cli/findRoot";
import { installedAdapters } from "../../cli/plugins";
import { TEST_FLOW } from "../../testing/flow";
import { fakeFlow } from "../../testing/memoryRepository";
import { SOURCE_ALIASES } from "../../testing/workspace";

// Running shiplane from anywhere in a repository: which folder it acts on, which installed provider
// plugins setup offers, and that every command works in that folder through its shell. Each case
// runs on a throwaway folder on disk.

const folders: string[] = [];
afterEach(() => {
  folders.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const folder = (files: Record<string, string> = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-modules-"));
  folders.push(root);
  Object.entries(files).forEach(([file, text]) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  });
  return root;
};

describe("Feature: running shiplane from any folder of the repository", () => {
  it("given a config two folders up, when the person runs shiplane from deep inside, then it acts on the config's folder", () => {
    const root = folder({ "shiplane.config.ts": "", "apps/api/src/index.ts": "" });

    expect(findRoot(path.join(root, "apps/api/src"))).toBe(root);
  });

  it("given a nested git repository under a config, when the person runs shiplane inside it, then it acts on the config's folder", () => {
    const root = folder({ "release.config.mjs": "", "inner/.git/HEAD": "", "inner/deep/x": "" });

    expect(findRoot(path.join(root, "inner/deep"))).toBe(root);
  });

  it("given a git repository with no config yet, when the person runs shiplane inside it, then it acts on the git root", () => {
    const root = folder({ "repo/.git/HEAD": "", "repo/apps/web/x": "" });

    expect(findRoot(path.join(root, "repo/apps/web"))).toBe(path.join(root, "repo"));
  });

  it("given a plain folder, when the person points shiplane at it by a relative path, then it acts on that folder", () => {
    const root = folder({ "plain/x": "" });
    const relative = path.relative(process.cwd(), path.join(root, "plain"));

    expect(findRoot(relative)).toBe(path.join(root, "plain"));
  });
});

const plugin = (name: string, manifest: object, code?: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: "index.mjs", ...manifest }),
  ...(code === undefined ? {} : { [`node_modules/${name}/index.mjs`]: code }),
});

describe("Feature: setup offering the provider plugins installed in the repository", () => {
  it("given a folder with no dependencies, when setup lists providers, then only the built-in shell provider is offered", async () => {
    const root = folder();

    expect((await installedAdapters(root)).map(({ name }) => name)).toEqual(["shell"]);
  });

  it("given provider plugins among the dependencies, when setup lists providers, then each working provider they declare is offered before the shell, and broken or missing ones are skipped", async () => {
    const root = folder({
      "package.json": JSON.stringify({
        name: "acme",
        dependencies: { "cloud-plugin": "1.0.0", "plain-lib": "1.0.0", "not-installed": "1.0.0" },
        devDependencies: { "pages-plugin": "1.0.0", "broken-plugin": "1.0.0" },
      }),
      ...plugin(
        "cloud-plugin",
        { shiplane: { adapters: ["cloudHosting", "notAFactory", "missingFactory"] } },
        `export const cloudHosting = () => ({ name: "cloud", capability: "server-hosting" });
export const notAFactory = 42;
`,
      ),
      ...plugin("plain-lib", {}, "export const cloudHosting = () => ({ name: 'plain' });\n"),
      ...plugin(
        "pages-plugin",
        { shiplane: { adapters: ["pagesHosting"] } },
        `export const pagesHosting = () => ({ name: "pages", capability: "static-hosting" });\n`,
      ),
      ...plugin(
        "broken-plugin",
        { shiplane: { adapters: ["broken"] } },
        "throw new Error('no');\n",
      ),
    });

    const names = (await installedAdapters(root)).map(({ name }) => name);

    expect(names).toEqual(["cloud", "pages", "shell"]);
  });

  it("given a dependency that declares no provider, when setup lists providers, then its code never runs", async () => {
    const root = folder({
      "package.json": JSON.stringify({ name: "acme", dependencies: { quiet: "1.0.0" } }),
      ...plugin("quiet", { shiplane: {} }, "globalThis.cliModulesQuietLoaded = true;\n"),
    });

    const names = (await installedAdapters(root)).map(({ name }) => name);

    expect(names).toEqual(["shell"]);
    expect((globalThis as Record<string, unknown>).cliModulesQuietLoaded).toBeUndefined();
  });
});

/** An adapter that keeps what it was created with. */
const recording = (name: string) => {
  const created: AdapterContext[] = [];
  const adapter: Adapter<{ name: string }> & { created: AdapterContext[] } = {
    name,
    create: (context) => {
      created.push(context);
      return { name };
    },
    created,
  };
  return adapter;
};

describe("Feature: every command acting on the repository through its shell", () => {
  it("given a repository and a shell, when a command opens a provider, then the provider works in that repository through that shell", () => {
    const shell = new RecordingShell();
    const adapter = recording("host");

    const port = opener("/repo", shell)(adapter);

    expect(port).toEqual({ name: "host" });
    expect(adapter.created).toEqual([{ root: "/repo", shell }]);
  });

  it("given a release flow, when a command starts, then source control, code host, CI and versioning each open from the flow's own provider", () => {
    const flow = fakeFlow();
    const release = { flow } as unknown as Release;
    const opened: string[] = [];
    const services = composeServices(release, (adapter) => {
      opened.push(adapter === flow.sourceControl ? "sourceControl" : adapter.name);
      return adapter.create({ root: "/repo", shell: new RecordingShell() });
    });

    expect(Object.keys(services)).toEqual([
      "sourceControl",
      "codeHost",
      "ciPipeline",
      "versioning",
    ]);
    expect(opened[0]).toBe("sourceControl");
    expect(opened).toHaveLength(4);
  });

  it("given a release and the flags typed, when a command starts, then its providers and file writes land in the release's folder through its shell, with those flags", () => {
    const root = folder();
    const shell = new RecordingShell();
    const output = new MemoryOutput();
    const release = {
      root,
      flow: fakeFlow(),
      appFlow: TEST_FLOW,
      modules: [],
      features: [],
      units: [],
      problems: [],
      tagFormat: "{name}@{version}",
    } as Release;
    const adapter = recording("host");

    const context = composeContext(
      release,
      { yes: true, display: { verbose: false, mascot: false } },
      { shell, output },
    );
    context.open(adapter);
    context.files.write("written.txt", "hi");

    expect(context.release).toBe(release);
    expect(context.shell).toBe(shell);
    expect(context.output).toBe(output);
    expect(context.options.yes).toBe(true);
    expect(adapter.created).toEqual([{ root, shell }]);
    expect(fs.readFileSync(path.join(root, "written.txt"), "utf8")).toBe("hi");
  });

  it("given a config that imports shiplane, when a command reloads the release, then the config loads and its apps are found", async () => {
    const root = folder({
      "package.json": JSON.stringify({ name: "acme", private: true, workspaces: ["apps/*"] }),
      "shiplane.config.ts": `import { backendService, defineRelease, releaseFlow } from "shiplane";
import { ciPipelineFake, codeHostFake, serverHostingFake, sourceControlFake, versioningFake } from "shiplane/testing";

export default defineRelease({ deployApps: { promote: [{ from: "staging", to: "prod" }] },
  flow: releaseFlow({
    sourceControl: sourceControlFake(),
    codeHost: codeHostFake(),
    ciPipeline: ciPipelineFake(),
    versioning: versioningFake(),
  }),
  modules: [backendService({ serverHosting: serverHostingFake() })],
});
`,
      "apps/api/package.json": JSON.stringify({ name: "@acme/api", version: "2.0.0" }),
      "apps/api/shiplane.unit.yml": "module: backend-service\nservice: api\n",
    });
    const progress = new RecordingProgress(new MemoryOutput());
    const release = { root, flow: fakeFlow(), modules: [], units: [] } as unknown as Release;

    const context = composeContext(
      release,
      { yes: false, display: {} },
      { shell: new RecordingShell(), progress, aliases: SOURCE_ALIASES },
    );
    const loaded = await context.load();

    expect(context.progress).toBe(progress);
    expect(context.options.yes).toBe(false);
    expect(loaded.problems).toEqual([]);
    expect(loaded.units.map(({ name, version }) => `${name}@${version}`)).toEqual(["api@2.0.0"]);
  });

  it("given a folder with no provider plugins, when setup starts, then it reads that folder's files and offers the shell provider", async () => {
    const root = folder({ "notes.txt": "kept" });

    const context = await composeSetup(root);

    expect(context.root).toBe(root);
    expect(context.files.read("notes.txt")).toBe("kept");
    expect(context.adapters.map(({ name }) => name)).toEqual(["shell"]);
  });

  it("given setup has written a release, when it runs that release's first command, then it answers yes for the person", async () => {
    const root = folder();
    const shell = new RecordingShell();
    const setupContext = await composeSetup(root, { shell, adapters: [] });
    const release = {
      root,
      flow: fakeFlow(),
      appFlow: TEST_FLOW,
      modules: [],
      features: [],
      units: [],
      problems: [],
      tagFormat: "{name}@{version}",
    } as Release;

    const context = setupContext.compose?.(release);

    expect(setupContext.shell).toBe(shell);
    expect(setupContext.adapters).toEqual([]);
    expect(context?.options.yes).toBe(true);
    expect(context?.release).toBe(release);
  });

  it("given a folder with no config, when setup reads the release, then it reports the missing config", async () => {
    const root = folder();
    const context = await composeSetup(root, { adapters: [] });

    const release = await context.load();

    expect(release.root).toBe(root);
    expect(release.problems.map(({ message }) => message)).toContain(
      "No shiplane.config.ts in this repository",
    );
  });
});
