import type { Environment } from "../domain/environment";
import type { TaggedVersion } from "../domain/snapshotTags";
import type { DecideContext, Decision, Delivery, Job, JobInput } from "./delivery.port";

/** Publishes a package and points a dist-tag at it: npm today. */
export interface PackageRegistryPort<Options = Record<string, unknown>> extends Delivery<Options> {
  readonly capability: "package-registry";
  /** Publish, move a tag, or nothing: the registry, not GitHub Deployments, knows what is out. */
  decide(context: DecideContext, input: JobInput<Options>): Promise<Decision>;
  /**
   * Whether preview publishes the package under a tag of its own before production; without it, it
   * does. When false, the package goes straight to production.
   */
  stages?(options: Record<Environment, Options>): boolean;
  /** The name it publishes the app under, when a rename it is told differs from the workspace name. */
  publishedName?(input: JobInput<Options>): string;
  /**
   * Every version of the package the registry ever took, unpublished ones included, for a test
   * release to number its next one without reusing a number the registry refuses.
   * Without it, a test release only publishes snapshots.
   */
  publishedVersions?(context: DecideContext, input: JobInput<Options>): Promise<string[]>;
  /**
   * Every dist-tag of the package, with when its version was published, for
   * `shiplane prune-snapshots`. Without it, that command skips the package.
   */
  tags?(context: DecideContext, input: JobInput<Options>): Promise<TaggedVersion[]>;
  /** The job that removes one dist-tag; `otp` is the one-time code a two-factor account asks for. */
  untagJob?(input: JobInput<Options>, tag: string, otp?: string): Job;
  /** The version is out on the environment: published, and its dist-tag points at it. */
  live(context: DecideContext, input: JobInput<Options>): Promise<boolean>;
}
