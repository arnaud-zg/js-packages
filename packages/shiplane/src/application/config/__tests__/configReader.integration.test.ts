import { describe, expect, it } from "vitest";

import { ciPipelineFake } from "../../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { codeHostFake } from "../../../adapters/code-host/__fakes__/code-host.fake";
import { memoryConfig } from "../../../adapters/config/__fakes__/memory-config.fake";
import { packageRegistryFake } from "../../../adapters/package-registry/__fakes__/package-registry.fake";
import { sourceControlFake } from "../../../adapters/source-control/__fakes__/source-control.fake";
import { versioningFake } from "../../../adapters/versioning/__fakes__/versioning.fake";
import { publishedPackage } from "../../../modules/published-package/published-package.module";
import { releaseFlow } from "../../releaseFlow";
import { defineRelease } from "../defineRelease";
import { loadRelease } from "../loadRelease";

const root = "/repo";
const noManifests = { read: () => null };

const declared = () =>
  defineRelease({
    flow: releaseFlow({
      sourceControl: sourceControlFake(),
      codeHost: codeHostFake(),
      ciPipeline: ciPipelineFake(),
      versioning: versioningFake(),
    }),
    modules: [publishedPackage({ packageRegistry: packageRegistryFake() })],
    units: [],
    tag: "v{version}",
  });

describe("reading the config through its port", () => {
  it("given a config its reader holds in memory, when the release loads, then it composes from what the reader read", async () => {
    const config = memoryConfig(declared());

    const release = await loadRelease(root, { configs: [config], manifests: noManifests });

    expect(release.problems).toEqual([]);
    expect(config.reads).toEqual(["/repo/shiplane.config.ts"]);
    expect(release.modules.map(({ name }) => name)).toEqual(["published-package"]);
    expect(release.flow.versioning.name).toBe(versioningFake().name);
    expect(release.tagFormat).toBe("v{version}");
  });

  it("given a reader that finds no config, when the release loads, then it says setup writes one", async () => {
    const release = await loadRelease(root, {
      configs: [memoryConfig(undefined)],
      manifests: noManifests,
    });

    expect(release.problems).toEqual([
      expect.objectContaining({ message: "No shiplane.config.ts in this repository" }),
    ]);
  });

  it("given a config that does not load, when the release loads, then the problem names the file and the first line of why", async () => {
    const config = memoryConfig(new Error("Unexpected token\n  at line 3"), {
      file: "shiplane.config.mts",
    });

    const release = await loadRelease(root, { configs: [config], manifests: noManifests });

    expect(release.problems).toEqual([
      { file: "shiplane.config.mts", message: "it did not load: Unexpected token" },
    ]);
  });

  it("given two readers that each find a config, when the release loads, then it names both and says to keep one", async () => {
    const configs = [memoryConfig(declared()), memoryConfig(declared(), { file: "shiplane.yml" })];

    const release = await loadRelease(root, { configs, manifests: noManifests });

    expect(release.problems).toEqual([
      {
        file: "shiplane.yml",
        message: "shiplane.config.ts and shiplane.yml both hold the config: shiplane reads one",
        hint: "keep one; shiplane migrate writes shiplane.yml from shiplane.config.ts",
      },
    ]);
    expect(configs.flatMap(({ reads }) => reads)).toEqual([]);
  });

  it("given a config whose declaration is not a release, when the release loads, then the check refuses it whatever read it", async () => {
    const release = await loadRelease(root, {
      configs: [memoryConfig(42)],
      manifests: noManifests,
    });

    expect(release.problems[0]?.message).toContain("is not defineRelease");
  });
});
