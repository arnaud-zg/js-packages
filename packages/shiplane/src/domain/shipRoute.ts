import type { DeployPath } from "./deploys";

/**
 * Builds and submits run on their own platform: they ask only when a workflow can start them too.
 */
export const choosesPath = ({
  kind,
  jobs,
}: {
  kind: string;
  jobs: readonly { ci?: object | null }[];
}) =>
  kind === "update" ||
  kind === "deploy" ||
  ((kind === "build" || kind === "submit") && jobs.every(({ ci }) => ci));

/** On a CI runner, dispatching another workflow would pay for two: this runner ships. */
export const forcedPath = ({ ci, via }: { ci: boolean; via: DeployPath | undefined }) =>
  ci ? ("local" as const) : via;

export const OTHER_PATH: Record<DeployPath, DeployPath> = { ci: "local", local: "ci" };

/** How a unit goes, from why each path cannot ship it (null when it can). */
export type RouteChoice =
  { route: "ask" } | { route: "stuck" } | { route: DeployPath; blocked: string };

/** Both paths open asks; one blocked takes the other; both blocked, nothing can ship it. */
export const routeChoice = ({
  ci,
  local,
}: {
  ci: string | null;
  local: string | null;
}): RouteChoice => {
  if (ci && local) return { route: "stuck" };
  if (ci) return { route: OTHER_PATH.ci, blocked: ci };
  if (local) return { route: OTHER_PATH.local, blocked: local };
  return { route: "ask" };
};

/** One job a workflow ships: its unit, the ref it runs on, and the commit that ref tags. */
export interface WorkflowJob {
  unit: string;
  ref: string;
  /** Null for a ref shipped as it moves, such as main. */
  commit: string | null;
}

/**
 * The ship workflow's runs: one per commit, each naming its units, so tags on one commit cost one
 * run. A run goes on the first unit's tag, never on main: a runner checks out its ref when it
 * starts, and main may have moved by then. Only a job that ships main on purpose runs from main.
 */
export const shipRuns = (jobs: readonly WorkflowJob[]) => {
  const runs = new Map<string, { ref: string; units: string[] }>();
  for (const { unit, ref, commit } of jobs) {
    const key = commit === null ? `ref:${ref}` : `commit:${commit}`;
    const run = runs.get(key) ?? { ref, units: [] };
    if (!run.units.includes(unit)) run.units.push(unit);
    runs.set(key, run);
  }
  return [...runs.values()];
};
