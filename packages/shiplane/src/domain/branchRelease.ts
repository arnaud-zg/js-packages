const SHORT_SHA = 7;
// npm refuses a dist-tag it can read as a semver range; from [a-z0-9-] only these parse as one.
const SEMVER_RANGE = /^v?(\d+|x)$/;
// A numeric prerelease identifier with a leading zero is not valid semver.
const LEADING_ZERO_NUMBER = /^0\d+$/;

/** The marker a branch release's pull request comment opens with, to find it again. */
export const BRANCH_COMMENT_MARKER = "<!-- shiplane:branch-release -->";

/** A branch name as a version and a tag take it: `feat/X_y` reads `feat-x-y`. */
export const branchSlug = (branch: string) =>
  branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "branch";

const identifier = (text: string) => (LEADING_ZERO_NUMBER.test(text) ? `g${text}` : text);

/** `<current>-<slug>.<short sha>`: the version testers install, never one a release takes. */
export const branchVersion = ({
  current,
  branch,
  sha,
}: {
  current: string;
  branch: string;
  sha: string;
}) => `${current}-${identifier(branchSlug(branch))}.${identifier(sha.slice(0, SHORT_SHA))}`;

/** The npm dist-tag a branch publishes under: its slug, unless npm would refuse it or it is latest. */
export const branchTag = (slug: string) =>
  SEMVER_RANGE.test(slug) || slug === "latest" ? `branch-${slug}` : slug;

/** What `shiplane` does on the default branch: the real release, or (`shiplane branch`) a test version. */
export type OnDefault = "release" | "publish";

export type BranchChoice = "release" | "ask" | "publish";

/**
 * What `shiplane` does where it runs. On the default branch: the real release, or a test version
 * without asking, since you are there on purpose. Elsewhere: a test version, asked in a terminal
 * unless --yes. A pull request is never required.
 */
export const branchChoice = ({
  onDefaultBranch,
  onDefault,
  yes,
  interactive,
}: {
  onDefaultBranch: boolean;
  onDefault: OnDefault;
  yes: boolean;
  interactive: boolean;
}): BranchChoice => {
  if (onDefaultBranch) return onDefault;
  return yes || !interactive ? "publish" : "ask";
};

/** One package a branch release published. */
export interface BranchPublished {
  name: string;
  version: string;
  tag: string;
  /** Published to the public npm registry, so npmjs.com shows it. */
  onNpmjs: boolean;
}

const NPMJS = "https://www.npmjs.com/package";
const FENCE = "```";

/** What to install: the exact version, or the bare name when it is on latest. */
export const installSpec = ({
  name,
  version,
  tag,
}: Pick<BranchPublished, "name" | "version" | "tag">) =>
  tag === "latest" ? name : `${name}@${version}`;

/** The install line a tester copies: the exact build, so it never moves under them. */
export const installLine = (entry: BranchPublished) => `npm i ${installSpec(entry)}`;

/** The repository a pull request address belongs to, such as `https://github.com/o/r`; else null. */
export const repositoryOfPr = (url: string) =>
  /^(https?:\/\/.+?)\/pull\/\d+$/.exec(url)?.[1] ?? null;

const link = (text: string, url: string, linked: boolean) => (linked ? `[${text}](${url})` : text);

const row = (entry: BranchPublished) => {
  const page = `${NPMJS}/${entry.name}`;
  const name = link(entry.name, page, entry.onNpmjs);
  const version = link(entry.version, `${page}/v/${entry.version}`, entry.onNpmjs);
  return `| ${name} | ${version} | \`${installLine(entry)}\` |`;
};

const notPublished = (others: readonly string[]) => {
  if (others.length === 0) return [];
  const names = others.map((name) => `\`${name}\``).join(", ");
  return ["", `Test release not available yet: ${names} (npm packages only for now).`];
};

/**
 * The pull request comment presets: `table`, the install table with its notes (the default), and
 * `compact`, one line. Each is a template, as is any text of your own.
 */
export const comments = {
  table: [
    "### 📦 Published on npm for testing",
    "Built from {commit} on `{branch}`. These are test versions on the `{channel}` channel, not a release; pending changesets are untouched.",
    "",
    "{table}",
    "",
    "<sub>Updated by shiplane on each run, same comment.</sub>",
    "",
  ].join("\n"),
  compact: "📦 Test version of `{branch}` ({commit}): {install}\n",
} as const;

/** Where `@<tag>` points: this branch's latest snapshot, or the channel's newest version. */
const tagPoints = (channel: string) =>
  channel === "snapshot" ? "this branch's latest publish" : `each new ${channel}`;

/** The install table, the pin line, the pnpm and yarn lines, and the pending units left out. */
const installTable = (
  published: readonly BranchPublished[],
  others: readonly string[],
  channel: string,
) => {
  const [first] = published;
  const specs = published.map(installSpec).join(" ");
  return [
    "| Package | Version | Install |",
    "| --- | --- | --- |",
    ...published.map(row),
    "",
    ...(first
      ? [
          `To follow ${tagPoints(channel)} instead, install the tag: \`npm i ${first.name}@${first.tag}\`.`,
          "",
        ]
      : []),
    "<details><summary>pnpm / yarn</summary>",
    "",
    FENCE,
    `pnpm add ${specs}`,
    `yarn add ${specs}`,
    FENCE,
    "</details>",
    ...notPublished(others),
  ].join("\n");
};

const PLACEHOLDER = /\{(branch|commit|table|install|channel)\}/g;

/**
 * The comment a test version keeps on its pull request, one per pull request: the template with
 * `{branch}`, `{commit}`, `{table}`, `{install}` and `{channel}` filled in, always under the marker that finds
 * it again.
 */
export const branchComment = ({
  sha,
  branch,
  repository,
  published,
  others,
  channel = "snapshot",
  template = comments.table,
}: {
  sha: string;
  branch: string;
  /** The repository's web address, to link the commit; null names it plainly. */
  repository: string | null;
  published: readonly BranchPublished[];
  /** The pending units that are not npm packages. */
  others: readonly string[];
  /** The channel it published on: `snapshot` (the default) or a numbered one such as `beta`. */
  channel?: string;
  /** A preset from `comments`, or text of your own. */
  template?: string;
}) => {
  const short = `\`${sha.slice(0, SHORT_SHA)}\``;
  const values: Record<string, string> = {
    branch,
    commit: repository ? `[${short}](${repository}/commit/${sha})` : short,
    table: installTable(published, others, channel),
    channel,
    install: `\`npm i ${published.map(installSpec).join(" ")}\``,
  };
  const body = template.replace(PLACEHOLDER, (_, key: string) => values[key] ?? "");
  return `${BRANCH_COMMENT_MARKER}\n${body}`;
};
