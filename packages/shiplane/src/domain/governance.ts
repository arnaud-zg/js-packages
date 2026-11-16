import type { Environment } from "./environment";

export type ReleaseIntent = "build" | "update" | "submit";

export interface GitPosition {
  branch: string;
  head: string;
  /** The default branch on origin after a fetch: origin/main, or origin/master. The name stays. */
  originMain: string;
}

export type SourceResult = { allowed: true } | { allowed: false; why: "not-main" | "behind-main" };

/**
 * A binary ships what it was built from, so builds start from the default branch (main, or
 * master) as it is on origin, or from exactly the commit the release tagged (a runner checked out
 * at the tag, retrying it). Preview updates may come from a branch for testers; production updates
 * only from the default branch.
 */
export const releaseSource = (
  intent: ReleaseIntent,
  channel: Environment,
  { branch, head, originMain }: GitPosition,
  {
    tagCommit = null,
    defaultBranch = "main",
  }: { tagCommit?: string | null; defaultBranch?: string } = {},
): SourceResult => {
  const needsMain = intent === "build" || (intent === "update" && channel === "production");
  if (!needsMain || head === tagCommit) return { allowed: true };
  if (branch !== defaultBranch) return { allowed: false, why: "not-main" };
  if (head !== originMain) return { allowed: false, why: "behind-main" };
  return { allowed: true };
};

/** Where `pnpm shiplane` goes: --channel when given, preview under --yes or with no terminal, else asked. */
export const channelChoice = ({
  flag,
  yes,
  interactive,
}: {
  flag: Environment | undefined;
  yes: boolean;
  interactive: boolean;
}): Environment | null => flag ?? (yes || !interactive ? "preview" : null);

/** Production never runs a step nobody confirmed. */
export const yesAllowed = (channel: Environment, yes: boolean) =>
  !(yes && channel === "production");
