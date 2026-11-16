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
