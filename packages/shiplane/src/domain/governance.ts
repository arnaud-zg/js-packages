import type { DeployFlow, Environment } from "./environment";
import { reachesUsers } from "./environment";

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
 * at the tag, retrying it). An update may come from a branch for testers; users' updates
 * only from the default branch.
 */
export const releaseSource = (
  intent: ReleaseIntent,
  channel: Environment,
  { branch, head, originMain }: GitPosition,
  {
    flow,
    tagCommit = null,
    defaultBranch = "main",
  }: { flow: DeployFlow; tagCommit?: string | null; defaultBranch?: string },
): SourceResult => {
  const needsMain = intent === "build" || (intent === "update" && reachesUsers(flow, channel));
  if (!needsMain || head === tagCommit) return { allowed: true };
  if (branch !== defaultBranch) return { allowed: false, why: "not-main" };
  if (head !== originMain) return { allowed: false, why: "behind-main" };
  return { allowed: true };
};

/** Where users are, nothing runs that nobody confirmed. */
export const yesAllowed = (environment: Environment, yes: boolean, flow: DeployFlow) =>
  !(yes && reachesUsers(flow, environment));
