import { RecordingShell, TEST_FLOW, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { npmPackageRegistry } from "../npm-package-registry.adapter";

const KIT = testUnit("kit", {
  dir: "packages/kit",
  packageName: "kit-workspace",
  version: "0.6.0",
  module: "published-package",
});

const input = (options: Record<string, unknown> = {}) => ({
  unit: KIT,
  tag: "kit@0.6.0",
  environment: "staging" as const,
  flow: TEST_FLOW,
  commit: "ae08284",
  defaultBranch: "main",
  options: { access: "public", tag: "latest", ...options },
});

const tagsFrom = (reply: { status?: number; stdout?: string }) => {
  const shell = new RecordingShell();
  shell.seed("npm view kit-workspace dist-tags time --json", reply);
  const port = npmPackageRegistry().create({ root: "/repo", shell });
  return port.tags?.({ shell } as never, input());
};

describe("the dist-tags npm holds, for prune-snapshots", () => {
  it("given tags and publish times, when read, then each tag comes with its version's publish time", async () => {
    const stdout = JSON.stringify({
      "dist-tags": { latest: "0.5.2", "feat-x": "0.6.0-feat-x.ae08284" },
      time: { "0.5.2": "2026-09-01T00:00:00.000Z" },
    });

    await expect(tagsFrom({ stdout })).resolves.toEqual([
      { tag: "latest", version: "0.5.2", publishedAt: "2026-09-01T00:00:00.000Z" },
      { tag: "feat-x", version: "0.6.0-feat-x.ae08284", publishedAt: null },
    ]);
  });

  it("given a package npm never got, when read, then there are no tags", async () => {
    await expect(tagsFrom({ status: 1 })).resolves.toEqual([]);
  });
});

describe("removing a dist-tag", () => {
  const port = npmPackageRegistry().create({ root: "/repo", shell: new RecordingShell() });

  it("given a one-time code, when the job is built, then npm dist-tag rm gets it", () => {
    const job = port.untagJob?.(input({ publishAs: "@acme/kit" }), "feat-x", "123456");

    expect(job?.label).toBe("remove the feat-x tag from @acme/kit");
    expect(job?.local).toEqual([
      { command: "npm", args: ["dist-tag", "rm", "@acme/kit", "feat-x", "--otp=123456"] },
    ]);
  });

  it("given no code, when the job is built, then npm asks for one itself if it needs it", () => {
    expect(port.untagJob?.(input(), "feat-x").local[0]?.args).toEqual([
      "dist-tag",
      "rm",
      "kit-workspace",
      "feat-x",
    ]);
  });
});
