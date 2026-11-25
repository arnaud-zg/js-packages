import type { ServiceAdapter } from "../../ports/adapter.port";
import type { CallerNeeds, CiPipelinePort } from "../../ports/ci-pipeline.port";
import type { Release } from "../config/loadRelease";
import type { SetupContext } from "../setupContext";
import { CiPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { SHIP_YML } from "./shipWorld";

export { SHIP_YML };

const NOTHING: CallerNeeds = { secrets: [], features: [] };

/**
 * A caller workflow pinned to `version`'s commit, passing the secrets `needs` names, standing in
 * for the one a real adapter writes.
 */
export const callerFor = (version: string, needs = NOTHING, sha = `sha-${version}`) =>
  [
    "name: Ship",
    "on: workflow_dispatch",
    "permissions:",
    `  contents: ${needs.permissions?.contents ?? "read"}`,
    ...(needs.features.includes("release-comments") ? ["  issues: write"] : []),
    "jobs:",
    "  ship:",
    ...(needs.variables ? ["    env:"] : []),
    ...(needs.variables ?? []).map((name) => `      ${name}: \${{ vars.${name} }}`),
    "    steps:",
    `      - uses: acme/shiplane/.github/actions/ship@${sha} # shiplane@${version}`,
    "        with:",
    "          environment: preview",
    ...needs.secrets.map((name) => `          ${name}: \${{ secrets.${name} }}`),
    "",
  ].join("\n");

/** A CI pipeline that writes the caller workflow for each released version, and asks no host anything. */
export const callingPipeline = (released: readonly string[]): ServiceAdapter<CiPipelinePort> => ({
  name: "calling",
  create: () =>
    Object.assign(new CiPipelineFake(), {
      callerWorkflow: (version: string, needs: CallerNeeds) =>
        Promise.resolve(
          released.includes(version)
            ? { file: SHIP_YML, content: callerFor(version, needs), pin: `sha-${version}` }
            : { error: `no release tag shiplane@${version}: pin ship.yml by hand` },
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
