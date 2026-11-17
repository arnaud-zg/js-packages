import type { Workspace } from "shiplane/testing";
import { createWorkspace, loadRelease, packageJson } from "shiplane/testing";
import { afterEach, describe, expect, it } from "vitest";

import { PLUGIN_ALIASES } from "../aliases";

let workspace: Workspace | undefined;
afterEach(() => workspace?.remove());

describe("a config with no flow", () => {
  it("given the default plugins installed, when the release loads, then it runs on git, GitHub, GitHub Actions and Changesets", async () => {
    workspace = createWorkspace({
      "package.json": JSON.stringify({ name: "acme", private: true }),
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "shiplane.config.ts": `import { defineRelease, internalTool } from "shiplane";

export default defineRelease({ modules: [internalTool()] });
`,
      "packages/cli/package.json": packageJson("@acme/cli", "0.1.0"),
      "packages/cli/shiplane.unit.yml": "module: internal-tool\n",
    });

    const release = await loadRelease(workspace.root, { aliases: PLUGIN_ALIASES });

    expect(release.problems).toEqual([]);
    const { sourceControl, codeHost, ciPipeline, versioning } = release.flow;
    expect([sourceControl, codeHost, ciPipeline, versioning].map(({ name }) => name)).toEqual([
      "git",
      "github",
      "github-actions",
      "changesets",
    ]);
  });
});
