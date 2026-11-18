import type { ServiceAdapter } from "../../ports/adapter.port";
import type { CiPipelinePort } from "../../ports/ci-pipeline.port";
import type { Release } from "../config/loadRelease";
import type { SetupContext } from "../setupContext";
import { CiPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { SHIP_YML } from "./shipWorld";

export { SHIP_YML };

/** A caller workflow pinned to `version`'s commit, standing in for the one GitHub's adapter writes. */
export const callerFor = (version: string, sha = `sha-${version}`) =>
  [
    "name: Ship",
    "on: workflow_dispatch",
    "jobs:",
    "  ship:",
    `    uses: acme/shiplane/.github/workflows/shiplane-ship.yml@${sha} # shiplane@${version}`,
    "    secrets: inherit",
    "",
  ].join("\n");

/** A CI pipeline that writes the caller workflow for each released version, and asks gh nothing. */
export const callingPipeline = (released: readonly string[]): ServiceAdapter<CiPipelinePort> => ({
  name: "calling",
  create: () =>
    Object.assign(new CiPipelineFake(), {
      callerWorkflow: (version: string) =>
        Promise.resolve(
          released.includes(version)
            ? { file: SHIP_YML, content: callerFor(version), pin: `sha-${version}` }
            : { error: `no release tag shiplane@${version}: pin shiplane-ship.yml by hand` },
        ),
    }),
});

/** The context with shiplane `version` running and its release shipping through `pipeline`. */
export const runningShiplane = (
  context: SetupContext,
  version: string,
  pipeline: ServiceAdapter<CiPipelinePort> = callingPipeline([version]),
): SetupContext => ({
  ...context,
  version,
  load: async (): Promise<Release> => {
    const release = await context.load();
    return { ...release, flow: { ...release.flow, ciPipeline: pipeline } };
  },
});
