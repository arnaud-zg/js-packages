import { RecordingShell, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { npmPackageRegistry } from "../npm-package-registry.adapter";

const KIT = testUnit("kit", {
  dir: "packages/kit",
  packageName: "kit-workspace",
  version: "0.6.0-feat-x.ae08284",
  module: "published-package",
});

const jobsFor = (
  options: Record<string, unknown>,
  input: { distTag?: string; dropTag?: boolean } = { distTag: "feat-x" },
) =>
  npmPackageRegistry()
    .create({ root: "/repo", shell: new RecordingShell() })
    .jobs({
      unit: KIT,
      tag: "kit@0.6.0-feat-x.ae08284",
      environment: "preview",
      commit: "ae08284",
      defaultBranch: "main",
      options: { access: "public", tag: "latest", ...options },
      ...input,
    });

describe("publishing a branch release to npm", () => {
  it("given a dist-tag for the branch, when its jobs are built, then it publishes once under that tag and moves no other", () => {
    const jobs = jobsFor({});

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.label).toBe("publish kit-workspace@0.6.0-feat-x.ae08284 under feat-x");
    expect(jobs[0]?.local.at(-1)?.args).toEqual([
      "publish",
      "--no-git-checks",
      "--access",
      "public",
      "--tag",
      "feat-x",
    ]);
  });

  it("given a tag to drop, when its jobs are built, then it publishes under the tag and removes it after", () => {
    const [job] = jobsFor({}, { distTag: "snapshot", dropTag: true });

    expect(job?.label).toBe("publish kit-workspace@0.6.0-feat-x.ae08284, no tag kept");
    expect(job?.local.map(({ command, args }) => [command, ...args].join(" "))).toEqual([
      "pnpm publish --no-git-checks --access public --tag snapshot",
      "npm dist-tag rm kit-workspace snapshot",
    ]);
  });

  it("given a package published under another name, when a branch release is built, then it is renamed for the publish and back after", () => {
    const [job] = jobsFor({ publishAs: "@acme/kit" });

    expect(job?.local[0]?.args).toEqual(["pkg", "set", "name=@acme/kit"]);
    expect(job?.cleanup?.[0]?.args).toEqual(["pkg", "set", "name=kit-workspace"]);
  });
});

describe("the versions npm holds, for a numbered test release", () => {
  const versionsFrom = (reply: { status?: number; stdout?: string; stderr?: string }) => {
    const shell = new RecordingShell();
    shell.seed("npm view kit-workspace time", reply);
    const port = npmPackageRegistry().create({ root: "/repo", shell });
    return port.publishedVersions?.({ shell } as never, {
      unit: KIT,
      tag: "kit@0.6.0",
      environment: "preview",
      commit: "ae08284",
      defaultBranch: "main",
      options: { access: "public", tag: "latest" },
    });
  };

  it("given several versions published, when read, then each is listed", async () => {
    await expect(
      versionsFrom({
        stdout: JSON.stringify({
          created: "2026-11-01T10:00:00.000Z",
          "0.5.2": "2026-11-01T10:00:00.000Z",
          "0.6.0-beta.0": "2026-11-02T10:00:00.000Z",
          modified: "2026-11-02T10:00:00.000Z",
        }),
      }),
    ).resolves.toEqual(["0.5.2", "0.6.0-beta.0"]);
  });

  it("given a version published then unpublished, when read, then it is still listed, as npm never takes its number again", async () => {
    // npm view versions drops 0.6.0-nightly.0 once unpublished; its time entry stays.
    await expect(
      versionsFrom({
        stdout: JSON.stringify({
          "0.6.0-nightly.0": "2026-11-18T20:12:56.765Z",
          "0.6.0-rc.0": "2026-11-19T18:36:19.837Z",
        }),
      }),
    ).resolves.toEqual(["0.6.0-nightly.0", "0.6.0-rc.0"]);
  });

  it("given a package npm never got, when read, then none is listed", async () => {
    await expect(versionsFrom({ status: 1, stderr: "npm error code E404" })).resolves.toEqual([]);
  });
});
