/** A dist-tag on a registry, the version it points at, and when that version was published. */
export interface TaggedVersion {
  tag: string;
  version: string;
  /** ISO time the registry gives the version; null when it gives none. */
  publishedAt: string | null;
}

/**
 * How old a snapshot's version must be before its tag is removed: 30 days, long enough that a
 * branch still under test has published a newer snapshot since. Never fewer than `MIN_AGE_DAYS`.
 */
export const DEFAULT_AGE_DAYS = 30;
export const MIN_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
// <x.y.z>-<branch slug>.<short sha>, the shape `branchVersion` gives; a numbered channel's
// <x.y.z>-beta.<n> never matches, its last identifier being a count, not 7 hex characters.
const SNAPSHOT = /^\d+\.\d+\.\d+-([a-z0-9-]+)\.(g?[0-9a-f]{7})$/;

/**
 * Whether a tag is one a shiplane snapshot left: its version has a snapshot's shape and the tag is
 * that version's branch slug (as branch snapshots were tagged), `branch-<slug>`, or `snapshot`.
 */
export const isSnapshotTag = ({ tag, version }: Pick<TaggedVersion, "tag" | "version">) => {
  const slug = SNAPSHOT.exec(version)?.[1];
  if (slug === undefined || tag === "latest") return false;
  return tag === slug || tag === `branch-${slug}` || tag === "snapshot";
};

/** Why an age cannot be one, or null when it can. */
export const ageProblem = (days: number) =>
  Number.isInteger(days) && days >= MIN_AGE_DAYS
    ? null
    : `--older-than takes a whole number of days, ${MIN_AGE_DAYS} or more`;

/** Whole days between a publish time and now; null when the time is missing or unreadable. */
export const ageInDays = (publishedAt: string | null, now: Date) => {
  const at = publishedAt === null ? Number.NaN : Date.parse(publishedAt);
  return Number.isNaN(at) ? null : Math.floor((now.getTime() - at) / DAY_MS);
};

/**
 * The snapshot tags old enough to remove: a shiplane snapshot's tag, on a version published at
 * least `olderThanDays` ago, never the one `latest` points at. A version with no publish time is
 * kept: old is never guessed.
 */
export const staleSnapshotTags = ({
  tags,
  now,
  olderThanDays = DEFAULT_AGE_DAYS,
}: {
  tags: readonly TaggedVersion[];
  now: Date;
  olderThanDays?: number;
}) => {
  const latest = tags.find(({ tag }) => tag === "latest")?.version;
  return tags.flatMap((tagged) => {
    const days = ageInDays(tagged.publishedAt, now);
    if (!isSnapshotTag(tagged) || tagged.version === latest) return [];
    return days !== null && days >= olderThanDays ? [{ ...tagged, days }] : [];
  });
};
