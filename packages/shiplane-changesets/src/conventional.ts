import type { PlannedChangeset } from "shiplane/plugin";

const BREAKING = /^\w+(\(.+?\))?!:/;
const FEATURE = /^feat(\(.+?\))?:/;
const USER_FACING = /^(feat|fix|perf)(\(.+?\))?:/;

type Bump = PlannedChangeset["releases"][number]["type"];

/** The Conventional Commits bump: `!` a major (a minor below 1.0), `feat` a minor, else a patch. */
export const bumpOf = ({ subject, version }: { subject: string; version: string }): Bump => {
  if (BREAKING.test(subject)) return version.startsWith("0.") ? "minor" : "major";
  return FEATURE.test(subject) ? "minor" : "patch";
};

// Subjects are written as user value already: drop the type, scope and PR number.
export const asSentence = (subject: string) => {
  const text = subject
    .replace(/^\w+(\(.+?\))?!?:\s*/, "")
    .replace(/\s*\(#\d+\)$/, "")
    .trim();
  const sentence = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

/**
 * One changeset per feature, fix or breaking commit, or the latest commit when there are none: a
 * commit in a package changed what it ships, whatever its type says.
 */
export const changesetsFrom = ({
  name,
  version,
  subjects,
}: {
  name: string;
  version: string;
  subjects: readonly string[];
}): PlannedChangeset[] => {
  const told = subjects.filter((subject) => USER_FACING.test(subject) || BREAKING.test(subject));
  const slug = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return (told.length > 0 ? told : subjects.slice(0, 1)).map((subject, index) => ({
    id: `commits-${slug}-${index + 1}`,
    releases: [{ name, type: bumpOf({ subject, version }) }],
    summary: asSentence(subject),
  }));
};
