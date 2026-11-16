import type { OpenPr } from "./releasePr";

const MAX_SLUG = 40;
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
    .slice(0, MAX_SLUG)
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

export type BranchChoice = "release" | "ask" | "publish" | "no-pr";

/**
 * What `shiplane` does where it runs: the real release on the default branch; elsewhere, a branch
 * release once the branch has a pull request, asked in a terminal unless --yes.
 */
export const branchChoice = ({
  onDefault,
  pr,
  yes,
  interactive,
}: {
  onDefault: boolean;
  pr: OpenPr | null;
  yes: boolean;
  interactive: boolean;
}): BranchChoice => {
  if (onDefault) return "release";
  if (!pr) return "no-pr";
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

/** The install line a tester copies. */
export const installLine = ({ name, tag }: BranchPublished) => `npm i ${name}@${tag}`;

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
  const why = others.length === 1 ? "not an npm package" : "not npm packages";
  return [`Not published here: ${names} (${why}).`, ""];
};

/** The comment a branch release keeps on its pull request, one per pull request. */
export const branchComment = ({
  sha,
  branch,
  repository,
  published,
  others,
}: {
  sha: string;
  branch: string;
  /** The repository's web address, to link the commit; null names it plainly. */
  repository: string | null;
  published: readonly BranchPublished[];
  /** The changed units that are not npm packages. */
  others: readonly string[];
}) => {
  const short = `\`${sha.slice(0, SHORT_SHA)}\``;
  const commit = repository ? `[${short}](${repository}/commit/${sha})` : short;
  const [first] = published;
  const tags = published.map(({ name, tag }) => `${name}@${tag}`).join(" ");
  return [
    BRANCH_COMMENT_MARKER,
    "### 📦 Published on npm for testing",
    `Built from ${commit} on \`${branch}\`. These are temporary test versions, not a release; pending changesets are untouched.`,
    "",
    "| Package | Version | Install |",
    "| --- | --- | --- |",
    ...published.map(row),
    "",
    ...(first
      ? [
          `\`@${first.tag}\` always points at this branch's latest publish. To stay on this exact build, install the version instead: \`npm i ${first.name}@${first.version}\`.`,
          "",
        ]
      : []),
    "<details><summary>pnpm / yarn</summary>",
    "",
    FENCE,
    `pnpm add ${tags}`,
    `yarn add ${tags}`,
    FENCE,
    "</details>",
    "",
    ...notPublished(others),
    "<sub>Updated by shiplane on each run, same comment.</sub>",
    "",
  ].join("\n");
};
