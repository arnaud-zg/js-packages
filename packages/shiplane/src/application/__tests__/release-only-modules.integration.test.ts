import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppInput } from "../../modules/module";
import { agentPlugin } from "../../modules/agent-plugin/agent-plugin.module";
import { internalTool } from "../../modules/internal-tool/internal-tool.module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { decideContext } from "../targets";

// Apps that ship by their tag alone: what the person is told about where they land, and the version
// an agent plugin's release PR moves in its manifests, on a real folder.

const PLUGIN = testUnit("reviewer", { dir: "plugins/reviewer", module: "agent-plugin" });

const folders: string[] = [];
afterEach(() => {
  folders.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const repository = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-modules-plugin-"));
  folders.push(root);
  Object.entries(files).forEach(([file, text]) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  });
  return root;
};

const input = (extra: object = {}): AppInput & { bump: undefined } => ({
  unit: PLUGIN,
  tag: "reviewer@0.1.0",
  environment: "preview",
  options: {},
  commit: "c1",
  defaultBranch: "main",
  bump: undefined,
  ...extra,
});

describe("Feature: releasing an internal tool by its tag alone", () => {
  it("given an internal tool, when its ship is planned, then the person sees it lands on its tag and release notes and nothing deploys", () => {
    const module = internalTool();

    expect(module).toMatchObject({
      type: "module",
      name: "internal-tool",
      kind: "internal-tool",
      provider: "release-only",
      releaseOnly: true,
    });
    expect(module.adapters).toEqual([]);
    expect(module.ship(decideContext(testContext({ units: [] }).context), input())).toEqual({
      where: "its tag and release notes, nothing deploys it",
      jobs: [],
    });
  });
});

describe("Feature: releasing an agent plugin through its manifests", () => {
  it("given an agent plugin, when its ship is planned, then the person sees agents install it from the repository and nothing deploys", () => {
    const module = agentPlugin({ name: "skills" });

    expect(module).toMatchObject({
      type: "module",
      name: "skills",
      kind: "agent-plugin",
      provider: "marketplace",
    });
    expect(module.adapters).toEqual([]);
    expect(module.ship(decideContext(testContext({ units: [] }).context), input())).toEqual({
      where: "its tag and release notes; agents install it from the repository",
      jobs: [],
    });
  });

  it("given a release with no bump for the plugin, when the release PR is prepared, then no manifest changes", async () => {
    const root = repository({
      "plugins/reviewer/.claude-plugin/plugin.json": '{"version":"0.1.0"}',
    });
    const context = decideContext(testContext({ units: [PLUGIN], root }).context);

    expect(await agentPlugin().version?.(context, input())).toEqual({
      added: [],
      writes: [],
      summary: [],
      onMerge: "",
    });
  });

  it("given a minor bump, when the release PR is prepared, then every manifest the plugin has moves to the new version and keeps its layout", async () => {
    const root = repository({
      "plugins/reviewer/.claude-plugin/plugin.json":
        '{\n  "name": "reviewer",\n  "version": "0.1.0"\n}\n',
      "plugins/reviewer/gemini-extension.json": '{"version":"0.1.0"}',
    });
    const context = decideContext(testContext({ units: [PLUGIN], root }).context);
    const bump = { from: "0.1.0", to: "0.2.0", type: "minor" };

    const contribution = await agentPlugin().version?.(context, input({ bump }));
    for (const write of contribution?.writes ?? []) await write.run();

    expect(contribution?.summary).toEqual([]);
    expect(contribution?.writes.map(({ label }) => label)).toEqual([
      "plugins/reviewer/.claude-plugin/plugin.json → 0.2.0",
      "plugins/reviewer/gemini-extension.json → 0.2.0",
    ]);
    expect(
      fs.readFileSync(path.join(root, "plugins/reviewer/.claude-plugin/plugin.json"), "utf8"),
    ).toBe('{\n  "name": "reviewer",\n  "version": "0.2.0"\n}\n');
  });
});
