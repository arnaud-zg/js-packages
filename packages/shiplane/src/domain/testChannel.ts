import { branchTag, branchVersion } from "./branchRelease";

/**
 * Where a test release publishes. `snapshot` is one temporary version per commit; any other word is
 * a numbered prerelease channel: `<next>-<word>.<n>` under the npm tag `<word>`.
 */
export const channels = {
  /**
   * `<next>-<branch>.<sha>` under the npm tag `snapshot`, such as `0.6.0-feat-x.ae08284` on `feat-x`:
   * one tag for every branch, so none piles up on npm; testers install the exact version.
   * One per commit, temporary: what every branch publishes unless `testRelease` says otherwise.
   */
  snapshot: "snapshot",
  /**
   * `<next>-nightly.<n>` under the npm tag `nightly`, such as `0.6.0-nightly.4`; `<n>` goes up by
   * one each publish. `npm i <package>@nightly` installs the newest.
   */
  nightly: "nightly",
  /**
   * `<next>-alpha.<n>` under the npm tag `alpha`, such as `0.6.0-alpha.0`; `<n>` goes up by one each
   * publish. `npm i <package>@alpha` installs the newest.
   */
  alpha: "alpha",
  /**
   * `<next>-beta.<n>` under the npm tag `beta`, such as `0.6.0-beta.2`; `<n>` goes up by one each
   * publish. `npm i <package>@beta` installs the newest.
   */
  beta: "beta",
  /**
   * `<next>-rc.<n>` under the npm tag `rc`, such as `0.6.0-rc.1`; `<n>` goes up by one each publish.
   * `npm i <package>@rc` installs the newest.
   */
  rc: "rc",
} as const;

/**
 * A test release channel: `snapshot`, one of the numbered `channels`, or any word of your own
 * (`[a-z][a-z0-9-]*`, never `latest`), which publishes `<next>-<word>.<n>` under the npm tag `<word>`.
 */
export type Channel = (typeof channels)[keyof typeof channels] | (string & {});

/**
 * Which channel each branch's test release publishes on. A key is a branch name, or a pattern such
 * as `release/*`: the exact name wins, then the longest pattern. A branch not listed publishes a
 * `snapshot`.
 */
export type TestReleaseBranches = Readonly<Record<string, Channel>>;

/** Ready branch → channel maps for `testRelease`; each is a plain map, spread it to change it. */
export const testReleases = {
  /**
   * `main` → nightly; every other branch → snapshot.
   * @example main publishes 0.6.0-nightly.4 under the npm tag `nightly`.
   */
  nightly: { main: "nightly" },
  /**
   * One channel per long-lived branch: `main` → nightly, `next` → alpha, `beta` → beta,
   * `release/*` → rc; every other branch → snapshot.
   * @example release/1.0 publishes 1.0.0-rc.0 under the npm tag `rc`.
   */
  prerelease: { main: "nightly", next: "alpha", beta: "beta", "release/*": "rc" },
  /**
   * Git-flow: `develop` → nightly, `release/*` → beta, `hotfix/*` → rc; every other branch → snapshot.
   * @example develop publishes 0.6.0-nightly.4 under the npm tag `nightly`.
   */
  gitflow: { develop: "nightly", "release/*": "beta", "hotfix/*": "rc" },
} as const satisfies Record<string, TestReleaseBranches>;

const CHANNEL_NAME = /^[a-z][a-z0-9-]*$/;
// npm refuses a dist-tag it can read as a semver range.
const SEMVER_RANGE = /^v?(\d+|x)$/;

/** Why a channel name cannot be one, or null when it can. */
export const channelProblem = (name: string): string | null => {
  if (name === "latest") return "latest is the real release's tag, never a test release's";
  if (!CHANNEL_NAME.test(name) || SEMVER_RANGE.test(name)) {
    return `"${name}" is not a channel: a lowercase word such as beta, [a-z][a-z0-9-]*`;
  }
  return null;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const patternOf = (key: string) => new RegExp(`^${key.split("*").map(escape).join(".*")}$`);

/** The channel a branch publishes on: its exact name, else its longest matching pattern, else snapshot. */
export const channelFor = (branch: string, branches: TestReleaseBranches = {}): Channel => {
  const exact = branches[branch];
  if (exact !== undefined) return exact;
  const [match] = Object.keys(branches)
    .filter((key) => key.includes("*") && patternOf(key).test(branch))
    .sort((left, right) => right.length - left.length);
  return (match === undefined ? undefined : branches[match]) ?? channels.snapshot;
};

/** Whether a channel numbers its versions: every one but snapshot. */
export const isNumbered = (channel: Channel) => channel !== channels.snapshot;

/** The next free `<n>` of `<next>-<channel>.<n>`, from the versions the registry already holds. */
export const nextNumber = ({
  published,
  next,
  channel,
}: {
  published: readonly string[];
  next: string;
  channel: Channel;
}) => {
  const numbered = new RegExp(`^${escape(next)}-${escape(channel)}\\.(\\d+)$`);
  return published.reduce((free, version) => {
    const taken = numbered.exec(version)?.[1];
    return taken === undefined ? free : Math.max(free, Number(taken) + 1);
  }, 0);
};

/** The version a test release publishes: a snapshot of the commit, or the channel's numbered one. */
export const testVersion = ({
  next,
  channel,
  branch,
  sha,
  n,
}: {
  next: string;
  channel: Channel;
  branch: string;
  sha: string;
  n: number;
}) =>
  isNumbered(channel) ? `${next}-${channel}.${n}` : branchVersion({ current: next, branch, sha });

/**
 * The npm tag a test release publishes under: its channel, `snapshot` included, never the branch, so
 * a branch leaves no tag of its own behind on npm.
 */
export const testTag = (channel: Channel) => branchTag(channel);
