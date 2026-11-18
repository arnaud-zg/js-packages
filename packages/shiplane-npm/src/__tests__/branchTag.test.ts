import { RecordingShell, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { npmPackageRegistry } from "../npm-package-registry.adapter";

const KIT = testUnit("kit", {
  dir: "packages/kit",
  packageName: "kit-workspace",
  version: "0.6.0-feat-x.ae08284",
  module: "published-package",
});

const jobsFor = (options: Record<string, unknown>) =>
  npmPackageRegistry()
    .create({ root: "/repo", shell: new RecordingShell() })
    .jobs({
      unit: KIT,
      tag: "kit@0.6.0-feat-x.ae08284",
      environment: "preview",
      commit: "ae08284",
      defaultBranch: "main",
      options: { access: "public", tag: "latest", ...options },
      distTag: "feat-x",
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

  it("given a package published under another name, when a branch release is built, then it is renamed for the publish and back after", () => {
    const [job] = jobsFor({ publishAs: "@acme/kit" });

    expect(job?.local[0]?.args).toEqual(["pkg", "set", "name=@acme/kit"]);
    expect(job?.cleanup?.[0]?.args).toEqual(["pkg", "set", "name=kit-workspace"]);
  });
});

describe("the versions npm holds, for a numbered test release", () => {
  const versionsFrom = (reply: { status?: number; stdout?: string; stderr?: string }) => {
    const shell = new RecordingShell();
    shell.seed("npm view kit-workspace versions", reply);
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
    await expect(versionsFrom({ stdout: '["0.5.2","0.6.0-beta.0"]' })).resolves.toEqual([
      "0.5.2",
      "0.6.0-beta.0",
    ]);
  });

  it("given a single version published, when read, then npm's lone string is one version", async () => {
    await expect(versionsFrom({ stdout: '"0.5.2"' })).resolves.toEqual(["0.5.2"]);
  });

  it("given a package npm never got, when read, then none is listed", async () => {
    await expect(versionsFrom({ status: 1, stderr: "npm error code E404" })).resolves.toEqual([]);
  });
});

describe("a branch name too long for npm", () => {
  const fit = (slug: string) =>
    npmPackageRegistry().create({ root: "/repo", shell: new RecordingShell() }).fitSlug?.(slug);

  it("given a slug npm takes, when fitted, then it is kept", () => {
    expect(fit("feat-x")).toBe("feat-x");
  });

  it("given a slug too long, when fitted, then it keeps its start, ends in a hash and fits", () => {
    const slug = fit(`feat-${"a".repeat(300)}`) ?? "";

    expect(slug).toHaveLength(195);
    expect(slug).toMatch(/^feat-a+-[0-9a-f]{6}$/);
  });

  it("given two long slugs that differ only past the cut, when fitted, then they stay apart", () => {
    const start = "billing-".repeat(30);

    expect(fit(`${start}a`)).not.toBe(fit(`${start}b`));
  });
});
