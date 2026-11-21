import { afterEach, describe, expect, it } from "vitest";

import type { Workspace } from "../../testing/workspace";
import { tsConfig } from "../../adapters/config/ts-config.adapter";
import { nodeFiles } from "../../adapters/files/node-files.adapter";
import { MemoryOutput } from "../../adapters/terminal/__fakes__/terminal.fake";
import { loadReleaseFrom } from "../../cli/compose";
import { schemaCatalog } from "../../cli/plugins";
import {
  ADMIN_UNIT,
  FAKES_CATALOG,
  MIGRATABLE_CONFIG,
  MODULE_CONFIG,
  SERVER_UNIT,
} from "../../testing/moduleConfig";
import { createWorkspace, packageJson, SOURCE_ALIASES } from "../../testing/workspace";
import { migrate } from "../migrate";

let workspace: Workspace | undefined;
afterEach(() => workspace?.remove());

const run = async (files: Record<string, string>) => {
  workspace = createWorkspace({
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    "apps/api/package.json": packageJson("@acme/api", "0.4.2"),
    "apps/admin/package.json": packageJson("@acme/admin", "0.1.2"),
    "apps/admin/shiplane.unit.yml": ADMIN_UNIT,
    ...files,
  });
  const { root } = workspace;
  const ts = tsConfig({ aliases: SOURCE_ALIASES });
  const tsFile = ts.find(root);
  const output = new MemoryOutput();
  const before = await loadReleaseFrom(root, "ts", { aliases: SOURCE_ALIASES });
  const done = await migrate(
    { files: nodeFiles(root), output },
    {
      tsFile,
      declared: () => (tsFile ? ts.read(tsFile) : Promise.resolve(undefined)),
      catalog: await schemaCatalog(root, SOURCE_ALIASES),
      load: (from) => loadReleaseFrom(root, from, { aliases: SOURCE_ALIASES }),
    },
  );
  return { done, output, before, workspace };
};

describe("Feature: shiplane migrate", () => {
  it("given a TS config whose adapters a catalog names, when it migrates, then shiplane.yml releases the same and the TS config is gone", async () => {
    const {
      done,
      before,
      output,
      workspace: repo,
    } = await run({
      "shiplane.config.ts": MIGRATABLE_CONFIG,
      "shiplane/adapters/fakes.ts": FAKES_CATALOG,
      "apps/api/shiplane.unit.yml": SERVER_UNIT.replace(
        "module: backend-service",
        "module: api-eu",
      ),
    });

    expect(output.text).toContain(
      "Wrote shiplane.yml: the same release as shiplane.config.ts, which is removed",
    );
    expect(done).toBe(true);
    expect(repo.exists("shiplane.config.ts")).toBe(false);
    expect(repo.read("shiplane.yml"))
      .toBe(`# yaml-language-server: $schema=node_modules/.cache/shiplane/shiplane.schema.json
# How this repository releases, written by shiplane migrate from shiplane.config.ts.
flow:
  sourceControl: ./shiplane/adapters/fakes.ts
  codeHost: ./shiplane/adapters/fakes.ts
  ciPipeline: ./shiplane/adapters/fakes.ts
  versioning: ./shiplane/adapters/fakes.ts
modules:
  - use: backend-service
    with:
      name: api-eu
      serverHosting: ./shiplane/adapters/fakes.ts
  - use: web-app
    with:
      staticHosting: ./shiplane/adapters/fakes.ts
tag: plugin
testComment: compact
prepare: pnpm --filter {unit}... build
`);
    const after = await loadReleaseFrom(repo.root, "yaml", { aliases: SOURCE_ALIASES });
    expect(after.problems).toEqual([]);
    expect(after.units.map(({ name, module }) => [name, module])).toEqual(
      before.units.map(({ name, module }) => [name, module]),
    );
  });

  it("given a TS config with a function and adapters no catalog names, when it migrates, then it lists each one and writes nothing", async () => {
    const {
      done,
      output,
      workspace: repo,
    } = await run({
      "shiplane.config.ts": MODULE_CONFIG.replace(
        "export default defineRelease({\n  flow,",
        'export default defineRelease({\n  flow,\n  display: { mascot: () => "🦔" },',
      ),
      "apps/api/shiplane.unit.yml": SERVER_UNIT,
    });

    expect(done).toBe(false);
    expect(repo.exists("shiplane.yml")).toBe(false);
    expect(repo.exists("shiplane.config.ts")).toBe(true);
    expect(output.text).toContain(
      'flow.sourceControl  the sourceControl adapter "fake" is in no catalog',
    );
    expect(output.text).toContain(
      'modules[0].with.serverHosting  the serverHosting adapter "server" is in no catalog',
    );
    expect(output.text).toContain("display.mascot  is a function: YAML holds values only");
    expect(output.text).toContain("Nothing written");
  });

  it("given a shiplane.yml already, when it migrates, then it changes nothing", async () => {
    const { done, output } = await run({
      "shiplane.config.ts": MODULE_CONFIG,
      "shiplane.yml": "flow: {}\n",
    });

    expect(done).toBe(false);
    expect(output.text).toContain("shiplane.yml already exists");
  });
});
