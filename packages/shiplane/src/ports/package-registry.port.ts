import type { DecideContext, Decision, Delivery, JobInput } from "./delivery.port";

/** Publishes a package and points a dist-tag at it: npm today. */
export interface PackageRegistryPort<Options = Record<string, unknown>> extends Delivery<Options> {
  readonly capability: "package-registry";
  /** Publish, move a tag, or nothing: the registry, not GitHub Deployments, knows what is out. */
  decide(context: DecideContext, input: JobInput<Options>): Promise<Decision>;
  /** The name it publishes the app under, when a rename it is told differs from the workspace name. */
  publishedName?(input: JobInput<Options>): string;
  /**
   * Every version of the package the registry holds, for a test release to number its next one.
   * Without it, a test release only publishes snapshots.
   */
  publishedVersions?(context: DecideContext, input: JobInput<Options>): Promise<string[]>;
  /** A branch slug the registry cannot take whole, shortened; absent, it takes any length. */
  fitSlug?(slug: string): string;
  /** The version is out on the environment: published, and its dist-tag points at it. */
  live(context: DecideContext, input: JobInput<Options>): Promise<boolean>;
}
