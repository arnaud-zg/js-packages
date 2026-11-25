import type { DisplayChoice } from "../../domain/display";
import type { Environment } from "../../domain/environment";
import type { TagFormatName } from "../../domain/tags";
import type { Channel, TestReleaseBranches } from "../../domain/testChannel";
import type { Feature, ReleaseFlow, ReleaseModule } from "../../modules/module";

/** One step of an app's way to its users. Each name is yours. */
export interface PromoteStep {
  /** Where the version runs; of the first step, where a release deploys. */
  from?: Environment;
  /** Where a promote takes it; of the last step, where users are. */
  to?: Environment;
}

/** How apps are deployed. */
export interface DeployApps {
  /**
   * The steps in order, each starting where the one before ends:
   * `[{ from: "preview", to: "production" }]` when unset. A lone `{ to: "production" }` deploys
   * straight there; a lone `{ from: "preview" }` never promotes. A mobile app on EAS takes only
   * preview and production.
   */
  promote?: readonly PromoteStep[];
  /**
   * Where any branch may deploy to try a change, outside the steps, or `false` or unset for nowhere.
   * A test release on a branch then deploys its pending apps there from this machine, asked first,
   * over what runs there until the next release. Never where users are; EAS is left out.
   */
  onBranch?: Environment | false | undefined;
}

/** How packages are published. */
export interface PublishPackages {
  /**
   * The channels they publish on, from the earliest to the release:
   * `["nightly", "alpha", "beta", "rc", "live"]`. Each publishes by itself, a version is never moved
   * from one to the next. Any channel when unset.
   */
  channels?: readonly Channel[];
  /**
   * What any branch may publish to try a change, outside the channels: `"snapshot"` when unset,
   * `false` for nothing.
   */
  onBranch?: "snapshot" | false | undefined;
}

/** How a repository releases: the flow, what gets released in order, and what happens around it. */
export interface ReleaseConfig {
  /** Folders to look in, `dir/*` or exact. Without it, the workspace file decides. */
  units?: string[];
  /** How the release itself runs: an adapter per port, each from its plugin. */
  flow: ReleaseFlow;
  /** What gets released, in this order. The first app is the repository's Latest release. */
  modules: ReleaseModule[];
  /** What happens around a release, after the ship, in this order. */
  features?: Feature[];
  /**
   * How a tag names a version: `"package"` (`{name}@{version}`, the default), `"plugin"` (`{name}--v{version}`), `"single"` (`v{version}`, one unit only), `"module"` (`{name}/v{version}`), or a format of your own.
   */
  tag?: TagFormatName | (string & {});
  /** How much the release says while it runs; `--verbose` and `--mascot` (or `--no-…`) override. */
  display?: DisplayChoice;
  /**
   * The pull request comment of a test version (`shiplane test-release`): `comments.table` (the default),
   * `comments.compact`, or text of your own with `{branch}`, `{commit}`, `{table}` and `{install}`.
   */
  testComment?: string;
  /**
   * Which channel each branch's test release (`shiplane test-release`) publishes on: a preset such
   * as `testReleases.gitflow`, or a map such as `{ main: channels.nightly, "release/*": channels.beta }`.
   * A key is a branch or a `*` pattern; a branch not listed publishes a snapshot. Without it, every
   * branch does. `shiplane test-release <channel>` picks another for one run.
   */
  testRelease?: TestReleaseBranches;
  /** How deployed apps reach their users. Not for packages, published or internal. */
  deployApps?: DeployApps;
  /** How packages are published. Not for apps, nor for internal packages. */
  publishPackages?: PublishPackages;
  /**
   * How a unit ships when both ways can: `"ci"` (the flow's CI pipeline, such as GitHub Actions) or
   * `"local"` (this machine). Without it, each ship asks. `--via` still wins for one run; a way that
   * cannot ship takes the other.
   */
  via?: "ci" | "local";
  /**
   * A shell command run from the root before each unit ships from this machine (a laptop or a
   * runner), never before a CI dispatch: `{unit}` is the unit's name, `{dir}` its folder from the
   * root, such as `"pnpm --filter {unit}... build"`. A failure fails that unit.
   */
  prepare?: string;
}

export const defineRelease = (config: ReleaseConfig): ReleaseConfig => config;
