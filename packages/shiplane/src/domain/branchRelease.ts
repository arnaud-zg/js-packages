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

/** `<next>-<slug>.<short sha>`: the version testers install, never one a release takes. */
export const branchVersion = ({
  next,
  branch,
  sha,
}: {
  next: string;
  branch: string;
  sha: string;
}) => `${next}-${identifier(branchSlug(branch))}.${identifier(sha.slice(0, SHORT_SHA))}`;

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
}

/** The install line a tester copies. */
export const installLine = ({ name, tag }: BranchPublished) => `npm i ${name}@${tag}`;

/** The comment a branch release keeps on its pull request, one per pull request. */
export const branchComment = ({
  sha,
  published,
}: {
  sha: string;
  published: readonly BranchPublished[];
}) =>
  [
    BRANCH_COMMENT_MARKER,
    `### Branch release for ${sha.slice(0, SHORT_SHA)}`,
    "| Package | Version | Install |",
    "| --- | --- | --- |",
    ...published.map((entry) => `| ${entry.name} | ${entry.version} | \`${installLine(entry)}\` |`),
    "",
  ].join("\n");
