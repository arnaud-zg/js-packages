import type { DeployFlow, Environment } from "./environment";
import { previousOf } from "./environment";

export type RegistryShip =
  "not-released" | "not-on-previous" | "moved-past" | "publish" | "on-tag" | "move-tag";

/**
 * What a package registry reads, each fact only once the decision needs it: a read costs a call to
 * the registry or to git.
 */
export interface RegistryFacts {
  /** The release tag exists. */
  tagged: () => Promise<boolean>;
  /** The registry holds this version. */
  published: () => Promise<boolean>;
  /** The checkout differs from the tag by version files at most. */
  sinceTagOnlyVersionFiles: () => Promise<boolean>;
  /** The environment's dist-tag already names this version. */
  onDistTag: () => Promise<boolean>;
}

/**
 * What one tagged package version still needs on an environment. A later one only moves its tag to
 * what the one before published, and a publish ships this checkout, so only while it is the tagged code.
 */
export const registryDecision = async ({
  environment,
  flow,
  facts,
}: {
  environment: Environment;
  flow: DeployFlow;
  facts: RegistryFacts;
}): Promise<RegistryShip> => {
  if (!(await facts.tagged())) return "not-released";
  if (await facts.published()) return (await facts.onDistTag()) ? "on-tag" : "move-tag";
  if (previousOf(flow, environment) !== null) return "not-on-previous";
  return (await facts.sinceTagOnlyVersionFiles()) ? "publish" : "moved-past";
};
