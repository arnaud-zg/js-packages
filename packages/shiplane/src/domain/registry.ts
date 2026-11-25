import type { Environment } from "./environment";

export type RegistryShip =
  | "not-released"
  | "no-preview"
  | "not-on-preview"
  | "moved-past"
  | "publish"
  | "on-tag"
  | "move-tag";

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
 * What one tagged package version still needs on an environment. Staged, production only moves its
 * tag to what preview published; else it goes straight to production. A publish ships this checkout, so only while it is the tagged code.
 */
export const registryDecision = async ({
  environment,
  stages = true,
  facts,
}: {
  environment: Environment;
  /** Preview publishes it under a tag of its own first. */
  stages?: boolean;
  facts: RegistryFacts;
}): Promise<RegistryShip> => {
  if (!(await facts.tagged())) return "not-released";
  if (!stages && environment === "preview") return "no-preview";
  if (await facts.published()) return (await facts.onDistTag()) ? "on-tag" : "move-tag";
  if (stages && environment === "production") return "not-on-preview";
  return (await facts.sinceTagOnlyVersionFiles()) ? "publish" : "moved-past";
};
