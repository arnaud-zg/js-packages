import type { AppBump, BumpLevel, PlannedChangeset } from "./changes";
import { nextVersion } from "./versions";

/** Biggest first: up the list is a bigger version, down a smaller one. */
export const LEVELS: readonly BumpLevel[] = ["major", "minor", "patch"];

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

export interface VersionChoices {
  /** The level versioning computed. */
  computed: BumpLevel;
  /** The version each level leads to. */
  versions: Record<BumpLevel, string>;
}

/** A version a person chose over the computed one. */
export interface ForcedVersion {
  /** Nothing in the release ships above it. */
  level: BumpLevel;
  /** Moves the release up to that level, and carries why into its notes. */
  changeset: PlannedChangeset;
}

/**
 * The versions a release can go to, when everything it moves lands on one version: a single unit
 * or a fixed group. Null when units move apart, or on a version no bump explains, a prerelease.
 */
export const versionChoices = (bumps: readonly AppBump[]): VersionChoices | null => {
  const [first] = bumps;
  if (!first || !PLAIN_VERSION.test(first.from)) return null;
  if (bumps.some(({ from, to }) => from !== first.from || to !== first.to)) return null;
  const { from, to } = first;
  const versions = {
    major: nextVersion(from, "major"),
    minor: nextVersion(from, "minor"),
    patch: nextVersion(from, "patch"),
  };
  const computed = LEVELS.find((level) => versions[level] === to);
  return computed ? { computed, versions } : null;
};

/** The person's choice, as what the release adds: `packages` are all those it moves. */
export const forcedVersion = (
  { computed, versions }: VersionChoices,
  level: BumpLevel,
  reason: string,
  packages: readonly string[],
): ForcedVersion => ({
  level,
  changeset: {
    id: `forced-${versions[level]}`,
    releases: packages.map((name) => ({ name, type: level })),
    summary: `Version forced to ${versions[level]} instead of ${versions[computed]}: ${reason}`,
  },
});

/**
 * The reason prefilled when a person forces a version, so one Enter is enough. Keyed by the level
 * forced, then by whether it goes `up` from the computed version or `down`. Major has nothing below
 * it and patch nothing above, so each has one side only. Edit a line here to change what is offered.
 */
export const USUAL_REASONS = {
  major: {
    // A changeset marked minor or patch hid a break: users must hear it before they upgrade.
    up: "Breaking change the changesets missed",
  },
  minor: {
    // A changeset marked patch added something users can use: a minor tells them to look.
    up: "New feature the changesets called a fix",
    // A changeset marked major broke nothing users touch, like an internal API.
    down: "Changesets overstated the change",
  },
  patch: {
    // Changesets marked minor carried only refactors, docs or tooling: nothing to look for.
    down: "Nothing users see changed",
  },
} as const satisfies Record<BumpLevel, { up?: string; down?: string }>;

/** The usual reason for forcing `level` instead of the computed version. */
export const usualReason = ({ computed }: VersionChoices, level: BumpLevel): string | undefined => {
  const reasons: { up?: string; down?: string } = USUAL_REASONS[level];
  return LEVELS.indexOf(level) < LEVELS.indexOf(computed) ? reasons.up : reasons.down;
};
